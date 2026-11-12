"""真实 ReviewPanel + useReview：单次核对、可选理由、待核对切题与追问不重复记账。需运行 Vite。"""
import json
import os
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

HARNESS = r'''<html><head><meta charset="UTF-8"></head><body>
<div id="app" style="height:100vh"></div><script type="module">
import Panel from '/src/components/ReviewPanel.vue';
import {useReview} from '/src/composables/useReview.ts';
import {createEntryLearningConversations,entryLearningConversationsKey} from '/src/composables/useEntryLearningConversation.ts';
import '/src/style.css';import '/src/ui-theme.css';import '/src/interaction-ui.css';
const source=await(await fetch('/src/components/ReviewPanel.vue')).text();
const vueUrl=source.match(/from "([^"]*\/vue\.js[^"]*)"/)[1];
const {createApp,h,ref,provide}=await import(vueUrl);
createApp({setup(){
 provide(entryLearningConversationsKey,createEntryLearningConversations());
 const entries=ref([{id:'entry',notebookId:'book',title:'方程题',question:'解方程 x+1=2，正确答案是？<br>A. x=1<br>B. x=3<br>C. x=4<br>D. x=5',
 correctAnswer:'A. x=1',wrongAnswer:'',subject:'数学',source:'',tags:['方程'],createdAt:1,updatedAt:1,reviewCount:0}]);
 const r=useReview(entries,()=> 'book');window.review=r;window.entries=entries;
 r.startReview({scope:'all',random:false});
 window.restart=()=>{r.exitReview();r.startReview({scope:'all',random:false})};window.ready=true;
 return()=>h(Panel,{entry:r.currentCard.value,answered:r.answered.value,submitting:r.savingReview.value,
 gradingAttempt:r.gradingAttempt.value,gradingError:r.gradingError.value,gradingLocked:r.gradingLocked.value,
 elapsedMs:r.elapsedMs.value,progress:r.progress.value,progressPercent:r.progressPercent.value,
 dueCount:r.dueCount.value,reviewedToday:r.reviewedToday.value,isReviewing:r.isReviewing.value,
 sessionDone:r.sessionDone.value,sessionRecords:r.sessionRecords.value,totalSessionMs:r.totalSessionMs.value,
 reviewQueue:r.reviewQueue.value,entries:entries.value,
 onRate:(rating,note,outcome)=>r.rateCard(rating,note,outcome),onOutcomeChange:r.setReviewOutcome,
 onExplain:r.explainReview,onRetryGrading:r.retryGrading,onNextReview:r.nextGradedCard,
 onExitReview:r.exitReview,onDismissSummary:r.dismissSummary});
}}).mount('#app');
</script></body></html>'''


def run():
    state = {'mode': 'normal', 'count': 0, 'wrong': 0, 'followup_failure': False, 'evaluations': 0}
    attempts, requests, followups = {}, [], []

    def api(route):
        request = route.request
        headers = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
                   'Access-Control-Allow-Methods': '*'}
        if request.method == 'OPTIONS':
            route.fulfill(status=200, headers=headers)
            return
        assert request.headers.get('authorization') == 'Bearer test-token'
        path, body = urlparse(request.url).path, request.post_data_json
        if path.endswith('/review-assistant'):
            followups.append(body)
            route.fulfill(status=503 if state['followup_failure'] else 200,
                          content_type='application/json', headers=headers,
                          body=json.dumps({'detail': '讲解服务暂时不可用'} if state['followup_failure'] else
                                          {'answer': '两边同时减去相同的数，等式仍然成立。'}))
            return
        assert request.method == 'POST' and '/review-attempts' in path, path
        requests.append((path, body))
        if state['mode'] == 'failure':
            route.fulfill(status=503, content_type='application/json', headers=headers,
                          body=json.dumps({'detail': '服务未连接，作答已保留'}))
            return
        is_reason = path.endswith('/explanation')
        ident = path.split('/')[-2] if is_reason else body['attempt_id']
        previous = attempts.get(ident)
        if previous and previous['evaluation_completed']:
            route.fulfill(content_type='application/json', headers=headers, body=json.dumps(previous))
            return
        answer = previous['answer_text'] if is_reason else body['answer_text']
        reason = body['explanation_text'] if is_reason else ''
        pending = not reason and '因为' not in answer
        wrong = '选项：B' in answer or 'x=3' in answer or '蒙' in (reason or answer)
        unknown = state['mode'] in ('unknown', 'model_error') and not pending
        result = {'attempt_id': ident, 'entry_id': path.split('/')[3],
            'revision': previous['revision']+1 if is_reason else 1,
            'answer_text': answer, 'explanation_text': reason, 'review_log': None, 'entry_review': None,
            'status': 'awaiting_explanation' if pending else 'needs_review' if unknown else 'final',
            'is_correct': None if unknown or pending else not wrong,
            'answer_verdict': 'uncertain' if unknown or pending else 'incorrect' if wrong else 'correct',
            'explanation_verdict': 'missing' if pending else 'uncertain' if unknown else 'invalid' if '蒙' in (reason or answer) else 'valid',
            'comment': '请说明解题理由。' if pending else '本题暂时无法可靠判定。' if unknown else '本次判为答错。' if wrong else '本次判为答对。',
            'followup_question': '', 'grading_version': 'review-single-pass-v2',
            'evaluation_completed': not pending, 'issue': 'model_error' if state['mode'] == 'model_error' else None}
        if not pending:
            state['evaluations'] += 1
        if state['mode'] == 'malformed':
            result.update(status='final', answer_verdict='uncertain', is_correct=False)
            route.fulfill(content_type='application/json', headers=headers, body=json.dumps(result))
            return
        if not unknown and not pending:
            state['count'] += 1
            state['wrong'] += int(wrong)
            result.update(review_log={'id': ident, 'entry_id': result['entry_id'], 'timestamp': 1791806400000,
                'quality': 'agent_incorrect' if wrong else 'agent_correct', 'is_correct': not wrong,
                'elapsed_ms': body.get('elapsed_ms', 1000), 'answer_text': answer, 'review_note': result['comment']},
                entry_review={'review_count': state['count'], 'wrong_count': state['wrong'],
                              'last_review_date': 1791806400000, 'updated_at': 1791806400000})
        attempts[ident] = result
        route.fulfill(content_type='application/json', headers=headers, body=json.dumps(result))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.getenv('PLAYWRIGHT_CHANNEL', 'msedge'))
        try:
            context = browser.new_context(viewport={'width': 1200, 'height': 1100}, service_workers='block')
            context.route('http://localhost:8000/**', api)
            context.route('**/review-grading-harness', lambda route: route.fulfill(content_type='text/html', body=HARNESS))
            context.route('https://fonts.googleapis.com/**', lambda route: route.abort())
            context.route('https://fonts.gstatic.com/**', lambda route: route.abort())
            context.add_init_script("localStorage.setItem('notes_app_access_token','test-token')")
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(os.getenv('VITE_TEST_URL', 'http://127.0.0.1:5173') + '/review-grading-harness')
            page.wait_for_function('window.ready')
            answer = page.get_by_test_id('review-answer-input')
            submit = page.get_by_test_id('submit-review-answer')
            next_button = page.get_by_test_id('next-graded-review')
            discuss = page.get_by_test_id('continue-review-discussion')

            # Choosing A first collects a reason without grading; submitting it grades once.
            page.get_by_role('radio').first.click()
            submit.click()
            expect(page.get_by_test_id('review-explanation-input')).to_be_visible()
            expect(next_button).to_have_count(0)
            expect(page.get_by_text('参考答案与解析', exact=True)).to_have_count(0)
            assert state['evaluations'] == 0 and state['count'] == 0
            page.get_by_test_id('review-explanation-input').fill('等式两边减去1')
            page.get_by_test_id('submit-review-explanation').click()
            expect(next_button).to_have_text('结束复习')
            expect(page.get_by_text('参考答案与解析', exact=True)).to_be_visible()
            expect(discuss).to_be_enabled()
            expect(page.get_by_test_id('review-explanation-input')).to_have_count(0)
            expect(page.get_by_test_id('submit-review-explanation')).to_have_count(0)
            assert len(requests) == 2 and state['count'] == 1
            page.evaluate('window.review.retryGrading()')
            page.evaluate("window.review.explainReview('新理由')")
            assert len(requests) == 2 and state['evaluations'] == 1

            # Follow-ups share a session and never trigger grading or change the score.
            discuss.click()
            dialog = page.get_by_role('dialog', name='继续追问', exact=True)
            page.get_by_test_id('review-followup-input').fill('为什么两边都减去1？')
            page.get_by_test_id('send-review-followup').click()
            expect(dialog.get_by_test_id('entry-review-assistant-answer')).to_contain_text('等式仍然成立')
            assert '选项：A' in followups[-1]['message']
            session_id = followups[-1]['session_id']
            state['followup_failure'] = True
            page.get_by_test_id('review-followup-input').fill('能再举一个例子吗？')
            page.get_by_test_id('send-review-followup').click()
            expect(dialog.get_by_role('alert')).to_contain_text('讲解服务暂时不可用')
            state['followup_failure'] = False
            dialog.get_by_role('button', name='重试回复', exact=True).click()
            expect(dialog.get_by_role('alert')).to_have_count(0)
            assert followups[-1]['session_id'] == session_id
            dialog.get_by_role('button', name='返回复习', exact=True).click()
            assert len(requests) == 2 and state['count'] == 1
            next_button.click()
            expect(page.get_by_text('复习完成', exact=True)).to_be_visible()

            # Answer plus explanation is also a single request.
            page.evaluate('window.restart()')
            page.get_by_role('radio').first.click()
            answer.fill('因为等式两边减去1，得到x=1')
            submit.click()
            expect(next_button).to_be_enabled()
            assert len(requests) == 3 and state['count'] == 2 and state['evaluations'] == 2
            expect(page.get_by_test_id('review-explanation-input')).to_have_count(0)

            page.evaluate('window.restart()')
            page.get_by_role('radio').nth(1).click()
            answer.fill('因为我是蒙的')
            submit.click()
            expect(next_button).to_be_enabled()
            expect(page.get_by_test_id('review-grade-comment')).to_contain_text('答错')
            assert state['wrong'] == 1 and state['count'] == 3

            # Uncertainty and model errors still finish the workflow, without inventing a score.
            for mode in ('unknown', 'model_error'):
                page.evaluate('window.restart()')
                state['mode'] = mode
                answer.fill('x=1，因为两边都减去1')
                submit.click()
                expect(next_button).to_be_enabled()
                expect(discuss).to_be_enabled()
                expect(page.get_by_test_id('review-explanation-input')).to_have_count(0)
                expect(page.get_by_test_id('retry-review-submission')).to_have_count(0)
                before = len(requests)
                page.evaluate('window.review.retryGrading()')
                assert len(requests) == before
                next_button.click()
                expect(page.get_by_text('复习完成', exact=True)).to_be_visible()
                expect(page.get_by_text('待核对', exact=True)).to_be_visible()
                assert page.evaluate('window.review.sessionRecords.value[0].isCorrect ?? null') is None
                assert state['count'] == 3 and state['wrong'] == 1

            # A transport failure may resend the same attempt; there was no grade to repeat.
            page.evaluate('window.restart()')
            state['mode'] = 'failure'
            answer.fill('x=1，因为两边减去1')
            submit.click()
            expect(page.get_by_role('alert')).to_contain_text('作答已保留')
            frozen = requests[-1][1]['attempt_id']
            state['mode'] = 'normal'
            submit.click()
            expect(next_button).to_be_enabled()
            assert requests[-1][1]['attempt_id'] == frozen and state['count'] == 4

            # Moving cards clears inputs; the last card ends the session.
            page.evaluate("window.entries.value.push({...window.entries.value[0],id:'entry-2'});window.restart()")
            page.get_by_role('radio').first.click()
            answer.fill('因为两边减去1')
            submit.click()
            expect(next_button).to_have_text('下一题')
            next_button.click()
            expect(answer).to_have_value('')
            expect(discuss).to_have_count(0)
            assert page.evaluate('window.review.currentCard.value.id') == 'entry-2'
            page.get_by_role('radio').first.click()
            answer.fill('因为两边减去1')
            submit.click()
            expect(next_button).to_have_text('结束复习')
            page.screenshot(path='.dev-services/review-single-pass-complete.png')
            next_button.click()
            assert page.evaluate('window.review.sessionRecords.value.length') == 2
            assert state['count'] == 6

            # An invalid claimed final grade cannot bypass response validation.
            page.evaluate('window.restart()')
            state['mode'] = 'malformed'
            answer.fill('x=3，因为我不清楚')
            submit.click()
            expect(page.get_by_role('alert')).to_contain_text('判卷结果格式无效')
            expect(next_button).to_have_count(0)
            page.evaluate('window.review.nextGradedCard()')
            assert page.evaluate('window.review.reviewIndex.value') == 0
            assert state['count'] == 6
            assert all('is_correct' not in body for _, body in requests)
            assert not errors, errors
            print('single-pass review browser checks passed')
        finally:
            browser.close()


if __name__ == '__main__':
    run()
