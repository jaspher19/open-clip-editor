"""JSON-lines progress + word timestamps. All downloads/caches stay in this project."""
import os,pathlib,sys,json,argparse,math,wave,hashlib
ROOT=pathlib.Path(__file__).resolve().parent.parent
for name,value in {'HF_HOME':ROOT/'.cache/huggingface','HF_HUB_CACHE':ROOT/'.cache/huggingface/hub','TMP':ROOT/'.cache/tmp','TEMP':ROOT/'.cache/tmp','XDG_CACHE_HOME':ROOT/'.cache','MPLCONFIGDIR':ROOT/'.cache/matplotlib','PYTHONPYCACHEPREFIX':ROOT/'.cache/pycache'}.items():os.environ[name]=str(value)
os.environ['HF_HUB_DISABLE_SYMLINKS_WARNING']='1'
def event(**kw):print(json.dumps(kw,ensure_ascii=False),flush=True)
def write_json_atomic(output,value):
    target=pathlib.Path(output);partial=target.with_name(target.name+'.partial')
    partial.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8');partial.replace(target)
def load_audio(filename):
    import numpy as np
    with wave.open(str(filename),'rb') as f:
        if f.getnchannels()!=1 or f.getframerate()!=16000 or f.getsampwidth()!=2:raise ValueError('Transcription requires FFmpeg-prepared 16 kHz mono PCM16 WAV')
        return np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').astype(np.float32)/32768

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

def transcribe_with_checkpoint(model,samples,checkpoint,identity,emit=event,checkpoint_interval=30,window=600,edge=2):
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
            segments,info=model.transcribe(samples[round(cursor*16000):len(samples) if final else round(stop*16000)],
                                           language=chosen,word_timestamps=True,vad_filter=True,beam_size=5,
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
                for w in seg.words or []:
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
    if len(words)<8:raise RuntimeError('Not enough spoken words found. Try a speech-based video or a different language/model.')
    processed=duration;save()
    return {'language':language,'duration':duration,'words':words,'segments':parts,'model':identity['model']}
def main():
    ap=argparse.ArgumentParser();ap.add_argument('audio');ap.add_argument('output');ap.add_argument('--model',default='small');ap.add_argument('--language',default='auto');a=ap.parse_args()
    from faster_whisper import WhisperModel
    import numpy as np
    event(stage='transcribe',progress=0,message='Checking local speech audio and saved progress')
    with open(a.audio,'rb') as source:fingerprint=hashlib.file_digest(source,'sha256').hexdigest()
    samples=load_audio(a.audio)
    identity={'audio_sha256':fingerprint,'model':a.model,'language':a.language,'samples':len(samples),'version':1}
    event(stage='transcribe',progress=0,message=f'Loading {a.model}; first use may download a model')
    local=ROOT/'.cache/models'/a.model
    model=WhisperModel(str(local) if (local/'model.bin').exists() else a.model,device='cpu',compute_type='int8',cpu_threads=4,num_workers=1,download_root=str(ROOT/'.cache/huggingface/hub'))
    # FFmpeg already decoded this canonical PCM file. Pass its samples directly;
    # newer PyAV releases removed a file-decoder keyword used by faster-whisper.
    checkpoint=pathlib.Path(a.output).with_suffix('.checkpoint.json')
    out=transcribe_with_checkpoint(model,samples,checkpoint,identity)
    # Reuse the canonical float samples; don't decode/allocate the entire WAV twice.
    hop=8000
    out['energy']=[{'time':round(i/16000,3),'rms':round(float(np.sqrt(np.mean(samples[i:i+hop]**2))),5)} for i in range(0,len(samples),hop)]
    out['identity']=identity
    write_json_atomic(a.output,out);event(stage='transcribe',progress=1,message=f"{len(out['words'])} words ready",processedSeconds=out['duration'],totalSeconds=out['duration'],wordCount=len(out['words']),checkpointSeconds=out['duration'])
if __name__=='__main__':
    try:main()
    except Exception as e:event(error=str(e));raise
