import json,pathlib,tempfile,unittest
from unittest.mock import patch
from workers.transcribe import write_json_atomic
ROOT=pathlib.Path(__file__).resolve().parent.parent
class TranscriptPublication(unittest.TestCase):
    def test_failed_publication_keeps_previous_complete_transcript(self):
        root=ROOT/'.cache/tmp';root.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as folder:
            target=pathlib.Path(folder)/'transcript.json';target.write_text('{"complete":true}',encoding='utf-8')
            with patch.object(pathlib.Path,'replace',side_effect=OSError('interrupted publication')):
                with self.assertRaises(OSError):write_json_atomic(target,{'new':True})
            self.assertEqual(json.loads(target.read_text()),{'complete':True})
            write_json_atomic(target,{'new':True});self.assertEqual(json.loads(target.read_text()),{'new':True})
if __name__=='__main__':unittest.main()
