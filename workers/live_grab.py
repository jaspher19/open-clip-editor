"""Download part of a stream that is still live, from its start up to now.

YouTube keeps a live stream's past as numbered 5 s DASH fragments ("live from start"); Twitch records a live
broadcast into a growing past-broadcast playlist. Both are listed by yt-dlp's public extractors. This worker takes the
fragments that cover [--from, --to] (default: the start to the newest finished fragment), downloads them several at a
time, joins them and writes one MP4 whose timeline starts at zero. It prints JSON lines:
  {"stage":"download","progress":0-1}
  {"done":true,"start":<stream time of the file's zero>,"duration":...,"elapsed":<seconds streamed so far>}
Exit code 3 with {"error":"not-live"} when the link is not live (anymore): use the normal downloader then.
"""
import argparse,json,math,os,pathlib,re,subprocess,sys,tempfile,threading,time,urllib.parse
from concurrent.futures import ThreadPoolExecutor

def short(f):
    """Short side of a format: quality limits mean 1080p for both 1920x1080 and a vertical 1080x1920 stream."""
    sides=[v for v in (f.get('width'),f.get('height')) if v]
    return min(sides) if sides else 0

def say(**k):print(json.dumps(k),flush=True)

def youtube_listing(ydl,url,height):
    info=ydl.process_ie_result(ydl.extract_info(url,download=False,process=False),download=False)
    fmts=[f for f in info.get('formats') or [] if f.get('protocol')=='http_dash_segments_generator']
    # Just ended and still processing ("post_live"): the same numbered fragments, now as a fixed list.
    if not fmts and info.get('live_status')=='post_live':
        fmts=[f for f in info.get('formats') or [] if f.get('protocol')=='http_dash_segments' and f.get('fragments') is not None and not callable(f['fragments']) and len(f['fragments']) and 'sq=' in f['fragments'][0].get('url','')]
    if not (info.get('is_live') or info.get('live_status')=='post_live') or not fmts:return None
    # Quality first, H.264 only breaks ties: one listing offered 1080p only as VP9 and H.264 only at 144p and 720p,
    # and preferring H.264 took 144p.
    video=[f for f in fmts if f.get('vcodec') not in (None,'none') and short(f)<=height]
    audio=[f for f in fmts if f.get('vcodec')=='none' and f.get('acodec') not in (None,'none')]
    v=max(video,key=lambda f:(short(f),str(f.get('vcodec','')).startswith('avc1'),f.get('fps') or 0)) if video else None
    a=(next((f for f in audio if f.get('format_id')=='140'),None) or max(audio,key=lambda f:f.get('abr') or 0)) if audio else None
    return {'info':info,'video':v,'audio':a}

def youtube_parts(ydl,url,height,tries=4):
    """The best fragment tracks YouTube lists. Its listing varies from call to call (sometimes no video, sometimes only
    low qualities), so it is asked again until the video reaches the wanted quality, keeping the best answer."""
    best=None
    for attempt in range(tries):
        got=youtube_listing(ydl,url,height)
        if got is None:
            if best:break
            return None
        if got['video'] and got['audio'] and (not best or short(got['video'])>short(best['video'])):best=got
        if best and short(best['video'])>=min(height,1080):break
        time.sleep(1+attempt)
    if not best:raise RuntimeError('YouTube listed no video for this stream right now, try again in a minute')
    v,a=best['video'],best['audio'];step=float(v.get('target_duration') or 5)
    return {'info':best['info'],'step':step,'tracks':[('video',v),('audio',a)]}

def youtube_urls(fmt,first,last,started=None,step=5):
    """URLs of fragments first..last (inclusive) and how many fragments exist now. Fragment k is the format's base URL
    with &sq=k; yt-dlp's generator gives the base and the count (estimated from the start time if it is missing)."""
    frs=fmt['fragments'];item=next(iter(frs({}))) if callable(frs) else frs[0]
    count=int(item.get('fragment_count') or (0 if callable(frs) else len(frs)))
    if count<=0 and started:count=int((time.time()-started)/step)-2
    if count<=0:raise RuntimeError('YouTube did not say how much of the stream exists yet')
    m=re.search(r'([&?])sq=\d+',item['url'])
    if not m:raise RuntimeError('Unexpected YouTube fragment address')
    base=item['url'][:m.start()]+m.group(1)+'sq={}'+item['url'][m.end():]
    return [base.format(k) for k in range(first,min(last+1,count-1))],count  # the newest fragment may still be growing

def twitch_playlist(ydl,url,height):
    info=ydl.extract_info(url,download=False)
    if not info.get('is_live'):return None
    video=[f for f in info.get('formats') or [] if str(f.get('protocol','')).startswith('m3u8') and f.get('vcodec') not in (None,'none') and short(f)<=height]
    if not video:raise RuntimeError('No suitable video quality in this broadcast')
    f=max(video,key=lambda f:(short(f),f.get('fps') or 0))
    text=ydl.urlopen(f['url']).read().decode('utf-8','replace');segs=[];init=None;dur=None;t=0.0
    for line in text.splitlines():
        line=line.strip()
        if line.startswith('#EXT-X-MAP:'):m=re.search(r'URI="([^"]+)"',line);init=urllib.parse.urljoin(f['url'],m.group(1)) if m else None
        elif line.startswith('#EXTINF:'):dur=float(line[8:].split(',')[0])
        elif line and not line.startswith('#') and dur is not None:segs.append((t,dur,urllib.parse.urljoin(f['url'],line)));t+=dur;dur=None
    return {'info':info,'segments':segs,'init':init,'elapsed':t}

def fetch_all(ydl,jobs,threads,report,offset=0,total=None):
    """Download (key,url) jobs concurrently with retries; returns {key: bytes}."""
    got={};lock=threading.Lock();done=[offset];total=total or len(jobs)
    def one(job):
        key,url=job
        for attempt in range(6):
            try:data=ydl.urlopen(url).read();break
            except Exception as e:
                if attempt==5:raise RuntimeError(f'A piece of the stream would not download ({e})')
                time.sleep(1.5*(attempt+1))
        with lock:got[key]=data;done[0]+=1;report(done[0]/total)
    with ThreadPoolExecutor(threads) as pool:list(pool.map(one,jobs))
    return got

BATCH=96  # fragments held in memory at once (about 100 MB at 1080p)
def fetch_to_files(ydl,ordered,files,threads,report):
    """`ordered`: list of rows, each a tuple of URLs (one per output file). Rows are appended in order, a batch at a time."""
    handles=[open(f,'wb') for f in files];total=len(ordered)*len(files)
    try:
        for b in range(0,len(ordered),BATCH):
            rows=ordered[b:b+BATCH];jobs=[((k,j),u) for k,row in enumerate(rows) for j,u in enumerate(row) if u]
            got=fetch_all(ydl,jobs,threads,report,offset=b*len(files),total=total)
            for k in range(len(rows)):
                for j,h in enumerate(handles):
                    if (k,j) in got:h.write(got[(k,j)])
    finally:
        for h in handles:h.close()

def ffmpeg(*args):subprocess.run(['ffmpeg','-v','error','-nostdin','-y',*args],check=True)
def start_time(path):
    r=subprocess.run(['ffprobe','-v','error','-show_entries','format=start_time','-of','csv=p=0',path],capture_output=True,text=True)
    try:return float(r.stdout.strip())
    except ValueError:return 0.0

def main():
    ap=argparse.ArgumentParser();ap.add_argument('url');ap.add_argument('output');ap.add_argument('--platform',choices=['youtube','twitch'],required=True)
    ap.add_argument('--height',type=int,default=360);ap.add_argument('--from',dest='start',type=float,default=0);ap.add_argument('--to',dest='end',type=float,default=None)
    ap.add_argument('--node',default=None);ap.add_argument('--threads',type=int,default=8);ap.add_argument('--info',default=None,help='write the stream details (title, channel, start time) here')
    a=ap.parse_args()
    import yt_dlp
    opts={'quiet':True,'no_warnings':True,'cachedir':False,'socket_timeout':20,'noplaylist':True}
    if a.platform=='youtube':opts['live_from_start']=True
    if a.node:opts['js_runtimes']={'node':{'path':a.node}}
    ydl=yt_dlp.YoutubeDL(opts);out=pathlib.Path(a.output);tmp=pathlib.Path(tempfile.mkdtemp(prefix='live-',dir=str(out.parent)))
    last=[0.0]
    def report(p):
        if p-last[0]>=.01 or p>=1:last[0]=p;say(stage='download',progress=round(p,4))
    try:
        if a.platform=='youtube':
            plan=youtube_parts(ydl,a.url,a.height)
            if not plan:say(error='not-live');sys.exit(3)
            step=plan['step'];first=max(0,int(a.start//step));lastk=int(math.ceil(a.end/step)) if a.end is not None else 10**9
            started=plan['info'].get('release_timestamp') or plan['info'].get('timestamp')
            for attempt in range(2):
                lists={};count=0
                for kind,fmt in plan['tracks']:lists[kind],count=youtube_urls(fmt,first,lastk,started,step)
                n=min(len(lists['video']),len(lists['audio']))
                if n>0 or attempt:break
                plan=youtube_parts(ydl,a.url,a.height)  # a fresh listing usually reports the count
                if not plan:say(error='not-live');sys.exit(3)
            if n<1:raise RuntimeError('That part of the stream is not available yet')
            fetch_to_files(ydl,[(lists['video'][k],lists['audio'][k]) for k in range(n)],[tmp/'video.mp4',tmp/'audio.m4a'],a.threads,report)
            # Fragment timestamps are stream time: the first one tells where this file starts.
            vstart=start_time(str(tmp/'video.mp4'));elapsed=(count-1)*step
            # Trust the video timestamp only when it agrees with the fragment number. After a stream ends, YouTube's
            # audio fragments were seen with broken timestamps (the joined track claimed 0.02 s), so the audio is
            # rewritten as a raw AAC stream (timestamps rebuilt from zero) and the video shifted to zero: fragments
            # are paired by number, so both start at the same moment.
            begin=vstart if abs(vstart-first*step)<=2*step else first*step
            ffmpeg('-i',str(tmp/'audio.m4a'),'-map','0:a:0','-c','copy','-f','adts',str(tmp/'audio.aac'))
            # The joined fragments can carry an edit list that disagrees with their own frame times (seen on YouTube
            # live: it pointed 186 s past the last frame, so players and ffmpeg saw 60 of 5,280 frames). Ignore it
            # and start the video's own timestamps at zero.
            # (VP9 fragments come as WebM, which has no edit list and no such option.)
            webm=plan['tracks'][0][1].get('ext')=='webm' or not str(plan['tracks'][0][1].get('vcodec','')).startswith('avc1')
            ffmpeg(*([] if webm else ['-ignore_editlist','1']),'-i',str(tmp/'video.mp4'),'-i',str(tmp/'audio.aac'),'-map','0:v:0','-map','1:a:0','-c','copy','-bsf:v','setts=pts=PTS-STARTDTS:dts=DTS-STARTDTS','-movflags','+faststart',str(out))
            info=plan['info']
        else:
            plan=twitch_playlist(ydl,a.url,a.height)
            if not plan:say(error='not-live');sys.exit(3)
            segs=[s for s in plan['segments'][:-1] if s[0]+s[1]>a.start and (a.end is None or s[0]<a.end)]  # the newest segment may still grow
            if not segs:raise RuntimeError('That part of the stream is not available yet')
            ext='mp4' if plan['init'] else 'ts';rows=([(plan['init'],)] if plan['init'] else [])+[(s[2],) for s in segs]
            fetch_to_files(ydl,rows,[tmp/f'joined.{ext}'],a.threads,report);begin=segs[0][0];elapsed=plan['elapsed']
            ffmpeg('-fflags','+genpts','-i',str(tmp/f'joined.{ext}'),'-map','0:v:0','-map','0:a:0','-c','copy','-avoid_negative_ts','make_zero','-movflags','+faststart',str(out))
            info=plan['info']
        if a.info:
            keep={k:info.get(k) for k in ('id','title','fulltitle','uploader','channel','uploader_id','channel_id','timestamp','release_timestamp','categories','tags','webpage_url','height','is_live','live_status')}
            pathlib.Path(a.info).write_text(json.dumps(keep),encoding='utf-8')
        r=subprocess.run(['ffprobe','-v','error','-show_entries','stream=codec_type,duration','-of','csv=p=0',str(out)],capture_output=True,text=True)
        lengths={}
        for line in r.stdout.split():
            kind,_,value=line.partition(',')
            try:lengths[kind]=float(value)
            except ValueError:pass
        video,audio=lengths.get('video',0),lengths.get('audio',0)
        # Never hand back a file whose sound is missing or cut short (seen once on a stream that had just ended).
        if video<=0 or audio<video*.95-1:out.unlink(missing_ok=True);raise RuntimeError(f'The downloaded part came back with {audio:.1f} s of sound for {video:.1f} s of video')
        say(done=True,start=round(begin,4),duration=round(video,3),elapsed=round(elapsed,3))
    finally:
        for p in tmp.glob('*'):p.unlink(missing_ok=True)
        tmp.rmdir()

if __name__=='__main__':
    try:main()
    except SystemExit:raise
    except Exception as e:say(error=str(e));sys.exit(1)
