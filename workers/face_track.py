"""Sample a clip with MediaPipe, choose a dominant face, and smooth its horizontal center."""
import os,pathlib,argparse,json,math
ROOT=pathlib.Path(__file__).resolve().parent.parent
os.environ['MPLCONFIGDIR']=str(ROOT/'.cache/matplotlib');os.environ['TFHUB_CACHE_DIR']=str(ROOT/'.cache/tfhub')
def main():
    ap=argparse.ArgumentParser();ap.add_argument('video');ap.add_argument('output');ap.add_argument('--start',type=float,required=True);ap.add_argument('--end',type=float,required=True);a=ap.parse_args()
    import cv2,mediapipe as mp,numpy as np
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision
    model=ROOT/'.cache/models/face/blaze_face_short_range.tflite'
    if not model.exists():raise RuntimeError('Face model missing; run npm run setup:faces or use center framing')
    cap=cv2.VideoCapture(a.video)
    if not cap.isOpened():raise RuntimeError('Cannot open the source for face sampling')
    width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH));height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    options=vision.FaceDetectorOptions(base_options=python.BaseOptions(model_asset_path=str(model)),running_mode=vision.RunningMode.VIDEO,min_detection_confidence=.5)
    samples=[];previous=.5;found=0;last_found=a.start-10;time=a.start;frame_no=0
    with vision.FaceDetector.create_from_options(options) as detector:
        while time<=a.end+.001:
            cap.set(cv2.CAP_PROP_POS_MSEC,time*1000);ok,frame=cap.read()
            if not ok:break
            h,w=frame.shape[:2];scale=min(1,640/w);frame=cv2.resize(frame,(round(w*scale),round(h*scale)));rgb=cv2.cvtColor(frame,cv2.COLOR_BGR2RGB)
            image=mp.Image(image_format=mp.ImageFormat.SRGB,data=np.ascontiguousarray(rgb));result=detector.detect_for_video(image,round((time-a.start)*1000))
            faces=[]
            for d in result.detections:
                b=d.bounding_box;fw=frame.shape[1];cx=(b.origin_x+b.width/2)/fw;area=b.width*b.height/(frame.shape[0]*fw);faces.append((area-.06*abs(cx-previous),cx,float(d.categories[0].score),max(0,b.origin_x/fw),min(1,(b.origin_x+b.width)/fw)))
            box=None
            if faces:
                _,target,confidence,left,right=max(faces);last_found=time;found+=1;box=(round(left,5),round(right,5))
            else:target=previous if time-last_found<1.5 else .5;confidence=0
            target=max(.03,min(.97,target));delta=max(-.13,min(.13,(target-previous)*.5));previous=max(0,min(1,previous+delta))
            # centerX is the old causal estimate; rawX/left/right let the renderer smooth with look-ahead and keep the face box in frame.
            sample={'time':round(time,4),'centerX':round(previous,5),'confidence':round(confidence,4),'faces':len(faces)}
            if box:sample.update({'rawX':round(target,5),'left':box[0],'right':box[1]})
            samples.append(sample)
            frame_no+=1
            if frame_no%10==0:print(json.dumps({'stage':'framing','progress':(time-a.start)/max(.01,a.end-a.start)}),flush=True)
            time+=.4
    cap.release();pathlib.Path(a.output).write_text(json.dumps({'samples':samples,'detectedSamples':found,'totalSamples':len(samples),'fallback':found==0,'width':width,'height':height,'model':'BlazeFace short-range / MediaPipe'},indent=2),encoding='utf-8')
    print(json.dumps({'stage':'framing','progress':1,'detectedSamples':found}),flush=True)
if __name__=='__main__':main()
