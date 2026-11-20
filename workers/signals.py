"""Per-second on-screen action for the moment picker.

The picker otherwise only hears speech, so a chase or a fight the streamer watches in silence scored zero.
action: sustained change between keyframes (32x18 grey) over 7 s, as a lift over the rolling 5-minute median, 0-3.
Keyframes next to a flat frame (black or white loading screens) give no action, and fades (brightness only) do not
count; the baseline never drops below the stream's median, so leaving a static menu is not action.

Rejected (2026-11-19, real GTA 6 streams): game-sound bursts (sharp, noisy onsets against the previous half second).
In talked-over parts 43% were the streamer starting to speak, and 6 of the 8 strongest bursts that came with on-screen
action were menu sounds (map, weapon shop, "Leave game?"). A pretrained sound-event classifier (YAMNet, PANNs) needs
TensorFlow or PyTorch, gigabytes on a nearly full machine, and game audio, music and voice share one track.

Usage: signals.py <audio.wav> <video> <output.json>   (the WAV header sets the length in seconds)
"""
import argparse,json,pathlib,sys,wave
import numpy as np
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
from workers.hotspots import rolling_median,smooth

def wav_seconds(path):
    with wave.open(str(path),'rb') as w:return int(w.getnframes()//w.getframerate())

def local_median(x,window):
    """Exact centred rolling median for short windows."""
    if len(x)==0:return x
    half=window//2;pad=np.pad(x,(half,half),mode='edge')
    return np.median(np.lib.stride_tricks.sliding_window_view(pad,window),axis=1)

def keyframes(video,seconds):
    """Change between consecutive keyframes (32x18 grey) per second, zero next to a flat frame; None without video."""
    try:
        import av
        c=av.open(video);st=c.streams.video[0];st.codec_context.skip_frame='NONKEY';st.thread_type='AUTO'
        out=np.full(seconds,np.nan);last=None;last_t=None
        for f in c.decode(st):
            if f.time is None:continue
            g=f.reformat(width=32,height=18,format='gray').to_ndarray().astype(np.float32)
            if last is not None:
                a,b=max(0,int(last_t)),min(seconds,int(np.ceil(f.time)))
                # Flat frames (black, white, a plain menu) give nothing; brightness alone (a fade) is removed first.
                if b>a:out[a:b]=0.0 if min(g.std(),last.std())<10 else float(np.abs((g-g.mean())-(last-last.mean())).mean())
            last,last_t=g,f.time
        c.close()
        if np.isnan(out).all():return None
        idx=np.arange(seconds);ok=~np.isnan(out);out[~ok]=np.interp(idx[~ok],idx[ok],out[ok]);return out
    except Exception:
        return None

def action(motion):
    """Sustained change (median over 7 s) above the 5-minute baseline: a chase or a fight keeps the picture moving,
    while a single cut to a pause menu or a loading screen is one spike and does not count."""
    if motion is None:return None
    motion=local_median(motion,7);base=np.maximum(rolling_median(motion),np.median(motion))
    # The baseline never drops below the stream's median, so leaving a static menu or a loading screen is not 'action'.
    return np.clip(2*(motion/np.maximum(base,1e-3)-1),0,3)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('audio');ap.add_argument('video');ap.add_argument('output');a=ap.parse_args()
    print(json.dumps({'stage':'signals','progress':0,'message':'Measuring on-screen action'}),flush=True)
    seconds=wav_seconds(a.audio);act=action(keyframes(a.video,seconds))
    out={'version':2,'seconds':seconds,'action':None if act is None else [round(float(v),2) for v in act]}
    tmp=pathlib.Path(a.output+'.partial');tmp.write_text(json.dumps(out,separators=(',',':')),encoding='utf-8');tmp.replace(a.output)
    print(json.dumps({'stage':'signals','progress':1,'message':f"On-screen action {'measured' if act is not None else 'unavailable'}"}),flush=True)

if __name__=='__main__':main()
