"""模型数学、时间泄漏、冷启动、训练/评估与安全JSON协议。"""
import json
import math
from importlib.util import find_spec
import tempfile
import unittest
from dataclasses import asdict
from contextlib import redirect_stdout
import io
from pathlib import Path

from src.db_sql.review_risk import Event,History,Model,identity,feature_key,metrics,predict_risk,train_model,load_model,DAY_MS


class ReviewRiskTests(unittest.TestCase):
    def event(self, ident, timestamp, correct=True, skill='方程', item='a'):
        return Event(identity('alice'),identity(item),timestamp,correct,(skill,),ident)

    def model(self, **overrides):
        args = dict(intercept=0.0,weights={},skills=('方程',),users=(identity('alice'),),
                    trained_until=10,version='test',validated=True,report={'activation_gate_passed':True})
        args.update(overrides)
        return Model(**args)

    def test_timestamp_ties_future_and_window_edges_do_not_leak(self):
        history = History([self.event('old',0),self.event('now',DAY_MS,False),self.event('future',2*DAY_MS)])
        features = history.features(identity('alice'),identity('a'),['方程'],DAY_MS)
        self.assertEqual(features[feature_key('correct','方程',1)],math.log(2))
        self.assertEqual(features[feature_key('attempts','方程',1)],-math.log(2))
        self.assertEqual(features[feature_key('correct','方程',0)],0)
        self.assertEqual(history.item_counts(identity('alice'),identity('a'),DAY_MS),(1,1))

    def test_same_skill_transfers_across_items_without_cross_user_data(self):
        history = History([self.event('1',20,item='other'),
            Event(identity('bob'),identity('a'),21,False,('方程',),'bob-log')])
        features = history.features(identity('alice'),identity('a'),['方程','方程'],30)
        self.assertEqual(features[feature_key('correct','方程',4)],math.log(2))
        self.assertEqual(history.item_counts(identity('alice'),identity('a'),30),(0,0))

    def test_duplicate_events_deduplicated_but_conflicting_ids_rejected(self):
        event = self.event('1',20)
        self.assertEqual(len(History([event,event]).events),1)
        with self.assertRaises(ValueError):
            History([event,self.event('1',20,False)])
        with self.assertRaises(ValueError):
            Event('u','i',1,None,('方程',),'e')

    def test_probability_exact_formula_and_numerically_stable(self):
        key = feature_key('skill','方程')
        model = self.model(intercept=math.log(3),weights={key:math.log(2)})
        self.assertAlmostEqual(model.correct_probability({key:1}),6/7)
        risk = predict_risk(model,History([]),identity('alice'),identity('a'),['方程'],20,0,0)
        self.assertAlmostEqual(risk['probability'],1/7)
        self.assertEqual(risk['source'],'das3h')
        self.assertEqual(self.model(intercept=-1000).correct_probability({}),0)
        self.assertEqual(self.model(intercept=1000).correct_probability({}),1)

    def test_fallback_no_model_unknown_skill_user_cutoff_and_failed_gate(self):
        history = History([])
        cases = [(None,'alice',['方程'],20,'model_missing'),
            (self.model(),'bob',['方程'],20,'user_outside_training_scope'),
            (self.model(),'alice',['来源标签'],20,'missing_confirmed_skills'),
            (self.model(),'alice',['方程'],10,'prediction_before_training_cutoff'),
            (self.model(validated=False),'alice',['方程'],20,'model_not_validated')]
        for model,user,skills,timestamp,reason in cases:
            risk = predict_risk(model,history,identity(user),identity('a'),skills,timestamp,3,4)
            self.assertEqual(risk['source'],'beta_binomial')
            self.assertAlmostEqual(risk['probability'],4/6)
            self.assertEqual(risk['fallback_reason'],reason)
        risk = predict_risk(None,None,'u','i',[],20,0,0)
        self.assertEqual(risk['confidence'],'no_record')

    def test_json_roundtrip_invalid_numbers_and_no_pickle(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'model.json'
            path.write_text(json.dumps(self.model().to_dict()),encoding='utf-8')
            self.assertEqual(load_model(path).version,'test')
            for key,value in (('format','wrong'),('windows_ms',[1]),('intercept',float('nan')),
                              ('weights',{'x':float('inf')}),('allowed_users',[])):
                data = self.model().to_dict()
                data[key] = value
                with self.assertRaises(ValueError):
                    Model.from_dict(data)

    def test_metrics_distinguish_ranking_and_calibration(self):
        result = metrics([0,1],[0.2,0.8])
        self.assertAlmostEqual(result['log_loss'],-math.log(0.8))
        self.assertAlmostEqual(result['brier_score'],0.04)
        self.assertEqual(result['auc'],1)
        self.assertEqual(metrics([0,1],[0.5,0.5])['auc'],0.5)
        self.assertIsNone(metrics([1,1],[0.8,0.8])['auc'])

    @unittest.skipUnless(find_spec('sklearn'),'需要可选离线训练依赖')
    def test_real_training_time_split_fit_and_serialized_predictions(self):
        events = [Event(identity('alice'),identity(str(i)),1000+i*DAY_MS,i%2 == 0,
                        ('基础' if i%2 == 0 else '综合',),str(i)) for i in range(240)]
        model = train_model(events,['基础','综合'])
        self.assertTrue(model.validated)
        self.assertLess(model.report['test']['log_loss'],model.report['test_baseline']['log_loss'])
        self.assertLess(model.report['validation_start_ms'],model.report['test_start_ms'])
        self.assertEqual(model.trained_until,events[-1].timestamp)
        self.assertNotIn(identity('239'),''.join(model.weights))
        restored = Model.from_dict(model.to_dict())
        features = History(events).features(identity('alice'),identity('new'),['基础'],events[-1].timestamp+1)
        self.assertAlmostEqual(model.correct_probability(features),restored.correct_probability(features))

    @unittest.skipUnless(find_spec('sklearn'),'需要可选离线训练依赖')
    def test_insufficient_records_and_single_outcome_not_trainable(self):
        with self.assertRaises(ValueError):
            train_model([self.event('a',1)],['方程'])
        with self.assertRaises(ValueError):
            train_model([self.event(str(i),i+1) for i in range(240)],['方程'])

    @unittest.skipUnless(find_spec('sklearn'),'需要可选离线训练依赖')
    def test_cli_training_produces_loadable_model_without_database_access(self):
        from src.db_sql.train_review_risk import main
        events = [Event(identity('alice'),identity(str(i)),1000+i*DAY_MS,i%2 == 0,
                        ('基础' if i%2 == 0 else '综合',),str(i)) for i in range(240)]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'events.json').write_text(json.dumps([asdict(event) for event in events]),encoding='utf-8')
            (root/'skills.json').write_text(json.dumps(['基础','综合']),encoding='utf-8')
            output = io.StringIO()
            with redirect_stdout(output):
                code = main(['--input',str(root/'events.json'),'--skills-file',str(root/'skills.json'),
                             '--output',str(root/'model.json')])
            self.assertEqual(code,0)
            model = load_model(root/'model.json')
            self.assertTrue(model.validated)
            self.assertIn('pfa_test',model.report)
            self.assertNotIn('alice',str(model.to_dict()))
