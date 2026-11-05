import unittest,wave,pathlib,numpy as np
from workers.transcribe import load_audio
ROOT=pathlib.Path(__file__).resolve().parent.parent
class AudioContract(unittest.TestCase):
    def test_canonical_pcm_does_not_depend_on_pyav_file_decoder(self):
        p=ROOT/'.cache/tmp/audio-contract.wav';p.parent.mkdir(parents=True,exist_ok=True)
        with wave.open(str(p),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000);f.writeframes((np.ones(1600)*16384).astype('<i2').tobytes())
        a=load_audio(p);self.assertEqual(a.shape,(1600,));self.assertAlmostEqual(float(a[0]),.5,places=4)
    def test_noncanonical_audio_is_rejected(self):
        p=ROOT/'.cache/tmp/audio-contract-bad.wav'
        with wave.open(str(p),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(48000);f.writeframes(bytes(4800))
        with self.assertRaisesRegex(ValueError,'16 kHz mono'):load_audio(p)
if __name__=='__main__':unittest.main()
