"""Find where a downloaded high-resolution section really starts inside the full stream.

Section downloads from HLS streams start near, not exactly at, the requested time (stream
copy snaps to segment and keyframe boundaries). Captions and cuts are timed against the
full-stream audio, so the section's true start is measured by cross-correlating its audio
with that audio around the requested time.

Usage: align.py <reference.wav> <section media> <expected start s> [--radius 20] [--probe 30]
Prints JSON: {"start": seconds, "shift": start - expected, "confidence": 0..1}
"""
import argparse,json,subprocess,sys,wave
import numpy as np

RATE=16000

def section_audio(path,seconds,skip):
    # Decode a stretch of the section's audio to 16 kHz mono float, the reference's format.
    cmd=['ffmpeg','-v','error','-nostdin','-ss',f'{skip:.3f}','-i',path,'-t',f'{seconds:.3f}','-vn','-ac','1','-ar',str(RATE),'-f','f32le','-']
    out=subprocess.run(cmd,capture_output=True,check=True).stdout
    return np.frombuffer(out,dtype=np.float32).astype(np.float64)

def reference_audio(path,start,seconds):
    with wave.open(path,'rb') as w:
        if w.getframerate()!=RATE or w.getnchannels()!=1 or w.getsampwidth()!=2:raise ValueError('Reference audio must be 16 kHz mono PCM')
        total=w.getnframes();a=max(0,int(start*RATE));b=min(total,int((start+seconds)*RATE))
        w.setpos(a);data=np.frombuffer(w.readframes(max(0,b-a)),dtype=np.int16).astype(np.float64)/32768
    return data,a/RATE

def align(reference,section,expected,radius=20.0,probe=30.0,skip=2.0):
    """Return the section's true start time in reference seconds and a 0-1 match confidence.

    `skip` avoids the first seconds of the section, where stream-copy cuts can hold a
    partial segment or silence."""
    clip=section_audio(section,probe,skip)
    if len(clip)<RATE*3:raise ValueError('Section audio is too short to align')
    ref,ref_start=reference_audio(reference,expected+skip-radius,probe+2*radius)
    if len(ref)<len(clip):raise ValueError('Reference audio does not cover this section')
    clip=clip-clip.mean();ref=ref-ref.mean()
    n=1<<int(np.ceil(np.log2(len(ref)+len(clip))))
    corr=np.fft.irfft(np.fft.rfft(ref,n)*np.conj(np.fft.rfft(clip,n)),n)[:len(ref)-len(clip)+1]
    # Normalise by the energy of each reference window, so loud passages do not win by volume alone.
    energy=np.concatenate([[0],np.cumsum(ref*ref)]);window=energy[len(clip):]-energy[:-len(clip)]
    score=corr/np.sqrt(np.maximum(window,1e-12)*max(float(np.dot(clip,clip)),1e-12))
    lag=int(np.argmax(score));confidence=float(score[lag])
    start=ref_start+lag/RATE-skip
    return {'start':round(start,4),'shift':round(start-expected,4),'confidence':round(max(0.0,min(1.0,confidence)),4)}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('reference');ap.add_argument('section');ap.add_argument('expected',type=float)
    ap.add_argument('--radius',type=float,default=20.0);ap.add_argument('--probe',type=float,default=30.0);ap.add_argument('--skip',type=float,default=2.0,help='seconds of the media to skip before matching');a=ap.parse_args()
    try:print(json.dumps(align(a.reference,a.section,a.expected,a.radius,a.probe,a.skip)))
    except Exception as e:print(json.dumps({'error':str(e)}));sys.exit(1)

if __name__=='__main__':main()
