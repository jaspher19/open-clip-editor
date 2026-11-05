import json,pathlib,tempfile,unittest
from types import SimpleNamespace as Obj
import numpy as np
from workers.transcribe import transcribe_with_checkpoint

ROOT=pathlib.Path(__file__).resolve().parent.parent
def segment(start,end,prefix):
    return Obj(start=start,end=end,text=prefix,words=[Obj(start=start+i,end=start+i+.5,word=prefix+str(i),probability=.9) for i in range(4)])
class FakeModel:
    def __init__(self,segments,fail=False):self.segments=segments;self.fail=fail;self.calls=[]
    def transcribe(self,samples,**options):
        self.calls.append((len(samples),options))
        def generate():
            yield from self.segments
            if self.fail:raise RuntimeError('simulated worker interruption')
        return generate(),Obj(language='en',duration=len(samples)/16000)

class CheckpointRecovery(unittest.TestCase):
    def setUp(self):
        folder=ROOT/'.cache/tmp';folder.mkdir(parents=True,exist_ok=True);self.temp=tempfile.TemporaryDirectory(dir=folder);self.file=pathlib.Path(self.temp.name)/'transcript.checkpoint.json';self.audio=np.zeros(60*16000,dtype=np.float32);self.identity={'audio_sha256':'a'*64,'model':'small.en','language':'auto','samples':len(self.audio),'version':1}
    def tearDown(self):self.temp.cleanup()
    def test_interrupted_work_is_saved_and_resume_preserves_prefix_and_absolute_times(self):
        with self.assertRaisesRegex(RuntimeError,'interruption'):
            transcribe_with_checkpoint(FakeModel([segment(0,20,'first')],fail=True),self.audio,self.file,self.identity,emit=lambda **e:None)
        saved=json.loads(self.file.read_text());self.assertEqual(saved['processedUntil'],20);self.assertEqual(len(saved['words']),4)
        resumed=FakeModel([segment(0,20,'second')]);events=[]
        result=transcribe_with_checkpoint(resumed,self.audio,self.file,self.identity,emit=lambda **e:events.append(e))
        self.assertEqual(resumed.calls[0][0],40*16000);self.assertEqual(resumed.calls[0][1]['language'],'en');self.assertEqual(result['words'][:4],saved['words']);self.assertEqual(result['words'][4]['start'],20);self.assertEqual(len(result['words']),8);self.assertEqual(result['duration'],60);self.assertTrue(any(e.get('resumedFromSeconds')==20 for e in events))
    def test_changed_audio_or_model_cannot_reuse_an_old_checkpoint(self):
        for key,value in [('audio_sha256','b'*64),('model','base.en'),('language','fr')]:
            with self.assertRaises(RuntimeError):transcribe_with_checkpoint(FakeModel([segment(0,20,'old')],fail=True),self.audio,self.file,self.identity,emit=lambda **e:None)
            changed={**self.identity,key:value};model=FakeModel([segment(0,20,'new'),segment(20,40,'tail')]);out=transcribe_with_checkpoint(model,self.audio,self.file,changed,emit=lambda **e:None)
            self.assertEqual(model.calls[0][0],len(self.audio));self.assertEqual(out['words'][0]['text'],'new0')
    def test_corrupt_checkpoint_does_not_publish_or_trust_partial_data(self):
        self.file.write_text('{"broken":',encoding='utf-8');model=FakeModel([segment(0,20,'new'),segment(20,40,'tail')]);out=transcribe_with_checkpoint(model,self.audio,self.file,self.identity,emit=lambda **e:None);self.assertEqual(len(out['words']),8);self.assertEqual(model.calls[0][0],len(self.audio))
    def test_multi_hour_input_is_read_in_bounded_windows_with_absolute_word_times(self):
        class Window:
            def __init__(self,n):self.n=n
            def __len__(self):return self.n
        class Audio:
            def __len__(self):return 1300*16000
            def __getitem__(self,s):
                count=(s.stop if s.stop is not None else len(self))-s.start
                self_test.assertLessEqual(count,630*16000)
                return Window(count)
        class Model:
            def __init__(self):self.calls=0
            def transcribe(self,audio,**options):
                self.calls+=1;duration=len(audio)/16000
                return iter([segment(0,20,f'{self.calls}-first'),segment(duration-20,duration-5,f'{self.calls}-last')]),Obj(language='en')
        self_test=self;model=Model();identity={**self.identity,'samples':1300*16000}
        out=transcribe_with_checkpoint(model,Audio(),self.file,identity,emit=lambda **e:None)
        self.assertGreater(model.calls,1);self.assertEqual(out['duration'],1300);self.assertGreater(out['words'][-1]['start'],1200)

if __name__=='__main__':unittest.main()
