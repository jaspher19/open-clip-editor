import unittest
import numpy as np
from workers.transcribe import merge_regions,join_regions,region_clock,to_stream_time,draft_words,REGION_GAP
from types import SimpleNamespace as Obj

class Regions(unittest.TestCase):
    def test_join_and_map_back_to_stream_time(self):
        rate=16000;samples=(np.arange(100*rate)%30000).astype(np.int16)
        regions=merge_regions([{'start':60,'end':70},{'start':10,'end':20},{'start':15,'end':25},{'start':99,'end':150}],100)
        self.assertEqual(regions,[{'start':10.0,'end':25.0},{'start':60.0,'end':70.0},{'start':99.0,'end':100.0}])
        joined=join_regions(samples,regions)
        self.assertEqual(len(joined),int((15+10+1+3*REGION_GAP)*rate))
        # The joined audio really is those stretches: second 16 of the join is stream second 61.
        at=int((15+REGION_GAP+1)*rate);self.assertTrue(np.array_equal(joined[at:at+100],samples[61*rate:61*rate+100]))
        back=lambda t:region_clock(regions)(t)[0]
        self.assertAlmostEqual(back(0),10);self.assertAlmostEqual(back(14.5),24.5);self.assertAlmostEqual(back(15.5),25,msg='a time in the gap stays at the region end')
        self.assertAlmostEqual(back(16+3.25),63.25)
        out=to_stream_time({'words':[{'start':16+3,'end':16+3.4,'text':'hi'},{'start':15.2,'end':15.8,'text':'gap'}],'segments':[{'start':16,'end':20,'text':'hi'}]},regions)
        self.assertEqual([(w['start'],w['end'],w['text']) for w in out['words']],[(63,63.4,'hi')])
        self.assertEqual(out['segments'][0]['start'],60)
        # A last word whose end runs past the gap into the next region stays in its own region (seen on a real stream).
        out=to_stream_time({'words':[{'start':14.6,'end':16.4,'text':'fuck'}],'segments':[{'start':10,'end':16.4,'text':'x'}]},regions)
        self.assertEqual((out['words'][0]['start'],out['words'][0]['end']),(24.6,25));self.assertEqual(out['segments'][0]['end'],25)
    def test_draft_words_spread_over_their_segment(self):
        ws=draft_words(Obj(start=10.0,end=12.0,text=' oh my god '))
        self.assertEqual([w.word for w in ws],['oh','my','god']);self.assertAlmostEqual(ws[0].start,10);self.assertAlmostEqual(ws[-1].end,12)

if __name__=='__main__':unittest.main()
