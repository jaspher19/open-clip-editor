"""JSON-lines progress + word timestamps. All downloads/caches stay in this project."""
import os,pathlib,sys,json,argparse,math,wave,hashlib
ROOT=pathlib.Path(__file__).resolve().parent.parent
for name,value in {'HF_HOME':ROOT/'.cache/huggingface','HF_HUB_CACHE':ROOT/'.cache/huggingface/hub','TMP':ROOT/'.cache/tmp','TEMP':ROOT/'.cache/tmp','XDG_CACHE_HOME':ROOT/'.cache','MPLCONFIGDIR':ROOT/'.cache/matplotlib','PYTHONPYCACHEPREFIX':ROOT/'.cache/pycache'}.items():os.environ[name]=str(value)
os.environ['HF_HUB_DISABLE_SYMLINKS_WARNING']='1'
def event(**kw):print(json.dumps(kw,ensure_ascii=False),flush=True)
def write_json_atomic(output,value):
    target=pathlib.Path(output);partial=target.with_name(target.name+'.partial')
    partial.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')
    # Windows refuses to replace a file another process has open (a reader, antivirus, the indexer): retry briefly.
    import time
    for attempt in range(40):
        try:partial.replace(target);return
        except PermissionError:
            if attempt==39:raise
            time.sleep(min(.25,.01*(attempt+1)))
def load_audio(filename):
    """Memory-map the PCM16 samples. A 17-hour stream is ~2 GB as int16 but ~4 GB as float32 (twice that while
    converting), so windows are converted to float32 one at a time instead (see `as_float`)."""
    import numpy as np
    with wave.open(str(filename),'rb') as f:
        if f.getnchannels()!=1 or f.getframerate()!=16000 or f.getsampwidth()!=2:raise ValueError('Transcription requires FFmpeg-prepared 16 kHz mono PCM16 WAV')
        frames=f.getnframes()
    with open(filename,'rb') as f:
        head=f.read(12)
        if head[:4]!=b'RIFF' or head[8:12]!=b'WAVE':raise ValueError('Not a WAV file')
        while True:
            chunk=f.read(8)
            if len(chunk)<8:raise ValueError('WAV file has no data chunk')
            size=int.from_bytes(chunk[4:],'little')
            if chunk[:4]==b'data':offset=f.tell();break
            f.seek(size+(size&1),1)
    if not frames:return np.zeros(0,dtype=np.float32)
    return np.memmap(filename,dtype='<i2',mode='r',offset=offset,shape=(frames,))

def as_float(chunk):
    import numpy as np
    dtype=getattr(chunk,"dtype",None)
    return chunk if dtype is None or dtype==np.float32 else chunk.astype(np.float32)/32768

class DraftModel:
    """Batched decoding with draft settings; same call shape as WhisperModel.transcribe."""
    def __init__(self,pipeline):self.pipeline=pipeline
    def transcribe(self,audio,language=None,**_):
        return self.pipeline.transcribe(audio,language=language,beam_size=1,word_timestamps=False,batch_size=8)

def draft_words(seg):
    from types import SimpleNamespace as W
    tokens=seg.text.split();n=len(tokens);a=float(seg.start);b=float(seg.end);step=(b-a)/max(1,n)
    return [W(start=a+i*step,end=a+(i+1)*step,word=t,probability=.5) for i,t in enumerate(tokens)]

def merge_regions(regions,duration):
    out=[]
    for r in sorted(({'start':max(0.0,float(r['start'])),'end':min(duration,float(r['end']))} for r in regions),key=lambda r:r['start']):
        if r['end']-r['start']<.5:continue
        if out and r['start']<=out[-1]['end']:out[-1]['end']=max(out[-1]['end'],r['end'])
        else:out.append(r)
    return out

REGION_GAP=1.0
def join_regions(samples,regions,rate=16000):
    """Only these stretches of the stream, back to back with a second of silence between them (so no word spans two)."""
    import numpy as np
    gap=np.zeros(int(REGION_GAP*rate),dtype=samples.dtype);parts=[]
    for r in regions:parts+= [np.asarray(samples[round(r['start']*rate):round(r['end']*rate)]),gap]
    return np.concatenate(parts) if parts else np.zeros(0,dtype=samples.dtype)

def region_clock(regions):
    """Map a time in the joined audio back to stream time. `back(t, k)` maps within region k; without k, the region holding t."""
    import bisect
    starts=[];at=0.0
    for r in regions:starts.append(at);at+=r['end']-r['start']+REGION_GAP
    def back(t,k=None):
        if k is None:k=max(0,bisect.bisect_right(starts,t)-1)
        r=regions[k];return min(r['end'],r['start']+max(0.0,t-starts[k])),k
    return back

def to_stream_time(out,regions):
    """Word and segment ends map within the region of their start: Whisper can let a last word's end run past the
    silence between regions, and mapped through the next region it would span the whole stretch in between."""
    back=region_clock(regions);words=[];parts=[]
    for w in out['words']:
        a,k=back(w['start']);b,_=back(w['end'],k)
        if b>a:words.append({**w,'start':round(a,4),'end':round(b,4)})
    for g in out['segments']:
        a,k=back(g['start']);b,_=back(g['end'],k)
        if b>a:parts.append({**g,'start':round(a,4),'end':round(b,4)})
    return {**out,'words':words,'segments':parts}

def energy_bins(samples,hop=8000,block=8000*3600):
    """RMS per 0.5 s bin, computed a block at a time."""
    import numpy as np
    out=[]
    for base in range(0,len(samples),block):
        part=as_float(samples[base:base+block])
        for i in range(0,len(part),hop):
            out.append({'time':round((base+i)/16000,3),'rms':round(float(np.sqrt(np.mean(part[i:i+hop]**2))),5)})
    return out

def read_checkpoint(filename,identity,duration):
    """Only a complete atomic snapshot for these exact samples/settings is usable."""
    try:
        state=json.loads(pathlib.Path(filename).read_text(encoding='utf-8'))
        cursor=float(state['processedUntil'])
        if state['identity']!=identity or not math.isfinite(cursor) or not 0<=cursor<=duration:return None
        if not isinstance(state['words'],list) or not isinstance(state['segments'],list) or not isinstance(state['language'],str):return None
        for entries in [state['words'],state['segments']]:
            previous=-1
            for entry in entries:
                start,end=float(entry['start']),float(entry['end'])
                if not math.isfinite(start+end) or not 0<=start<end<=cursor+.001 or start<previous or not isinstance(entry['text'],str):return None
                previous=start
        return state
    except (OSError,ValueError,TypeError,KeyError):return None

def transcribe_with_checkpoint(model,samples,checkpoint,identity,emit=event,checkpoint_interval=30,window=600,edge=2,min_words=8,draft=False):
    """Resume at a committed segment boundary; inference uses VAD on bounded windows.

    Multi-hour audio is never handed to the model whole. A non-final window keeps only
    segments ending at least `edge` seconds before its end; the next window starts at
    the last kept segment, so a word cut by the window boundary is transcribed again."""
    duration=len(samples)/16000
    state=read_checkpoint(checkpoint,identity,duration)
    offset=state['processedUntil'] if state else 0
    words=list(state['words']) if state else [];parts=list(state['segments']) if state else []
    language=state['language'] if state else None
    processed=offset;saved=offset
    def progress(message,resumed=False):
        emit(stage='transcribe',progress=min(.99,processed/max(duration,1)),message=message,
             processedSeconds=round(processed,4),totalSeconds=duration,wordCount=len(words),
             checkpointSeconds=round(saved,4),resumedFromSeconds=offset)
    def save():
        nonlocal saved
        write_json_atomic(checkpoint,{'identity':identity,'processedUntil':processed,
                                     'words':words,'segments':parts,'language':language})
        saved=processed
    if offset:progress(f'Resuming saved transcript at {offset:.0f} / {duration:.0f}s',True)
    requested=identity['language'];chosen=language if language and requested=='auto' else None if requested=='auto' else requested
    cursor=offset
    try:
        while cursor<duration:
            stop=min(duration,cursor+window);final=stop>=duration;limit=duration if final else stop-edge
            segments,info=model.transcribe(as_float(samples[round(cursor*16000):len(samples) if final else round(stop*16000)]),
                                           language=chosen,word_timestamps=not draft,vad_filter=True,beam_size=1 if draft else 5,
                                           condition_on_previous_text=False)
            language=info.language
            if requested=='auto':chosen=language
            kept=0
            for seg in segments:
                a=max(cursor,min(duration,cursor+float(seg.start)));b=min(duration,cursor+float(seg.end))
                # Stop at a boundary-straddling segment unless nothing else was kept.
                if b>limit and kept:break
                kept+=1
                if b>a:parts.append({'start':round(a,4),'end':round(b,4),'text':seg.text.strip()})
                # Draft pass (finding moments only): no word alignment, so words are spread evenly over their segment.
                for w in (draft_words(seg) if draft else seg.words or []):
                    start=max(cursor,cursor+float(w.start));end=min(duration,cursor+float(w.end));text=w.word.strip()
                    if end>start and text:words.append({'start':round(start,4),'end':round(end,4),'text':text,'probability':round(float(w.probability),4)})
                processed=min(duration,max(processed,b,words[-1]['end'] if words else 0))
                # Save the first completed segment, then roughly every 30 source seconds.
                if saved==offset or processed-saved>=checkpoint_interval:save()
                progress(f'Transcribed {processed:.0f} / {duration:.0f}s · saved through {saved:.0f}s')
            if final:break
            # A silent window has no segments: everything up to its end is done.
            if not kept:processed=max(processed,stop)
            cursor=max(processed,cursor+edge) if kept else stop
            if cursor>processed:processed=cursor
            save();progress(f'Transcribed {processed:.0f} / {duration:.0f}s · saved through {saved:.0f}s')
    except Exception:
        if processed>saved:save()
        raise
    if len(words)<min_words:raise RuntimeError('Not enough spoken words found. Try a speech-based video or a different language/model.')
    processed=duration;save()
    return {'language':language,'duration':duration,'words':words,'segments':parts,'model':identity['model']}
def main():
    ap=argparse.ArgumentParser();ap.add_argument('audio');ap.add_argument('output');ap.add_argument('--model',default='small');ap.add_argument('--language',default='auto');ap.add_argument('--min-words',type=int,default=8)
    ap.add_argument('--draft',action='store_true',help='fast pass for finding moments: no word alignment, greedy decoding')
    ap.add_argument('--regions',help='JSON list of {start,end}: transcribe only these stretches')
    ap.add_argument('--threads',type=int,default=4);a=ap.parse_args()
    from faster_whisper import WhisperModel
    import numpy as np
    event(stage='transcribe',progress=0,message='Checking local speech audio and saved progress')
    with open(a.audio,'rb') as source:fingerprint=hashlib.file_digest(source,'sha256').hexdigest()
    full=load_audio(a.audio);samples=full;regions=None
    identity={'audio_sha256':fingerprint,'model':a.model,'language':a.language,'samples':len(full),'version':1}
    if a.draft:identity['draft']='batched'
    if a.regions:
        regions=merge_regions(json.loads(pathlib.Path(a.regions).read_text(encoding='utf-8')),len(full)/16000)
        if not regions:raise RuntimeError('No stretches of the stream to transcribe')
        samples=join_regions(full,regions);identity['regions']=regions
    event(stage='transcribe',progress=0,message=f'Loading {a.model}; first use may download a model')
    local=ROOT/'.cache/models'/a.model
    model=WhisperModel(str(local) if (local/'model.bin').exists() else a.model,device='cpu',compute_type='int8',cpu_threads=max(1,min(16,a.threads)),num_workers=1,download_root=str(ROOT/'.cache/huggingface/hub'))
    if a.draft:
        # Draft pass: faster-whisper's batched pipeline decodes several speech chunks at once. Measured on a real
        # stream it drafted 30 min of audio in 46 s, against 159 s unbatched (and 120 s with three processes).
        # Not used for the final pass: there it found ~9% fewer words than the standard decoder.
        from faster_whisper import BatchedInferencePipeline
        model=DraftModel(BatchedInferencePipeline(model=model))
    # FFmpeg already decoded this canonical PCM file. Pass its samples directly;
    # newer PyAV releases removed a file-decoder keyword used by faster-whisper.
    checkpoint=pathlib.Path(a.output).with_suffix('.checkpoint.json')
    out=transcribe_with_checkpoint(model,samples,checkpoint,identity,min_words=max(0,a.min_words),draft=a.draft)
    if regions:out=to_stream_time(out,regions);out['duration']=len(full)/16000;out['coverage']=[[r['start'],r['end']] for r in regions]
    if a.draft:out['draft']=True
    # Loudness always covers the whole stream, even when only parts of it were transcribed.
    out['energy']=energy_bins(full)
    out['identity']=identity
    write_json_atomic(a.output,out);event(stage='transcribe',progress=1,message=f"{len(out['words'])} words ready",processedSeconds=out['duration'],totalSeconds=out['duration'],wordCount=len(out['words']),checkpointSeconds=out['duration'])
if __name__=='__main__':
    try:main()
    except Exception as e:event(error=str(e));raise
