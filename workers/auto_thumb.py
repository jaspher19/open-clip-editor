"""Compose a YouTube thumbnail (1280x720) from a stream clip, in the style of gaming-stream thumbnails:
the streamer's most expressive face cut out with a white outline over a vivid gameplay frame, 1-3 huge words,
an optional red LIVE badge, game name and red arrow.

Usage: auto_thumb.py <spec.json>
spec: {video, shift (source time of the file's zero), times: [source seconds to consider], cam: [x,y,w,h] | null,
       text, badge ('' or 'LIVE'), game, arrow (bool), fonts (folder), out (jpg path)}
Faces are scored with MediaPipe Face Landmarker blendshapes (jaw open, eyes wide, brows up, big smile) plus face size
and sharpness; the person is cut out with the MediaPipe Selfie Segmenter (both Apache-2.0). Prints JSON with what was
chosen. Without a usable face the thumbnail is gameplay and text only.
"""
import json,math,os,pathlib,sys
ROOT=pathlib.Path(__file__).resolve().parent.parent
MODELS=ROOT/'.cache'/'models'/'face'
W,H=1280,720

def read_frames(cv2,video,shift,times):
    cap=cv2.VideoCapture(video);out=[]
    if not cap.isOpened():raise RuntimeError('Cannot open the clip video')
    for t in times:
        cap.set(cv2.CAP_PROP_POS_MSEC,max(0,(t-shift))*1000);ok,f=cap.read()
        if ok:out.append((t,f))
    cap.release();return out

def sharpness(cv2,img):
    g=cv2.cvtColor(img,cv2.COLOR_BGR2GRAY);return float(cv2.Laplacian(g,cv2.CV_64F).var())

def region(img,box):
    h,w=img.shape[:2]
    if not box:return img,(0,0)
    x,y,bw,bh=box;x0,y0=int(x*w),int(y*h);return img[y0:y0+max(2,int(bh*h)),x0:x0+max(2,int(bw*w))],(x0,y0)

EXPRESSIVE={'jawOpen':1.0,'eyeWideLeft':.35,'eyeWideRight':.35,'browInnerUp':.5,'browOuterUpLeft':.2,'browOuterUpRight':.2,'mouthSmileLeft':.35,'mouthSmileRight':.35,'mouthFunnel':.3}

def best_face(cv2,np,mp,frames,cam):
    """The frame whose face is the most expressive, large and sharp. Returns (t, frame, face box px in region, score)."""
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision
    opts=vision.FaceLandmarkerOptions(base_options=python.BaseOptions(model_asset_path=str(MODELS/'face_landmarker.task')),output_face_blendshapes=True,num_faces=2,min_face_detection_confidence=.5)
    best=None
    with vision.FaceLandmarker.create_from_options(opts) as lm:
        for t,f in frames:
            reg,_=region(f,cam);rgb=cv2.cvtColor(reg,cv2.COLOR_BGR2RGB);res=lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.ascontiguousarray(rgb)))
            for k,marks in enumerate(res.face_landmarks):
                xs=[p.x for p in marks];ys=[p.y for p in marks];rh,rw=reg.shape[:2]
                box=(min(xs)*rw,min(ys)*rh,(max(xs)-min(xs))*rw,(max(ys)-min(ys))*rh)
                if box[3]<24:continue
                shapes={c.category_name:c.score for c in res.face_blendshapes[k]} if res.face_blendshapes else {}
                expr=sum(wt*shapes.get(n,0) for n,wt in EXPRESSIVE.items())
                x0,y0=int(max(0,box[0])),int(max(0,box[1]));crop=reg[y0:y0+int(box[3]),x0:x0+int(box[2])]
                sharp=min(1.0,sharpness(cv2,crop)/150) if crop.size else 0
                score=(.25+expr)*(.5+.5*sharp)*min(1.0,box[3]/(.35*rh))
                # The landmarks stop at the brow: the hair needs room above, or the webcam frame cuts the head flat.
                headroom=(box[1]-.35*box[3])/rh
                if headroom<0:score*=.12
                elif headroom<.04:score*=.7
                if not best or score>best[3]:best=(t,f,box,score)
    return best

def cutout(cv2,np,mp,img):
    """Person mask (0-1 float) for an image, smoothed."""
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision
    opts=vision.ImageSegmenterOptions(base_options=python.BaseOptions(model_asset_path=str(MODELS/'selfie_segmenter.tflite')),output_confidence_masks=True)
    with vision.ImageSegmenter.create_from_options(opts) as seg:
        res=seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.ascontiguousarray(cv2.cvtColor(img,cv2.COLOR_BGR2RGB))))
    m=res.confidence_masks[0].numpy_view().astype(np.float32)
    if m.ndim==3:m=m[...,0]
    m=cv2.resize(m,(img.shape[1],img.shape[0]),interpolation=cv2.INTER_LINEAR)
    m=np.clip((m-.35)/.3,0,1);return cv2.GaussianBlur(m,(0,0),1.2)

def gameplay(cv2,np,frames,cam,face_t):
    """A vivid, sharp 16:9 gameplay picture that leaves the cam out, graded for a thumbnail."""
    scored=[]
    for t,f in frames:
        h,w=f.shape[:2];x0,x1=0,w
        if cam:
            cl,cr=cam[0]*w,(cam[0]+cam[2])*w
            if cr<=w*.5:x0=int(cr)         # cam on the left: take the frame right of it
            elif cl>=w*.5:x1=int(cl)       # cam on the right: take the left part
        cw=x1-x0;ch=min(h,int(cw*9/16));cw=int(ch*16/9);cx=(x0+x1)//2;y0=(h-ch)//2
        crop=f[y0:y0+ch,max(0,cx-cw//2):max(0,cx-cw//2)+cw]
        hsv=cv2.cvtColor(crop,cv2.COLOR_BGR2HSV);colour=float(hsv[...,1].mean())/255;bright=float(hsv[...,2].mean())/255
        # Bright, colourful and sharp; dark rooms and loading screens make poor thumbnails.
        scored.append((min(1.0,sharpness(cv2,crop)/300)+colour+1.5*bright-(.6 if bright<.25 else 0)+(.1 if abs(t-face_t)<1 else 0),t,crop))
    _,t,crop=max(scored,key=lambda s:s[0])
    img=cv2.resize(crop,(W,H),interpolation=cv2.INTER_CUBIC)
    # Stretch levels (2nd-98th percentile) so dim game scenes read on a phone.
    lo,hi=np.percentile(img,2),np.percentile(img,98)
    if hi-lo>20:img=np.clip((img.astype(np.float32)-lo)*255/(hi-lo),0,255).astype(np.uint8)
    img=cv2.convertScaleAbs(img,alpha=1,beta=10)
    hsv=cv2.cvtColor(img,cv2.COLOR_BGR2HSV).astype(np.float32);hsv[...,1]=np.clip(hsv[...,1]*1.35,0,255);img=cv2.cvtColor(hsv.astype(np.uint8),cv2.COLOR_HSV2BGR)
    img=cv2.convertScaleAbs(img,alpha=1.12,beta=-8)
    yy,xx=np.mgrid[0:H,0:W];v=1-.35*(((xx-W/2)/(W/2))**2+((yy-H/2)/(H/2))**2)/2
    return (img*np.clip(v,0,1)[...,None]).astype(np.uint8),t

def person_layer(cv2,np,mp,frame,cam,face):
    """RGBA cutout of the streamer scaled so the face is big, with a white outline and soft shadow."""
    reg,_=region(frame,cam);fx,fy,fw,fh=face;rh,rw=reg.shape[:2]
    if not cam:  # no facecam: work on a region around the face
        x0=int(max(0,fx-fw*1.6));x1=int(min(rw,fx+fw*2.6));y0=int(max(0,fy-fh*.9));reg=reg[y0:rh,x0:x1];fx-=x0;fy-=y0;rh,rw=reg.shape[:2]
    mask=cutout(cv2,np,mp,reg)
    if mask.mean()<.03:return None
    # Crop to the person (plus a little air) so the face, not the webcam frame, sets the size.
    cols=np.where(mask.max(0)>.5)[0];rows=np.where(mask.max(1)>.5)[0]
    if len(cols)<4 or len(rows)<4:return None
    pad=int(fw*.25);c0,c1=max(0,cols[0]-pad),min(rw,cols[-1]+pad+1);r0=max(0,rows[0]-pad)
    reg=reg[r0:,c0:c1];mask=mask[r0:,c0:c1];fx-=c0;fy-=r0;rh,rw=reg.shape[:2]
    scale=min(.46*H/max(1,fh),(.6*W)/rw)
    big=cv2.resize(reg,(int(rw*scale),int(rh*scale)),interpolation=cv2.INTER_CUBIC);m=cv2.resize(mask,(big.shape[1],big.shape[0]),interpolation=cv2.INTER_LINEAR)
    big=cv2.addWeighted(big,1.6,cv2.GaussianBlur(big,(0,0),2.2),-.6,0)  # unsharp: upscaled webcams look soft
    return big,m,(fx*scale,fy*scale,fw*scale,fh*scale)

def edge_band(np,shape,width,bottom=True):
    """1 inside, ramping to 0 within `width` px of the left, right and top borders (and bottom if asked)."""
    h,w=shape;yy,xx=np.mgrid[0:h,0:w].astype(np.float32);d=np.minimum(np.minimum(xx,w-1-xx),yy)
    if bottom:d=np.minimum(d,h-1-yy)
    return np.clip(d/width,0,1)

def paste(cv2,np,canvas,big,m,side,face=None):
    # Face centre about 40% down; the webcam frame's bottom edge must stay at or below the thumbnail's bottom edge.
    bh,bw=big.shape[:2];x=W-bw+int(bw*.04) if side=='right' else -int(bw*.04)
    y=int(max(.40*H-(face[1]+face[3]/2),H-bh)) if face else H-bh
    # Where the webcam frame cuts the person (hands, shoulders), fade out softly and draw no outline; the bottom edge
    # sits on the thumbnail's bottom edge, so it stays solid.
    band=edge_band(np,m.shape,22,bottom=False);m=m*band
    stroke=cv2.dilate((m>.5).astype(np.uint8),cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(15,15))).astype(np.float32)*edge_band(np,m.shape,30,bottom=True)
    shadow=cv2.GaussianBlur(cv2.dilate(stroke,np.ones((9,9),np.uint8)),(0,0),9)
    def blend(layer,alpha,dx=0,dy=0):
        xs,ys=x+dx,y+dy;cx0,cy0=max(0,xs),max(0,ys);cx1,cy1=min(W,xs+bw),min(H,ys+bh)
        if cx1<=cx0 or cy1<=cy0:return
        a=alpha[cy0-ys:cy1-ys,cx0-xs:cx1-xs][...,None];l=layer[cy0-ys:cy1-ys,cx0-xs:cx1-xs] if layer.ndim==3 else layer
        canvas[cy0:cy1,cx0:cx1]=(canvas[cy0:cy1,cx0:cx1]*(1-a)+l*a).astype(np.uint8)
    blend(np.zeros_like(big),shadow*.75,10,12);blend(np.full_like(big,255),stroke);blend(big,m)
    return x,y

def draw_text(np,Image,ImageDraw,ImageFont,canvas,spec,side,face_box):
    pil=Image.fromarray(canvas[...,::-1]);d=ImageDraw.Draw(pil);fonts=pathlib.Path(spec['fonts'])
    def font(name,size):
        for n in (name,'Anton-Regular.ttf','Montserrat-Black.ttf'):
            p=fonts/n
            if p.exists():return ImageFont.truetype(str(p),size)
        return ImageFont.load_default()
    words=str(spec.get('text') or '').upper().split();zone=(40,40,int(W*.56),int(H*.62)) if side=='right' else (int(W*.44),40,W-40,int(H*.62))
    if words:
        lines=[' '.join(words)] if len(' '.join(words))<=9 or len(words)==1 else [' '.join(words[:math.ceil(len(words)/2)]),' '.join(words[math.ceil(len(words)/2):])]
        size=200
        while size>60:
            f=font('Anton-Regular.ttf',size);boxes=[d.textbbox((0,0),l,font=f,stroke_width=size//14) for l in lines]
            if max(b[2]-b[0] for b in boxes)<=zone[2]-zone[0] and sum(b[3]-b[1] for b in boxes)+12*len(lines)<=zone[3]-zone[1]:break
            size-=8
        layer=Image.new('RGBA',(W,H),(0,0,0,0));ld=ImageDraw.Draw(layer);y=zone[1]+(30 if spec.get('badge') else 0)
        for i,l in enumerate(lines):
            b=ld.textbbox((0,0),l,font=f,stroke_width=size//14);x=zone[0] if side=='right' else zone[2]-(b[2]-b[0])
            ld.text((x-b[0]+6,y-b[1]+8),l,font=f,fill=(0,0,0,170),stroke_width=size//14,stroke_fill=(0,0,0,170))
            ld.text((x-b[0],y-b[1]),l,font=f,fill=(255,226,40,255) if i==len(lines)-1 and len(lines)>1 else (255,255,255,255),stroke_width=size//14,stroke_fill=(0,0,0,255))
            y+=b[3]-b[1]+12
        # A slight tilt, as on hand-made thumbnails.
        pil=pil.convert('RGBA');pil.alpha_composite(layer.rotate(3 if side=='right' else -3,resample=Image.BICUBIC,center=((zone[0]+zone[2])/2,(zone[1]+y)/2)))
        text_bottom=y
    else:text_bottom=zone[1]
    pil=pil.convert('RGBA');d=ImageDraw.Draw(pil)
    if spec.get('badge'):
        f=font('Montserrat-Black.ttf',34);t=str(spec['badge']).upper()[:8];b=d.textbbox((0,0),t,font=f);bw=b[2]-b[0]+70;bx=zone[0] if side=='right' else zone[2]-bw
        d.rounded_rectangle((bx,22,bx+bw,22+54),radius=10,fill=(229,24,32,255));d.ellipse((bx+16,40,bx+34,58),fill=(255,255,255,255));d.text((bx+46-b[0],49-(b[1]+b[3])/2),t,font=f,fill=(255,255,255,255))
    if spec.get('game'):
        f=font('Montserrat-Black.ttf',40);t=str(spec['game']).upper()[:16];b=d.textbbox((0,0),t,font=f);gw,gh=b[2]-b[0]+36,b[3]-b[1]+24
        gx=W-gw-24 if side=='left' else 24;gy=H-gh-24
        if side=='right':gx=int(W*.40)-gw
        d.rectangle((gx+6,gy+6,gx+gw+6,gy+gh+6),fill=(0,0,0,160));d.rectangle((gx,gy,gx+gw,gy+gh),fill=(255,226,40,255));d.text((gx+18-b[0],gy+12-b[1]),t,font=f,fill=(20,20,20,255))
    if spec.get('arrow'):
        # Red arrow from under the text toward the middle of the gameplay side.
        sx=(zone[0]+zone[2])/2+(-60 if side=='right' else 60);sy=min(H-150,text_bottom+30);tx=sx+(150 if side=='right' else -150);ty=sy+150
        ang=math.atan2(ty-sy,tx-sx);n=(-math.sin(ang),math.cos(ang));L=math.hypot(tx-sx,ty-sy)
        def pt(a,o):return (sx+math.cos(ang)*a+n[0]*o,sy+math.sin(ang)*a+n[1]*o)
        poly=[pt(0,-14),pt(L-46,-14),pt(L-46,-38),pt(L,0),pt(L-46,38),pt(L-46,14),pt(0,14)]
        d.polygon(poly,fill=(255,255,255,255),outline=(255,255,255,255),width=14);d.polygon(poly,fill=(232,28,36,255))
    return np.array(pil.convert('RGB'))[...,::-1].copy()

def main():
    spec=json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
    os.environ.setdefault('MPLCONFIGDIR',str(ROOT/'.cache/matplotlib'))
    import cv2,numpy as np,mediapipe as mp
    from PIL import Image,ImageDraw,ImageFont
    times=sorted(set(round(t,2) for t in spec['times']))
    frames=read_frames(cv2,spec['video'],float(spec.get('shift',0)),times)
    if not frames:raise RuntimeError('No frames could be read from the clip')
    cam=spec.get('cam');face=best_face(cv2,np,mp,frames,cam)
    side='left' if (cam and cam[0]+cam[2]/2<.5) else 'right'
    bg,bg_t=gameplay(cv2,np,frames,cam,face[0] if face else -99)
    used=None
    if face and face[3]>.12:
        layer=person_layer(cv2,np,mp,face[1],cam,face[2])
        if layer:paste(cv2,np,bg,layer[0],layer[1],side,layer[2]);used=face
    out=draw_text(np,Image,ImageDraw,ImageFont,bg,spec,side,None)
    pathlib.Path(spec['out']).parent.mkdir(parents=True,exist_ok=True)
    cv2.imwrite(spec['out'],out,[cv2.IMWRITE_JPEG_QUALITY,90])
    print(json.dumps({'faceAt':used[0] if used else None,'faceScore':round(used[3],3) if used else 0,'gameplayAt':bg_t,'side':side,'person':bool(used)}),flush=True)

if __name__=='__main__':
    try:main()
    except Exception as e:print(json.dumps({'error':str(e)}));sys.exit(1)
