"""Real review storage, UI, keyboard outcomes and failed-save counter checks; requires Vite."""
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


HARNESS = r'''<html><head><meta charset="UTF-8"></head><body><div id="app" style="height:100vh"></div><script type="module">
import ReviewPanel from '/src/components/ReviewPanel.vue';
import NoteEditor from '/src/components/NoteEditor.vue';
import {useReview} from '/src/composables/useReview.ts';
import {useKeyboard} from '/src/composables/useKeyboard.ts';
import '/src/style.css';
import '/src/ui-theme.css';
const source=await(await fetch('/src/composables/useReview.ts')).text();
const vueUrl=source.match(/from "([^"]*\/vue\.js[^"]*)"/)[1];
const {createApp,h,ref}=await import(vueUrl);
const logsUrl=source.match(/from "([^"]*\/useReviewLogs\.ts[^"]*)"/)[1];
const {useReviewLogs}=await import(logsUrl);
const dbUrl=source.match(/from "([^"]*\/services\/db\.ts[^"]*)"/)[1];
const db=await import(dbUrl);
const entries=ref([{id:'entry',notebookId:'book',title:'Count test',question:'说明理由',
  correctAnswer:'参考答案',wrongAnswer:'原始错误',subject:'数学',source:'',tags:[],createdAt:1,updatedAt:1}]);
await db.entryRepository.put('book',JSON.parse(JSON.stringify(entries.value[0])));
createApp({setup(){
  const review=useReview(entries,()=> 'book');
  const logs=useReviewLogs(()=> 'book');
  const noop=()=>{};
  useKeyboard({onCreate:noop,onSave:noop,onToggleReveal:noop,onPrev:noop,onNext:noop,
    mode:review.mode,isReviewing:review.isReviewing,answered:review.answered,
    revealAnswer:review.revealAnswer,rateCard:review.rateCard});
  window.test={review,logs,entries,db};
  return ()=>h('div',{class:'h-full flex flex-col'},[
    h('div',{class:'flex-1 min-h-0 flex flex-col',style:{display:review.mode.value==='edit'?'':'none'}},[
      h(NoteEditor,{entry:entries.value[0],entries:entries.value,answersHidden:false})]),
    h('div',{class:'flex-1 min-h-0 flex flex-col',style:{display:review.mode.value==='review'?'':'none'}},[
    review.mode.value==='review' ? h(ReviewPanel,{entry:review.currentCard.value,entries:entries.value,
      answered:review.answered.value,elapsedMs:review.elapsedMs.value,progress:review.progress.value,
      submitting:review.savingReview.value,
      progressPercent:review.progressPercent.value,dueCount:review.dueCount.value,
      reviewedToday:review.reviewedToday.value,isReviewing:review.isReviewing.value,
      sessionDone:review.sessionDone.value,sessionRecords:review.sessionRecords.value,
      totalSessionMs:review.totalSessionMs.value,reviewQueue:review.reviewQueue.value,
      onReveal:review.revealAnswer,onRate:review.rateCard,onOutcomeChange:review.setReviewOutcome,
      onExitReview:review.exitReview,onDismissSummary:review.dismissSummary}) : null])]);
}}).mount('#app');
await window.test.review.loadLogs();
window.ready=true;
</script></body></html>'''


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.getenv('PLAYWRIGHT_CHANNEL', 'msedge'))
        try:
            context = browser.new_context(viewport={'width': 1440, 'height': 1000}, service_workers='block')
            context.route('https://fonts.googleapis.com/**', lambda route: route.abort())
            context.route('https://fonts.gstatic.com/**', lambda route: route.abort())
            context.route('**/learning-counts-harness', lambda route: route.fulfill(content_type='text/html', body=HARNESS))
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto('http://127.0.0.1:5173/learning-counts-harness')
            try:
                page.wait_for_function('window.ready', timeout=10000)
            except Exception:
                print('Harness errors:', errors)
                raise
            counts = page.get_by_test_id('entry-learning-counts')
            expect(counts).to_have_text('复习 0 次 · 答错 0 次')

            def start():
                page.evaluate("test.review.startReview({scope:'all',random:false})")
                page.wait_for_function("test.review.mode.value==='review'")

            def finish(total, wrong):
                page.wait_for_function('test.review.sessionDone.value')
                assert page.evaluate('test.entries.value[0].reviewCount') == total
                assert page.evaluate('test.entries.value[0].wrongCount') == wrong
                page.evaluate('test.review.dismissSummary()')
                expect(counts).to_have_text(f'复习 {total} 次 · 答错 {wrong} 次')

            start()
            answer = page.get_by_role('textbox', name='我的作答', exact=True)
            expect(answer).to_be_visible()
            expect(page.get_by_text('错误答案', exact=True)).to_be_hidden()
            expect(page.get_by_text('正确答案', exact=True)).to_be_hidden()
            expect(page.get_by_role('button', name='答错', exact=True)).to_have_count(0)
            expect(page.get_by_role('button', name='3 已掌握 晋级')).to_have_count(0)
            submit = page.get_by_test_id('submit-review-answer')
            expect(submit).to_be_disabled()
            answer.fill('独立作答：x=')
            answer.press('1')
            answer.press('2')
            answer.press('3')
            assert page.evaluate('test.entries.value[0].reviewCount??0') == 0
            expect(answer).to_have_value('独立作答：x=123')
            page.locator('body').click(position={'x': 5, 'y': 5})
            page.keyboard.press('3')
            assert page.evaluate('test.entries.value[0].reviewCount??0') == 0
            page.screenshot(path='.dev-services/review-answer-only.png', full_page=True)
            submit.click()
            finish(1, 0)
            assert page.evaluate('test.logs.reviewLogs.value[0].isCorrect===undefined')
            assert page.evaluate('test.logs.reviewLogs.value[0].quality') == 'submitted'
            assert page.evaluate('test.entries.value[0].masteryLevel===undefined')
            assert page.evaluate('test.entries.value[0].consecutivePasses===undefined')
            assert page.evaluate('test.logs.reviewLogs.value[0].answerText') == '独立作答：x=123'
            assert page.evaluate('test.entries.value[0].wrongAnswer') == '原始错误'

            start()
            expect(answer).to_have_value('')
            # Legacy explicit outcomes still count independently of rating.
            page.evaluate("test.review.revealAnswer();test.review.rateCard('mastered','',{isCorrect:false})")
            finish(2, 1)

            start()
            answer.fill('第二次独立作答')
            before = page.evaluate('({mastery:test.entries.value[0].masteryLevel,passes:test.entries.value[0].consecutivePasses,next:test.entries.value[0].nextReviewDate})')
            submit.click()
            finish(3, 1)
            assert page.evaluate('({mastery:test.entries.value[0].masteryLevel,passes:test.entries.value[0].consecutivePasses,next:test.entries.value[0].nextReviewDate})') == before
            assert page.evaluate("test.logs.reviewLogs.value[2].isCorrect===undefined")

            # A failed log write must restore the saved counters and allow retry.
            start()
            answer.fill('失败后重试的作答')
            page.evaluate("test.originalAdd=test.db.reviewLogRepository.add;test.db.reviewLogRepository.add=async()=>{throw new Error('test log failure')};true")
            submit.click()
            page.wait_for_function('test.entries.value[0].reviewCount===3')
            page.wait_for_function("test.db.entryRepository.get('book','entry').then(e=>e.reviewCount===3)")
            assert not page.evaluate('test.review.sessionDone.value')
            expect(answer).to_have_value('失败后重试的作答')
            expect(submit).to_be_enabled()
            page.evaluate('test.db.reviewLogRepository.add=test.originalAdd;true')
            submit.click()
            finish(4, 1)

            # Double submission increments only once; multiple choice judges automatically.
            page.evaluate(r"test.entries.value[0].question='选出正确选项\nA. 甲\nB. 乙';test.entries.value[0].correctAnswer='答案：A'")
            start()
            page.get_by_role('button', name='B 乙').click()
            expect(page.get_by_text('回答错误', exact=False)).to_have_count(0)
            assert page.evaluate('test.entries.value[0].reviewCount') == 4
            page.get_by_role('button', name='A 甲').click()
            page.get_by_role('button', name='B 乙').click()
            page.evaluate("Promise.all([test.review.rateCard('submitted'),test.review.rateCard('submitted')])")
            finish(5, 2)
            assert page.evaluate('test.logs.reviewLogs.value.length') == 5
            assert page.evaluate("test.db.reviewLogRepository.getAll('book').then(logs=>logs.find(log=>log.answerText)?.answerText)") == '独立作答：x=123'

            # Reload durable records rather than relying on current reactive state.
            page.evaluate("test.db.entryRepository.get('book','entry').then(e=>test.entries.value=[e])")
            page.evaluate('test.review.loadLogs()')
            expect(counts).to_have_text('复习 5 次 · 答错 2 次')
            page.get_by_test_id('entry-review-history-toggle').click()
            expect(page.get_by_text('未判定', exact=True).first).to_be_visible()
            screenshot = Path('.dev-services/learning-counts.png')
            page.screenshot(path=str(screenshot), full_page=True)
            assert not errors, errors
            print('PASS: answer-only UI, no rating shortcuts, neutral submission, choices, duplicate saves, failure retry and persistence')
        finally:
            browser.close()


if __name__ == '__main__':
    run()
