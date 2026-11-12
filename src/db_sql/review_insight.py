"""复习卡片的展示口径；教学重要性与个人错误风险分别返回。"""
from typing import Literal

from pydantic import BaseModel, Field


class InsightStatus(BaseModel):
    code: Literal['unreviewed', 'unjudged', 'needs_review', 'consolidate']
    label: str


class InsightRisk(BaseModel):
    probability: float | None = Field(ge=0, le=1)
    source: Literal['das3h', 'beta_binomial']
    model_version: str | None
    fallback_reason: str | None
    evidence_count: int = Field(ge=0)
    confidence: Literal['no_record', 'limited', 'model_estimate']
    validated: bool
    displayable: bool


class TeachingImportance(BaseModel):
    code: Literal['unassessed', 'unknown', 'ordinary', 'foundational', 'integrative'] = 'unassessed'
    label: str = '尚未评估'
    weight: float | None = None
    basis: str = '当前没有经过确认的教学重要性评估。'
    evidence: list[str] = Field(default_factory=list)
    source: Literal['none', 'ai_suggestion'] = 'none'
    assessed_at: str | None = None
    assessment_version: str | None = None


class InsightEvidence(BaseModel):
    review_count: int = Field(ge=0)
    wrong_count: int = Field(ge=0)
    judged_count: int = Field(ge=0)
    recent_wrong_count: int = Field(ge=0)
    recent_judged_count: int = Field(ge=0)
    observed_error_rate: float | None = Field(ge=0, le=1)
    explanation: str


class InsightAction(BaseModel):
    action: Literal['arrange_review', 'learn_knowledge']
    label: str


class ReviewInsight(BaseModel):
    entry_id: str
    notebook_id: str
    as_of: str
    timezone: Literal['Asia/Shanghai'] = 'Asia/Shanghai'
    review_count: int
    wrong_count: int
    status: InsightStatus
    recommendation: str
    importance: TeachingImportance
    evidence: InsightEvidence
    risk: InsightRisk
    due_status: Literal['overdue', 'today', 'unscheduled', 'future']
    next_review_date: int | None
    knowledge_points: list[str]
    estimated_seconds: int
    time_estimate_source: Literal['history_median', 'default']
    review_steps: list[str]
    review_hint: str
    actions: list[InsightAction]


def build_review_insight(item: dict, as_of: str, importance: TeachingImportance | None = None) -> ReviewInsight:
    reviews, wrong, judged = item['review_count'], item['wrong_count'], item['judged_count']
    risk = dict(item['risk'])
    risk['displayable'] = judged > 0
    if not judged:
        # 无个人作答证据时不把模型先验显示成个人薄弱程度。
        risk['probability'] = None
        if reviews == 0:
            status = InsightStatus(code='unreviewed', label='尚未复习')
            explanation = '暂无作答记录，暂不判断个人薄弱程度。'
        else:
            status = InsightStatus(code='unjudged', label='待判定对错')
            explanation = f'已复习 {reviews} 次，但暂无明确对错的作答记录，暂不判断个人薄弱程度。'
        recommendation = '先完成一次独立作答'
    else:
        high_risk = risk['probability'] >= 0.6
        status = InsightStatus(
            code='needs_review' if high_risk else 'consolidate',
            label='建议复习' if high_risk else '继续巩固',
        )
        recommendation = '优先独立重做，核对易错步骤' if high_risk else '独立复述方法，按计划巩固'
        explanation = f'已判定对错 {judged} 次，其中答错 {wrong} 次。'
        if risk['source'] == 'das3h':
            explanation += '复习建议参考已通过评估的模型预测；预测不等于实际错误率。'
        else:
            explanation += '复习建议参考作答记录的平滑估计，证据仍有限。'
    steps = ['独立作答', '核对关键步骤', '复述方法']
    return ReviewInsight(
        entry_id=item['id'], notebook_id=item['notebook_id'], as_of=as_of,
        review_count=reviews, wrong_count=wrong, status=status,
        recommendation=recommendation, importance=importance or TeachingImportance(),
        evidence=InsightEvidence(
            review_count=reviews, wrong_count=wrong, judged_count=judged,
            recent_wrong_count=item['recent_incorrect_count'],
            recent_judged_count=item['recent_judged_count'],
            observed_error_rate=wrong / judged if judged else None, explanation=explanation,
        ),
        risk=InsightRisk(**risk), due_status=item['due_status'],
        next_review_date=item['next_review_date'], knowledge_points=item['tags'],
        estimated_seconds=item['estimated_seconds'], time_estimate_source=item['time_estimate_source'],
        review_steps=steps, review_hint='复习安排提示：' + ' → '.join(steps) + '。',
        actions=[
            InsightAction(action='arrange_review', label='让助手安排复习'),
            InsightAction(action='learn_knowledge', label='学习此题知识点'),
        ],
    )
