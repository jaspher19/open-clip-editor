"""Facecam finder pieces on synthetic data (no model or video needed). Run: python -m unittest workers.test_facecam"""
import unittest,numpy as np,cv2
from workers import facecam as F

def face(x,y,w=.05,h=.09,s=.9):return [x,y,w,h,s]

class SteadyFace(unittest.TestCase):
    def test_streamer_cam_beats_moving_and_rare_faces(self):
        frames=[[face(.07,.10),face(.2+.04*k,.5)] for k in range(16)]  # steady cam face + a game face that moves
        frames[3]=[face(.6,.6)]  # a one-off face elsewhere
        box,hits,spread=F.steady_face(frames,16)
        self.assertAlmostEqual(box[0],.07,places=3);self.assertEqual(hits,15);self.assertLess(spread,.01)
    def test_bigger_steady_face_wins_over_a_small_teammate_cam(self):
        frames=[[face(.95,.49,.038,.068),face(.1,.6,.1,.18)] for _ in range(12)]+[[face(.95,.49,.038,.068)] for _ in range(4)]
        box,_,_=F.steady_face(frames,16);self.assertAlmostEqual(box[0],.1,places=3)
    def test_nothing_steady(self):
        self.assertEqual(F.steady_face([[face(.1*k,.3)] for k in range(8)],8)[0],None)
        self.assertEqual(F.steady_face([[face(.1,.1)]]+[[] for _ in range(15)],16)[0],None)

class Borders(unittest.TestCase):
    def frames(self,box,n=8,seed=3):
        """A cam (textured room, static) inside a 1px border, over moving noise ('gameplay')."""
        rng=np.random.default_rng(seed);x0,y0,x1,y1=box;room=rng.integers(0,255,(y1-y0,x1-x0)).astype(np.uint8)
        room=cv2.GaussianBlur(room,(0,0),2);out=[]
        for _ in range(n):
            g=cv2.GaussianBlur(rng.integers(0,255,(F.H,F.W)).astype(np.uint8),(0,0),3);g[y0:y1,x0:x1]=room
            cv2.rectangle(g,(x0,y0),(x1-1,y1-1),255,1);out.append(g)
        return out
    def test_finds_the_drawn_cam_rectangle(self):
        box=(0,88,224,218);grays=self.frames(box)
        fx,fy,fw,fh=80/F.W,120/F.H,36/F.W,36/F.H
        best=F.choose_box(np,*F.edge_maps(np,cv2,grays,30),[fx,fy,fw,fh])
        self.assertIsNotNone(best);l,t,r,b=best[1]
        self.assertLessEqual(abs(l-0),3);self.assertLessEqual(abs(t-88),3);self.assertLessEqual(abs(r-224),3);self.assertLessEqual(abs(b-218),3)
        self.assertGreaterEqual(best[2],F.EDGES)
    def test_moving_scenery_has_no_persistent_border(self):
        rng=np.random.default_rng(1);grays=[cv2.GaussianBlur(rng.integers(0,255,(F.H,F.W)).astype(np.uint8),(0,0),3) for _ in range(8)]
        best=F.choose_box(np,*F.edge_maps(np,cv2,grays,30),[.4,.4,.05,.09])
        self.assertTrue(best is None or best[2]<F.EDGES)

class Estimate(unittest.TestCase):
    def test_box_from_face_size_snaps_to_the_frame_edge(self):
        x,y,w,h=F.estimate_box([.03,.6,.1,.18])
        self.assertEqual(x,0);self.assertAlmostEqual(w,.36);self.assertLessEqual(y+h,1.0001)
        self.assertTrue(x<=.03 and x+w>=.13 and y<=.6 and y+h>=.78,'the face stays inside')

if __name__=='__main__':unittest.main()
