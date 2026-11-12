"""DAS3H d=0：标准库推断、时间特征、JSON模型和离线训练。

推断不依赖训练库。只有明确对错和已审核知识点进入学习特征。
"""
from bisect import bisect_left
from dataclasses import dataclass
from hashlib import sha256
import json
import math
from pathlib import Path

DAY_MS = 86400000
WINDOWS_MS = (3600000, DAY_MS, 7 * DAY_MS, 30 * DAY_MS, None)
FORMAT = 'das3h-d0-v1'


def identity(value):
    return sha256(str(value).encode('utf-8')).hexdigest()


def feature_key(*parts):
    return json.dumps(parts, ensure_ascii=False, separators=(',', ':'))


@dataclass(frozen=True)
class Event:
    user: str
    item: str
    timestamp: int
    correct: bool
    skills: tuple[str, ...]
    event_id: str

    def __post_init__(self):
        if (type(self.timestamp) is not int or self.timestamp < 0 or type(self.correct) is not bool or
                not self.user or not self.item or not self.event_id or
                any(not isinstance(skill, str) or not skill.strip() for skill in self.skills)):
            raise ValueError('作答事件无效')


class History:
    """二分查询严格早于预测时刻的窗口；同时间戳不互相泄漏答案。"""
    def __init__(self, events):
        unique = {}
        for event in events:
            key = (event.user, event.event_id)
            if key in unique and unique[key] != event:
                raise ValueError('重复事件ID的内容不一致')
            unique[key] = event
        self.events = sorted(unique.values(), key=lambda e: (e.timestamp, e.user, e.event_id))
        self.skills = {}
        self.items = {}
        for event in self.events:
            for store, keys in ((self.skills, set(event.skills)), (self.items, {event.item})):
                for key in keys:
                    times, wins = store.setdefault((event.user, key), ([], [0]))
                    times.append(event.timestamp)
                    wins.append(wins[-1] + int(event.correct))

    @staticmethod
    def _counts(series, timestamp, window=None):
        if series is None:
            return 0, 0
        times, wins = series
        end = bisect_left(times, timestamp)
        start = bisect_left(times, timestamp - window) if window is not None else 0
        return wins[end] - wins[start], end - start

    def item_counts(self, user, item, timestamp):
        return self._counts(self.items.get((user, item)), timestamp)

    def features(self, user, item, skills, timestamp):
        result = {feature_key('user', user): 1.0, feature_key('item', item): -1.0}
        for skill in sorted(set(skills)):
            result[feature_key('skill', skill)] = 1.0
            for index, window in enumerate(WINDOWS_MS):
                correct, attempts = self._counts(self.skills.get((user, skill)), timestamp, window)
                result[feature_key('correct', skill, index)] = math.log1p(correct)
                result[feature_key('attempts', skill, index)] = -math.log1p(attempts)
        return result


def sigmoid(value):
    if value >= 0:
        return 1.0 / (1.0 + math.exp(-value))
    exp_value = math.exp(value)
    return exp_value / (1.0 + exp_value)


@dataclass
class Model:
    intercept: float
    weights: dict[str, float]
    skills: tuple[str, ...]
    users: tuple[str, ...]
    trained_until: int
    version: str
    validated: bool
    report: dict

    def correct_probability(self, features):
        return sigmoid(self.intercept + sum(self.weights.get(key, 0.0) * value for key, value in features.items()))

    def to_dict(self):
        return {'format': FORMAT, 'windows_ms': list(WINDOWS_MS), 'intercept': self.intercept,
            'weights': self.weights, 'approved_skills': list(self.skills), 'allowed_users': list(self.users),
            'trained_until_ms': self.trained_until, 'version': self.version,
            'validated': self.validated, 'evaluation': self.report}

    @classmethod
    def from_dict(cls, data):
        if not isinstance(data, dict) or data.get('format') != FORMAT or data.get('windows_ms') != list(WINDOWS_MS):
            raise ValueError('模型格式或时间窗口不兼容')
        weights = data.get('weights')
        if (not isinstance(weights, dict) or len(weights) > 1000000 or
                not isinstance(data.get('intercept'), (int, float)) or not math.isfinite(data['intercept']) or
                any(not isinstance(key, str) or not isinstance(value, (int, float)) or not math.isfinite(value)
                    for key, value in weights.items())):
            raise ValueError('模型参数无效')
        skills, users = data.get('approved_skills'), data.get('allowed_users')
        if (not isinstance(skills, list) or not skills or any(not isinstance(s, str) or not s.strip() for s in skills) or
                not isinstance(users, list) or not users or any(not isinstance(u, str) or not u for u in users) or
                type(data.get('trained_until_ms')) is not int or data['trained_until_ms'] < 0 or
                type(data.get('validated')) is not bool or not isinstance(data.get('evaluation'), dict) or
                not isinstance(data.get('version'), str) or not data['version']):
            raise ValueError('模型元数据无效')
        if data['validated'] and data['evaluation'].get('activation_gate_passed') is not True:
            raise ValueError('模型没有通过上线评估门槛')
        return cls(float(data['intercept']), weights, tuple(skills), tuple(users), data['trained_until_ms'],
                   data['version'], data['validated'], data['evaluation'])


def load_model(path):
    if Path(path).stat().st_size > 32 * 1024 * 1024:
        raise ValueError('模型文件过大')
    return Model.from_dict(json.loads(Path(path).read_text(encoding='utf-8-sig')))


def beta_risk(incorrect, judged, reason='model_missing'):
    if not 0 <= incorrect <= judged:
        raise ValueError('作答计数不一致')
    return {'probability': (incorrect + 1.0) / (judged + 2.0), 'source': 'beta_binomial',
        'model_version': None, 'fallback_reason': reason, 'evidence_count': judged,
        'confidence': 'no_record' if judged == 0 else 'limited', 'validated': False}


def predict_risk(model, history, user, item, skills, timestamp, incorrect, judged, load_reason='model_missing'):
    reason = load_reason
    confirmed = tuple(sorted(set(skills) & set(model.skills))) if model else ()
    if model:
        if not model.validated:
            reason = 'model_not_validated'
        elif user not in model.users:
            reason = 'user_outside_training_scope'
        elif timestamp <= model.trained_until:
            reason = 'prediction_before_training_cutoff'
        elif not confirmed:
            reason = 'missing_confirmed_skills'
        else:
            probability = 1.0 - model.correct_probability(history.features(user, item, confirmed, timestamp))
            return {'probability': probability, 'source': 'das3h', 'model_version': model.version,
                'fallback_reason': None, 'evidence_count': judged,
                'confidence': 'no_record' if judged == 0 else 'model_estimate', 'validated': True}
    return beta_risk(incorrect, judged, reason)


def metrics(labels, probabilities):
    if not labels or len(labels) != len(probabilities):
        raise ValueError('评估样本为空或不匹配')
    probabilities = [min(1-1e-12, max(1e-12, p)) for p in probabilities]
    n = len(labels)
    loss = -sum(y*math.log(p)+(1-y)*math.log1p(-p) for y,p in zip(labels, probabilities))/n
    brier = sum((y-p)**2 for y,p in zip(labels, probabilities))/n
    positives = sum(labels)
    auc = None
    if 0 < positives < n:
        ordered = sorted(zip(probabilities, labels))
        rank_sum, offset = 0.0, 0
        while offset < n:
            end = offset + 1
            while end < n and ordered[end][0] == ordered[offset][0]:
                end += 1
            rank_sum += ((offset+1+end)/2) * sum(y for _,y in ordered[offset:end])
            offset = end
        auc = (rank_sum-positives*(positives+1)/2)/(positives*(n-positives))
    bins = []
    for index in range(10):
        rows = [(y,p) for y,p in zip(labels,probabilities) if min(9,int(p*10)) == index]
        if rows:
            bins.append({'bin': index, 'count': len(rows), 'predicted': sum(p for _,p in rows)/len(rows),
                         'observed': sum(y for y,_ in rows)/len(rows)})
    return {'count':n, 'log_loss':loss, 'brier_score':brier, 'auc':auc, 'calibration_bins':bins}


def train_model(events, approved_skills, *, min_train=100, min_holdout=20, version='das3h-v1'):
    """70/15/15按时间分割，验证集选正则参数，测试集只用于上线门槛。

    尚未通过门槛的文件仍可保存为候选，但线上不会使用。
    """
    from sklearn.feature_extraction import DictVectorizer
    from sklearn.linear_model import LogisticRegression
    approved = tuple(sorted(set(approved_skills)))
    if not approved or min_train < 2 or min_holdout < 2:
        raise ValueError('必须提供审核知识点及有效最小样本数')
    history = History(events)
    usable = [e for e in history.events if set(e.skills) & set(approved)]
    if len(usable) < min_train + 2*min_holdout:
        raise ValueError('明确对错且具备审核知识点的训练记录不足')
    timestamps = sorted({e.timestamp for e in usable})
    if len(timestamps) < 3:
        raise ValueError('需要至少三个不同的作答时间')
    train_end = usable[int(len(usable)*0.70)].timestamp
    validation_end = usable[int(len(usable)*0.85)].timestamp
    train = [e for e in usable if e.timestamp < train_end]
    validation = [e for e in usable if train_end <= e.timestamp < validation_end]
    test = [e for e in usable if e.timestamp >= validation_end]
    for rows, minimum in ((train,min_train),(validation,min_holdout),(test,min_holdout)):
        if len(rows) < minimum or len({e.correct for e in rows}) != 2:
            raise ValueError('时间分割后的样本不足或只有一种作答结果')
    def features(rows):
        return [history.features(e.user,e.item,set(e.skills)&set(approved),e.timestamp) for e in rows]
    def baseline(rows):
        result = []
        for e in rows:
            correct, attempts = history.item_counts(e.user,e.item,e.timestamp)
            result.append((correct+1)/(attempts+2))
        return result
    vectorizer = DictVectorizer(sparse=True)
    x_train = vectorizer.fit_transform(features(train))
    x_validation = vectorizer.transform(features(validation))
    y_train = [int(e.correct) for e in train]
    y_validation = [int(e.correct) for e in validation]
    fits = []
    for strength in (0.01,0.1,1.0,10.0):
        estimator = LogisticRegression(C=strength, max_iter=1000, solver='lbfgs')
        estimator.fit(x_train,y_train)
        values = estimator.predict_proba(x_validation)[:,1].tolist()
        fits.append((metrics(y_validation,values)['log_loss'],strength,estimator,values))
    _, strength, estimator, validation_prob = min(fits,key=lambda row:row[0])
    #不在测试集上再训练，也不因测试结果选择另一组参数。
    test_prob = estimator.predict_proba(vectorizer.transform(features(test)))[:,1].tolist()
    val_metrics = metrics(y_validation,validation_prob)
    val_baseline = metrics(y_validation,baseline(validation))
    test_metrics = metrics([int(e.correct) for e in test],test_prob)
    test_baseline = metrics([int(e.correct) for e in test],baseline(test))
    #PFA比较基线使用全部历史的正确/错误次数，不加入时间窗口。
    def pfa_features(rows):
        result = []
        for event in rows:
            features = {}
            for skill in set(event.skills)&set(approved):
                correct,attempts = History._counts(history.skills.get((event.user,skill)),event.timestamp)
                features[feature_key('skill',skill)] = 1.0
                features[feature_key('success',skill)] = float(correct)
                features[feature_key('failure',skill)] = float(attempts-correct)
            result.append(features)
        return result
    pfa_vectorizer = DictVectorizer(sparse=True)
    pfa_train = pfa_vectorizer.fit_transform(pfa_features(train))
    pfa_validation = pfa_vectorizer.transform(pfa_features(validation))
    pfa_fits = []
    for pfa_strength in (0.01,0.1,1.0,10.0):
        fitted = LogisticRegression(C=pfa_strength,max_iter=1000,solver='lbfgs')
        fitted.fit(pfa_train,y_train)
        probabilities = fitted.predict_proba(pfa_validation)[:,1].tolist()
        pfa_fits.append((metrics(y_validation,probabilities)['log_loss'],fitted,probabilities))
    _,pfa,pfa_prob = min(pfa_fits,key=lambda row:row[0])
    pfa_val_metrics = metrics(y_validation,pfa_prob)
    pfa_test_metrics = metrics([int(e.correct) for e in test],
        pfa.predict_proba(pfa_vectorizer.transform(pfa_features(test)))[:,1].tolist())
    accepted = all(actual['log_loss'] <= base['log_loss'] and actual['brier_score'] <= base['brier_score']
                   for actual,base in ((val_metrics,val_baseline),(test_metrics,test_baseline)))
    weights = dict(zip(vectorizer.get_feature_names_out().tolist(),estimator.coef_[0].tolist()))
    report = {'train_count':len(train),'validation':val_metrics,'test':test_metrics,
        'validation_baseline':val_baseline,'test_baseline':test_baseline,
        'pfa_validation':pfa_val_metrics,'pfa_test':pfa_test_metrics,
        'regularization_C':strength,'split':'chronological-70-15-15-ties-grouped',
        'validation_start_ms':train_end,'test_start_ms':validation_end,
        'activation_gate_passed':accepted,'test_is_sequential':True}
    fingerprint = sha256(json.dumps({'weights':weights,'intercept':float(estimator.intercept_[0]),
        'approved_skills':approved},sort_keys=True,ensure_ascii=False).encode('utf-8')).hexdigest()[:12]
    #参数只用了训练/验证集，但上线判定看过测试集，在线截止覆盖所有评估数据。
    return Model(float(estimator.intercept_[0]),weights,approved,tuple(sorted({e.user for e in train})),
        max(e.timestamp for e in usable),version+'-'+fingerprint,accepted,report)
