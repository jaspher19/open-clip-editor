"""Find the parts of a long stream worth transcribing, without a transcript.

Transcribing a 10-hour stream takes ~1.5 h on a mid-range CPU, but clips come from a few dozen
moments. This scores every second from signals that are cheap to compute on the whole stream:

- loudness against the stream's own rolling 5-minute baseline (yelling, laughing, explosions);
- on-screen change between keyframes, also against a rolling baseline (chases, crashes, fights);
  only keyframes are decoded (~30 s for a 5-hour 360p copy);
- clips viewers made of the stream (Twitch, optional), weighted by views.

Windows of `before` seconds before and `after` seconds after each peak are chosen until the
budget is used: first the best peak in each hour (so long streams are sampled throughout), then
the best peaks overall. Overlapping windows are merged.

Usage: hotspots.py <audio.wav> <video> <output.json> --budget 2800 [--crowd crowd.json]
"""
import argparse,json,math,pathlib,sys
import numpy as np
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
from workers.transcribe import load_audio,as_float

def per_second_loudness(samples,rate=16000,block=3600):
    seconds=len(samples)//rate;out=np.zeros(seconds,dtype=np.float64)
    for base in range(0,seconds,block):
        n=min(block,seconds-base);part=as_float(samples[base*rate:(base+n)*rate]).astype(np.float64).reshape(n,rate)
        out[base:base+n]=np.sqrt((part*part).mean(axis=1))
    return 20*np.log10(out+1e-4)

def keyframe_motion(video,seconds):
    """Mean absolute change between consecutive keyframes (32x18 grey), spread over the seconds between them."""
    try:
        import av
        c=av.open(video);s=c.streams.video[0];s.codec_context.skip_frame='NONKEY';s.thread_type='AUTO'
        out=np.full(seconds,np.nan);last=None;last_t=None
        for f in c.decode(s):
            if f.time is None:continue
            g=f.reformat(width=32,height=18,format='gray').to_ndarray().astype(np.float32)
            if last is not None:
                a,b=max(0,int(last_t)),min(seconds,int(math.ceil(f.time)))
                if b>a:out[a:b]=float(np.abs(g-last).mean())
            last,last_t=g,f.time
        c.close()
        if np.isnan(out).all():return None
        # Fill stretches without keyframes from their neighbours.
        idx=np.arange(seconds);ok=~np.isnan(out);out[~ok]=np.interp(idx[~ok],idx[ok],out[ok])
        return out
    except Exception:
        return None

def rolling_median(x,window=301):
    if len(x)<window:return np.full(len(x),float(np.median(x)) if len(x) else 0.0)
    half=window//2;pad=np.pad(x,(half,half),mode='edge')
    # Median of every 5-second step is enough for a 5-minute baseline and far cheaper.
    step=5;centers=np.arange(0,len(x),step)
    med=np.array([np.median(pad[c:c+window]) for c in centers])
    return np.interp(np.arange(len(x)),centers,med)

def smooth(x,width):
    if width<=1:return x
    k=np.ones(width)/width;return np.convolve(x,k,mode='same')

def score_seconds(loud,motion=None,crowd=()):
    seconds=len(loud)
    # Loudness in dB above the local baseline; a quiet stretch next to music does not drown it.
    lift=np.clip(loud-rolling_median(loud),0,18)/6
    peak=np.clip(loud-np.percentile(loud,90),0,12)/6
    score=smooth(lift,3)+.5*smooth(peak,3)
    if motion is not None:
        base=rolling_median(motion);score=score+.6*smooth(np.clip(motion/np.maximum(base,1e-3)-1,0,3),3)
    for c in crowd:
        a,b=max(0,int(max(c['start'],c['end']-12))),min(seconds,int(math.ceil(c['end'])))
        if b>a:score[a:b]+=min(4,1+.75*math.log10(1+max(0,c.get('views',0))))
    return smooth(score,5)

def merge(regions,gap=1.0):
    out=[]
    for r in sorted(regions,key=lambda r:r['start']):
        if out and r['start']<=out[-1]['end']+gap:out[-1]['end']=max(out[-1]['end'],r['end']);out[-1]['score']=max(out[-1]['score'],r['score'])
        else:out.append(dict(r))
    return out

def choose(score,budget,before=75,after=45,spread=3600):
    seconds=len(score);s=score.copy();chosen=[]
    covered=lambda:sum(r['end']-r['start'] for r in merge(chosen))
    def take(t):
        chosen.append({'start':float(max(0,t-before)),'end':float(min(seconds,t+after)),'score':round(float(score[t]),3),'peak':int(t)})
        s[max(0,t-before-after):min(seconds,t+before+after)]=-np.inf
    # Pass 1: the best moment in each hour, best hours first, so a long stream is looked at throughout.
    blocks=[(float(score[a:a+spread].max()),a) for a in range(0,seconds,spread) if seconds-a>=60]
    for _,a in sorted(blocks,reverse=True):
        if covered()>=budget*.5:break
        part=s[a:a+spread]
        if np.isfinite(part).any():take(a+int(np.argmax(part)))
    # Pass 2: the best remaining peaks anywhere.
    while covered()<budget and np.isfinite(s).any():take(int(np.argmax(s)))
    return merge(chosen)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('audio');ap.add_argument('video');ap.add_argument('output')
    ap.add_argument('--budget',type=float,required=True);ap.add_argument('--crowd');ap.add_argument('--before',type=float,default=75);ap.add_argument('--after',type=float,default=45)
    a=ap.parse_args()
    print(json.dumps({'stage':'scan','progress':0,'message':'Measuring loudness across the stream'}),flush=True)
    loud=per_second_loudness(load_audio(a.audio));seconds=len(loud)
    print(json.dumps({'stage':'scan','progress':.4,'message':'Measuring on-screen action across the stream'}),flush=True)
    motion=keyframe_motion(a.video,seconds)
    crowd=[]
    if a.crowd and pathlib.Path(a.crowd).exists():
        try:crowd=[c for c in json.loads(pathlib.Path(a.crowd).read_text(encoding='utf-8')) if isinstance(c,dict)]
        except ValueError:crowd=[]
    score=score_seconds(loud,motion,crowd)
    regions=choose(score,min(a.budget,seconds),int(a.before),int(a.after))
    out={'regions':[{'start':round(r['start'],3),'end':round(r['end'],3),'score':r['score']} for r in regions],'budget':a.budget,
         'covered':round(sum(r['end']-r['start'] for r in regions),1),'duration':seconds,'signals':{'loudness':True,'motion':motion is not None,'crowdClips':len(crowd)}}
    pathlib.Path(a.output).write_text(json.dumps(out,indent=1),encoding='utf-8')
    print(json.dumps({'stage':'scan','progress':1,'message':f"{len(regions)} hot spots, {out['covered']/60:.0f} min of {seconds/60:.0f} min"}),flush=True)

if __name__=='__main__':main()
