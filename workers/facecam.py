"""Find a streamer's facecam box in a stretch of gameplay video.

A facecam is a webcam picture overlaid on the game at a fixed place. Two things give it away:
  1. a face that stays in the same spot across the whole stretch (faces in the game move around), and
  2. the overlay's border: straight edges that never move while the game behind them changes.
Frames are sampled across [start, end]; faces are found on tiles (a facecam face is too small for the
detector on the whole frame); the steadiest face cluster is the streamer; the box around it is chosen from
persistent straight edges, preferring common camera shapes (16:9, 4:3). Without clear edges the box is
estimated from the face size.

Output: {found, box:[x,y,w,h] (0-1 of the frame), face:[x,y,w,h], method, hits, frames, full}
`full` is true when the face fills much of the frame (a camera-only scene): there is nothing to stack.
"""
import os,pathlib,argparse,json,math
ROOT=pathlib.Path(__file__).resolve().parent.parent
os.environ['MPLCONFIGDIR']=str(ROOT/'.cache/matplotlib')

W,H=960,540  # analysis size
STILL=6.0    # grey levels: around a webcam face the picture changes less than this over time
EDGES=2.3    # summed border-line strength (4 sides, ~1 each, frame edges .55) needed to trust the edges; no-cam scenes scored <=2.0

def tiles():
    """Overlapping tiles, about 30% x 40% of the frame, plus the whole frame for large faces."""
    out=[(0,0,1,1)]
    for y in (0,.3,.6):
        for x in (0,.233,.466,.7):
            out.append((x,y,.3,.4))
    return out

def detect_faces(detector,mp,np,frame):
    """Face boxes (normalized x,y,w,h, score) found on any tile, with duplicates merged."""
    h,w=frame.shape[:2];found=[]
    for tx,ty,tw,th in tiles():
        x0,y0=int(tx*w),int(ty*h);x1,y1=min(w,int((tx+tw)*w)),min(h,int((ty+th)*h))
        crop=np.ascontiguousarray(frame[y0:y1,x0:x1])
        res=detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=crop))
        for d in res.detections:
            b=d.bounding_box;s=float(d.categories[0].score)
            fx=(x0+b.origin_x)/w;fy=(y0+b.origin_y)/h;fw=b.width/w;fh=b.height/h
            if fw<=0 or fh<=0:continue
            found.append([fx,fy,fw,fh,s])
    merged=[]
    for f in sorted(found,key=lambda f:-f[4]):
        if all(iou(f,m)<.3 for m in merged):merged.append(f)
    return merged

def iou(a,b):
    ix=max(0,min(a[0]+a[2],b[0]+b[2])-max(a[0],b[0]));iy=max(0,min(a[1]+a[3],b[1]+b[3])-max(a[1],b[1]))
    inter=ix*iy;return inter/max(1e-9,a[2]*a[3]+b[2]*b[3]-inter)

def steady_face(per_frame,frames):
    """The face that appears most often at the same place. Returns (box, hits) or (None, 0)."""
    clusters=[]
    for k,faces in enumerate(per_frame):
        for f in faces:
            cx,cy=f[0]+f[2]/2,f[1]+f[3]/2
            for c in clusters:
                if abs(c['cx']-cx)<max(.04,c['w']*.6) and abs(c['cy']-cy)<max(.05,c['h']*.6):
                    c['items'].append(f);c['frames'].add(k);n=len(c['items'])
                    c['cx']+= (cx-c['cx'])/n;c['cy']+=(cy-c['cy'])/n;c['w']+=(f[2]-c['w'])/n;c['h']+=(f[3]-c['h'])/n;break
            else:clusters.append({'cx':cx,'cy':cy,'w':f[2],'h':f[3],'items':[f],'frames':{k}})
    best=None
    for c in clusters:
        hits=len(c['frames'])
        if hits<max(3,math.ceil(frames*.35)):continue
        xs=[f[0]+f[2]/2 for f in c['items']];spread=(max(xs)-min(xs))
        if spread>.08:continue
        # The streamer's own cam is usually the biggest steady face; teammates' and guests' cams are smaller.
        score=hits/frames+c['w']*8-spread*4
        if not best or score>best[0]:best=(score,c,spread)
    if not best:return None,0,1
    c=best[1]
    import statistics as st
    box=[float(st.median(f[i] for f in c['items'])) for i in range(4)]
    return box,len(c['frames']),best[2]

def edge_maps(np,cv2,grays,percentile=50):
    """Horizontal/vertical gradient strength that holds across frames: only edges that never move survive.
    At the 50th percentile an edge must be there in half the frames; at the 30th, in about 7 of 10."""
    gx=[];gy=[]
    for g in grays:
        f=g.astype(np.float32)
        gx.append(np.abs(cv2.Sobel(f,cv2.CV_32F,1,0,ksize=3)));gy.append(np.abs(cv2.Sobel(f,cv2.CV_32F,0,1,ksize=3)))
    return np.percentile(np.stack(gx),percentile,axis=0),np.percentile(np.stack(gy),percentile,axis=0)

def choose_box(np,ex,ey,face):
    """Pick the rectangle around the face whose sides lie on the most complete persistent edges."""
    fx,fy,fw,fh=face[0]*W,face[1]*H,face[2]*W,face[3]*H
    vx=(ex>40).astype(np.float32);vy=(ey>40).astype(np.float32)
    # Cumulative sums: coverage of a vertical segment at column x from row a to b, and the horizontal equivalent.
    cv=np.vstack([np.zeros((1,W),np.float32),np.cumsum(vx,0)]);ch=np.hstack([np.zeros((H,1),np.float32),np.cumsum(vy,1)])
    # A border is a lone line: strong along its length, with at least one side clear of edges right next to it.
    # Texture (a cluttered room, text) is strong on both sides and scores low.
    def line(cover,pos,size):
        hit=max(cover(p) for p in (pos-1,pos,pos+1) if 0<=p<size)
        side=lambda sign:[cover(pos+sign*d) for d in range(3,7) if 0<=pos+sign*d<size]
        near=[sum(v)/len(v) for v in (side(-1),side(1)) if v]
        return float(hit-(min(near) if near else 0))
    def vcov(x,a,b):
        a,b=int(max(0,a)),int(min(H,b))
        if b-a<4:return 0
        return line(lambda c:(cv[b,c]-cv[a,c])/(b-a),int(x),W)
    def hcov(y,a,b):
        a,b=int(max(0,a)),int(min(W,b))
        if b-a<4:return 0
        return line(lambda r:(ch[r,b]-ch[r,a])/(b-a),int(y),H)
    def peaks(profile,lo,hi,n=7):
        lo,hi=int(max(0,lo)),int(min(len(profile)-1,hi))
        if hi<=lo:return []
        idx=[i for i in range(lo,hi+1) if profile[i]>=.25 and profile[i]==max(profile[max(lo,i-3):i+4])]
        def lone(i):
            near=[profile[j] for j in range(i-6,i-2) if 0<=j<len(profile)],[profile[j] for j in range(i+3,i+7) if 0<=j<len(profile)]
            return profile[i]-min([sum(v)/len(v) for v in near if v] or [0])
        return sorted(idx,key=lambda i:-lone(i))[:n]
    rows=slice(int(max(0,fy-fh*.5)),int(min(H,fy+fh*1.5)));colsl=slice(int(max(0,fx-fw*.5)),int(min(W,fx+fw*1.5)))
    colp=vx[rows].mean(0);rowp=vy[:,colsl].mean(1)
    L=peaks(colp,fx-fw*4.5,fx-fw*.4)+[0];R=peaks(colp,fx+fw*1.4,fx+fw*5.5)+[W]
    T=peaks(rowp,fy-fh*3.5,fy-fh*.2)+[0];B=peaks(rowp,fy+fh*1.5,fy+fh*5)+[H]
    # Integral image of flat pixels (no persistent edge at all) for the flat-area share of any box.
    flatmap=((ex+ey)<3).astype(np.float64);fl=np.zeros((H+1,W+1));fl[1:,1:]=flatmap.cumsum(0).cumsum(1)
    best=None
    for l in L:
        for r in R:
            bw=r-l
            if bw<fw*1.8 or bw>fw*7.5:continue
            for t in T:
                for b in B:
                    bh=b-t
                    if bh<fh*1.6 or bh>fh*6.5:continue
                    edge=lambda c,frame:.55 if frame else c
                    s=(edge(vcov(l,t,b),l==0)+edge(vcov(r,t,b),r==W)+edge(hcov(t,l,r),t==0)+edge(hcov(b,l,r),b==H))
                    ar=bw/bh;shape=min(abs(math.log(ar/(16/9))),abs(math.log(ar/(4/3))))
                    # Faces sit near the middle of a cam, in its upper half or so.
                    cx=(fx+fw/2-l)/bw;cy=(fy+fh/2-t)/bh;place=max(0,abs(cx-.5)-.06)*2.5+max(0,abs(cy-.45)-.15)
                    # A camera picture has no big flat areas; solid fills (black bars, UI panels) belong outside the cam.
                    flat=(fl[b,r]-fl[t,r]-fl[b,l]+fl[t,l])/max(1,bw*bh)
                    ratio=fw/bw;size=0 if .14<=ratio<=.42 else min(abs(math.log(ratio/.14)),abs(math.log(ratio/.42)))
                    real=sum(1 for v,frame in ((l,l==0),(r,r==W),(t,t==0),(b,b==H)) if not frame)
                    score=s-shape*3-place-size*1.5-flat*3
                    if not best or score>best[0]:best=(score,[l,t,r,b],s,real)
    return best

def surroundings_still(np,grays,face):
    """Median per-pixel change over time in a ring around the face (face and body excluded). A webcam room
    barely changes; game scenery around a third-person character does."""
    fx,fy,fw,fh=face[0]*W,face[1]*H,face[2]*W,face[3]*H
    x0,x1=int(max(0,fx-fw*1.2)),int(min(W,fx+fw*2.2));y0,y1=int(max(0,fy-fh*.8)),int(min(H,fy+fh*1.6))
    std=np.stack([g[y0:y1,x0:x1].astype(np.float32) for g in grays]).std(0)
    mask=np.ones(std.shape,bool);mask[max(0,int(fy-y0-fh*.2)):max(0,int(fy-y0+fh*2.5)),max(0,int(fx-x0-fw*.3)):max(0,int(fx-x0+fw*1.3))]=False
    return float(np.median(std[mask])) if mask.any() else 99.0

def estimate_box(face):
    """No clear border: a 16:9 box about 3.6 face widths wide around the face (real cams measured 3-6.5; borderless ones run tight), snapped to nearby frame edges."""
    fx,fy,fw,fh=face;bw=min(.6,fw*3.6);bh=min(.6,bw*W/H*9/16)
    x=fx+fw/2-bw/2;y=fy+fh/2-bh*.45
    if x<.04:x=0
    if y<.04:y=0
    if x+bw>.96:x=1-bw
    if y+bh>.96:y=1-bh
    return [max(0,x),max(0,y),bw,bh]

def main():
    ap=argparse.ArgumentParser();ap.add_argument('video');ap.add_argument('output')
    ap.add_argument('--start',type=float,default=0);ap.add_argument('--end',type=float,default=None);ap.add_argument('--samples',type=int,default=16)
    a=ap.parse_args()
    import cv2,numpy as np,mediapipe as mp
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision
    model=ROOT/'.cache/models/face/blaze_face_short_range.tflite'
    if not model.exists():raise RuntimeError('Face model missing; run npm run setup:faces')
    cap=cv2.VideoCapture(a.video)
    if not cap.isOpened():raise RuntimeError('Cannot open the video for facecam detection')
    length=cap.get(cv2.CAP_PROP_FRAME_COUNT)/max(1,cap.get(cv2.CAP_PROP_FPS) or 30)
    end=a.end if a.end is not None else length
    span=max(.1,end-a.start);times=[a.start+span*(k+.5)/a.samples for k in range(a.samples)]
    opts=vision.FaceDetectorOptions(base_options=python.BaseOptions(model_asset_path=str(model)),running_mode=vision.RunningMode.IMAGE,min_detection_confidence=.55)
    per_frame=[];grays=[]
    with vision.FaceDetector.create_from_options(opts) as det:
        for t in times:
            cap.set(cv2.CAP_PROP_POS_MSEC,t*1000);ok,frame=cap.read()
            if not ok:continue
            # Faces are found at up to 1280 wide; edges at the analysis size.
            h,w=frame.shape[:2];s=min(1,1280/w);big=cv2.resize(frame,(round(w*s),round(h*s))) if s<1 else frame
            per_frame.append(detect_faces(det,mp,np,cv2.cvtColor(big,cv2.COLOR_BGR2RGB)))
            grays.append(cv2.cvtColor(cv2.resize(frame,(W,H),interpolation=cv2.INTER_AREA),cv2.COLOR_BGR2GRAY))
    cap.release()
    frames=len(per_frame);out={'found':False,'box':None,'face':None,'method':None,'hits':0,'frames':frames,'full':False}
    if frames:
        face,hits,spread=steady_face(per_frame,frames);out['hits']=hits
        if face:
            out['face']=[round(v,4) for v in face]
            if face[2]>.16:out['full']=True  # a big face: camera-only scene, nothing to stack
            else:
                still=surroundings_still(np,grays,face);out['stillness']=round(still,2)
                # Strict pass first: lines in about 7 of 10 frames, which ignores chat text scrolling under a cam. Busy
                # broadcasts can hide a border that often; the median pass then finds it.
                ok=lambda b:b and b[3]>=2 and b[2]>=EDGES
                best=choose_box(np,*edge_maps(np,cv2,grays,30),face)
                if not ok(best):
                    loose=choose_box(np,*edge_maps(np,cv2,grays,50),face)
                    if ok(loose) or not best:best=loose
                if best:out['edgeScore']=round(float(best[2]),3);out['edgeBox']=[round(v/(W if k%2==0 else H),4) for k,v in enumerate(best[1])]
                if ok(best):
                    # Step just inside drawn borders (not the frame's own edges) so the overlay's outline is not shown.
                    l,t,r,b=best[1];inset=3;l,t=(l+inset if l>0 else l),(t+inset if t>0 else t);r,b=(r-inset if r<W else r),(b-inset if b<H else b)
                    out.update(found=True,box=[round(l/W,4),round(t/H,4),round((r-l)/W,4),round((b-t)/H,4)],method='edges')
                # Without a clear border, trust a face whose surroundings stay still (a room, not game scenery), or one
                # seen in nearly every frame at one spot (game characters mostly show the back of their head).
                elif still<STILL or (hits>=frames*.7 and spread<.03):out.update(found=True,box=[round(v,4) for v in estimate_box(face)],method='face-size')
    pathlib.Path(a.output).write_text(json.dumps(out,indent=2),encoding='utf-8')
    print(json.dumps({'stage':'facecam',**out}),flush=True)

if __name__=='__main__':main()
