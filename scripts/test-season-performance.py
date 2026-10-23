import importlib.util, pathlib, unittest, tempfile, subprocess, json
P=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('review',P/'review-season-performance.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class MeasurementTests(unittest.TestCase):
    def test_spread_direction(self):
        self.assertEqual(r.margin('Away -7.5','Away','Home'),-7.5)
        self.assertEqual(r.margin('Home -7.5','Away','Home'),7.5)
        self.assertEqual(r.margin('Home +7.5','Away','Home'),-7.5)
        self.assertEqual(r.margin('Away +7.5','Away','Home'),7.5)
        self.assertEqual(r.margin('Pick','Away','Home'),0)
        self.assertIsNone(r.margin('Pending','Away','Home'))
    def test_push_pass_win_loss_and_bias(self):
        rows=[{'models':{'test':p},'marketMargin':m,'result':{'status':'final','actualMargin':a}} for p,m,a in [(8,7,7),(8,7,10),(8,7,0),(7,7,30)]]
        s=r.summarize(rows,'test')
        self.assertEqual((s['n'],s['wins'],s['losses'],s['pushes']),(4,1,1,1))
        self.assertEqual(s['atsDecisions'],2)
        self.assertEqual(s['mae'],8.5)
        self.assertEqual(s['homeMarginBias'],-4)
    def test_ungraded_excluded(self):
        self.assertEqual(r.summarize([{'models':{'a':10},'result':{'status':'pending'}}],'a')['n'],0)
    def test_shadow_grades_only_prospective_published_predictions(self):
        original_root,original_git=r.ROOT,r.git
        try:
            with tempfile.TemporaryDirectory() as temp:
                root=pathlib.Path(temp);folder=root/'data/final-snapshots';folder.mkdir(parents=True)
                for name,frozen in [('valid','2026-10-24T16:00Z'),('after-kickoff','2026-10-24T18:00Z'),('late-publication','2026-10-24T16:00Z')]:
                    value={'canonicalGameId':name,'week':8,'matchup':'Away at Home','kickoff':'2026-10-24T17:00Z','frozenAt':frozen,'market':{'spread':'Home -10'},'shadowModels':{'researchOnly':True,'promoted':False,'candidate':{'homeMargin':11}}}
                    (folder/(name+'.json')).write_text(json.dumps(value))
                (root/'data/model-input-diagnosis-2026.json').write_text(json.dumps({'counterfactualGames':9999}))
                r.ROOT=root;r.git=lambda *args:'2026-10-24T18:00Z' if 'late-publication' in args[-1] else '2026-10-24T16:01Z'
                results={k:{'status':'final','actualMargin':12} for k in ['valid','after-kickoff','late-publication']}
                r.grade_shadow_predictions(results,r.stamp('2026-10-25T12:00Z'))
                saved=json.loads((root/'data/shadow-model-performance-2026.json').read_text())
                self.assertEqual((saved['prospectiveSnapshotCount'],saved['gradedGames'],saved['excludedInvalidSnapshots']),(1,1,2))
                self.assertEqual(saved['models']['candidate']['wins'],1)
                self.assertEqual(saved['models']['candidate']['mae'],1)
        finally:r.ROOT,r.git=original_root,original_git
    def test_snapshot_uses_named_models_and_is_immutable(self):
        with tempfile.TemporaryDirectory() as temp:
            d=pathlib.Path(temp);(d/'data').mkdir()
            board={'season':2026,'week':8,'games':[{'gameId':'TEST','away':'Away','home':'Home','dateTime':'2026-10-24T17:00Z','modelSpread':'Home -7','selectedModel':'ensemble','multiModel':{'market':{'fair':'Home -2','homeMargin':2,'edge':3},'independent':{'fair':'Home -11','homeMargin':10.8,'edge':5.8},'ensemble':{'fair':'Home -7','homeMargin':6.84,'edge':1.84}}}]}
            (d/'data/weekly-board.json').write_text(json.dumps(board))
            env={**__import__('os').environ,'CFB_AS_OF':'2026-10-24T16:00Z'}
            subprocess.run(['node',str(P/'freeze-pre-kickoff-snapshots.mjs')],cwd=d,env=env,check=True,capture_output=True)
            target=d/'data/final-snapshots/2026-w8-TEST.json';first=target.read_bytes();saved=json.loads(first)
            self.assertEqual(saved['models']['marketCalibratedFair'],'Home -2')
            self.assertEqual(saved['models']['ensembleFair'],'Home -7')
            self.assertEqual(saved['models']['independentHomeMargin'],10.8)
            board['games'][0]['multiModel']['ensemble']['fair']='Home -99';(d/'data/weekly-board.json').write_text(json.dumps(board))
            subprocess.run(['node',str(P/'freeze-pre-kickoff-snapshots.mjs')],cwd=d,env=env,check=True,capture_output=True)
            self.assertEqual(first,target.read_bytes())
if __name__=='__main__':unittest.main()
