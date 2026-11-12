"""实际 App→Workspace→NoteEditor→卡片：确认关联题组后进入同一队列，并接续判卷。"""
import json
import os
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


def run():
    user = {'id':'bundle-test','email':'bundle@example.test','full_name':'Test','is_active':True,'created_at':1}
    entries = {}
    for index,(ident,title,question) in enumerate([
        ('anchor','当前方程','解方程：x+1=2'),('unrelated','其他题目','求正方形面积'),
        ('related1','关联题一','解方程：2x=2'),('related2','关联题二','解方程：3x=3')]):
        entries[ident] = {'id':ident,'notebook_id':'book','user_id':user['id'],'title':title,'question':f'<p>{question}</p>',
            'correct_answer':'<p>x=1</p>','wrong_answer':'','subject':'数学','source':'','tags':['方程'],'drawings':{},
            'created_at':1,'updated_at':1,'sort_order':index,'review_count':0,'wrong_count':0,'mastery_level':0}
    ordered = ['anchor','related2','related1','unrelated']
    requests = []
    attempts = {}
    state = {'confirm_failure':False,'wrong_order':False}

    def api(route):
        req = route.request
        path = urlparse(req.url).path
        headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}
        if req.method == 'OPTIONS':
            route.fulfill(status=200,headers=headers)
            return
        result, status = {'items':[]},200
        if path == '/api/users/me': result=user
        elif path == '/health': result={'status':'ok'}
        elif path == '/api/notebooks': result={'items':[{'id':'book','name':'关联复习测试','created_at':1,'updated_at':1}]}
        elif path in ('/api/entries/summaries','/api/entries/search'):
            result={'items':[{**entry,'question_preview':entry['question']} for entry in entries.values()]}
        elif path.endswith('/review-insight'):
            entry_id = path.split('/')[-2]
            result={'entry_id':entry_id,'notebook_id':'book','review_count':0,'wrong_count':0,
                'status':{'code':'unreviewed','label':'尚未复习'},'recommendation':'先完成一次独立作答',
                'importance':{'code':'unassessed','label':'尚未评估'},
                'evidence':{'explanation':'暂无作答记录，暂不判断个人薄弱程度。'},
                'review_hint':'独立作答 → 核对关键步骤 → 复述方法。'}
        elif path.endswith('/review-bundle'):
            requests.append((path,req.post_data_json))
            assert req.post_data_json == {'limit':10}
            result={'anchor_entry_id':'anchor','notebook_id':'book','proposal_token':'signed-proposal','expires_at':1999999999999,
                'retrieval':{'strategy':'semantic-v2','status':'complete','candidate_count':3,'hydrated_count':3,
                    'channels':['stem','structure','graph'],'graph_available':True,'warnings':[]},
                'estimated_seconds':1200,'notices':['已保留召回补充题，关联尚未确认。'],'bundle_version':'related-review-v1','items':[
                    {'entry_id':ident,'title':entries[ident]['title'],'question_preview':entries[ident]['question'].removeprefix('<p>').removesuffix('</p>'),
                     'knowledge_points':['方程'],'estimated_seconds':300,'review_count':0,'wrong_count':0,
                     'relation':{'relation':'anchor' if ident=='anchor' else 'recalled' if ident=='unrelated' else 'same_concept',
                         'reason':'当前题目' if ident=='anchor' else '召回补充题，关联尚未确认' if ident=='unrelated' else '运用同一等式变形方法',
                         'anchor_evidence':[] if ident in ('anchor','unrelated') else ['x+1=2'],
                         'candidate_evidence':[] if ident in ('anchor','unrelated') else ['x=1']},
                     'importance':{'importance':'ordinary','reason':'单项练习','evidence':['x=1']}} for ident in ordered]}
        elif path.endswith('/review-bundle/confirm'):
            requests.append((path,req.post_data_json))
            assert req.post_data_json == {'proposal_token':'signed-proposal'}
            if state['confirm_failure']: status,result=409,{'detail':'复习题已修改，请重新组题'}
            else: result={'anchor_entry_id':'anchor','notebook_id':'book','entry_ids':list(reversed(ordered)) if state['wrong_order'] else ordered,
                          'confirmed_at':1,'bundle_version':'related-review-v1'}
        elif path.endswith('/review-attempts') or path.endswith('/explanation'):
            body=req.post_data_json
            requests.append((path,body))
            ident=path.split('/')[3]
            if path.endswith('/review-attempts'):
                attempts[ident]=body
            original=attempts[ident]
            reason=body.get('explanation_text','')
            complete=bool(reason)
            answer_correct=ident in ('anchor','related1')
            explanation_valid=ident in ('anchor','related2')
            correct=answer_correct and explanation_valid
            result={'attempt_id':original['attempt_id'],'entry_id':ident,'revision':2 if complete else 1,
                'status':'final' if complete else 'awaiting_explanation','is_correct':correct if complete else None,
                'answer_verdict':'correct' if answer_correct else 'incorrect',
                'explanation_verdict':('valid' if explanation_valid else 'invalid') if complete else 'missing',
                'answer_text':original['answer_text'],'explanation_text':reason,
                'comment':('本次判为答对。' if correct else '本次判为答错。') if complete else '请说明解题理由。',
                'followup_question':'' if complete else '请说明理由。','grading_version':'review-answer-reason-v1',
                'entry_review':{'review_count':1,'wrong_count':int(not correct),'last_review_date':1,'updated_at':2} if complete else None,
                'review_log':{'id':original['attempt_id'],'entry_id':ident,'timestamp':1,
                    'quality':'agent_correct' if correct else 'agent_incorrect','is_correct':correct,
                    'elapsed_ms':original['elapsed_ms'],'answer_text':original['answer_text'],'review_note':'已核对答案和解释'} if complete else None}
        elif path.startswith('/api/entries/') and path.split('/')[-1] in entries:
            result=entries[path.split('/')[-1]]
        elif req.method not in ('GET','OPTIONS'):
            raise AssertionError('unexpected write: '+path)
        route.fulfill(status=status,content_type='application/json',headers=headers,body=json.dumps(result))

    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,channel=os.getenv('PLAYWRIGHT_CHANNEL','msedge'))
        try:
            context=browser.new_context(viewport={'width':1440,'height':1080},service_workers='block')
            context.route('http://localhost:8000/**',api)
            context.route('https://fonts.googleapis.com/**',lambda route:route.abort())
            context.route('https://fonts.gstatic.com/**',lambda route:route.abort())
            context.add_init_script(f"localStorage.setItem('notes_app_access_token','test-token');localStorage.setItem('notes_app_current_user',{json.dumps(json.dumps(user))});localStorage.setItem('cuotiben_last_notebook:bundle-test','book')")
            page=context.new_page()
            errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto('http://127.0.0.1:5173/app/')
            page.get_by_text('当前方程',exact=True).click()
            page.get_by_test_id('review-insight-toggle').click()
            arrange=page.get_by_role('button',name='让助手安排复习',exact=True)
            expect(arrange).to_be_enabled(timeout=15000)
            arrange.click()
            preview=page.get_by_test_id('review-bundle-preview')
            expect(preview).to_contain_text('共 4 题')
            expect(preview.locator('ol > li').nth(1)).to_contain_text('关联题二')
            expect(preview.locator('ol > li').nth(2)).to_contain_text('关联题一')
            expect(preview.locator('ol > li').nth(3)).to_contain_text('召回补充题，关联尚未确认')
            expect(preview).to_contain_text('至少 3 道召回题')
            expect(preview).to_contain_text('题意相似、解题结构、知识与材料关联')
            expect(page.get_by_test_id('review-answer-input')).to_have_count(0)
            screenshot=Path('.dev-services/review-bundle-preview.png')
            preview.screenshot(path=str(screenshot))
            state['confirm_failure']=True
            page.get_by_test_id('confirm-review-bundle').click()
            expect(page.get_by_text('复习题已修改，请重新组题',exact=False)).to_be_visible()
            expect(page.get_by_test_id('review-answer-input')).to_have_count(0)
            state['confirm_failure']=False
            state['wrong_order']=True
            page.get_by_test_id('confirm-review-bundle').click()
            expect(page.get_by_text('确认返回的复习题目与预览不一致，请重新组题',exact=False)).to_be_visible()
            expect(page.get_by_test_id('review-answer-input')).to_have_count(0)
            state['wrong_order']=False
            page.get_by_test_id('confirm-review-bundle').click()
            expect(page.get_by_test_id('review-answer-input')).to_be_visible()
            expect(page.get_by_text('剩余 4 题',exact=True).first).to_be_visible()
            expect(page.get_by_text('解方程：x+1=2',exact=True)).to_be_visible()
            expect(preview).to_have_count(0)
            # Test all four answer/explanation outcomes through App -> Workspace -> Panel.
            for index,ident in enumerate(ordered):
                question=entries[ident]['question'].removeprefix('<p>').removesuffix('</p>')
                expect(page.get_by_text(question,exact=True)).to_be_visible()
                expect(page.get_by_text(f'剩余 {4-index} 题',exact=True).first).to_be_visible()
                answer=page.get_by_test_id('review-answer-input')
                expect(answer).to_have_value('')
                expect(page.get_by_test_id('next-graded-review')).to_have_count(0)
                answer.fill('x=1' if ident in ('anchor','related1') else 'x=3')
                page.get_by_test_id('submit-review-answer').click()
                expect(page.get_by_test_id('review-explanation-input')).to_be_visible()
                expect(page.get_by_test_id('next-graded-review')).to_have_count(0)
                page.get_by_test_id('review-explanation-input').fill('等式两边减去1' if ident in ('anchor','related2') else '我不清楚')
                page.get_by_test_id('submit-review-explanation').click()
                expect(page.get_by_test_id('review-explanation-input')).to_have_count(0)
                next_button=page.get_by_test_id('next-graded-review')
                expect(next_button).to_be_enabled()
                expect(next_button).to_have_text('结束复习' if index==3 else '下一题')
                expect(page.get_by_test_id('review-grade-comment')).to_contain_text('答对' if ident=='anchor' else '答错')
                next_button.click()
            expect(page.get_by_text('复习完成',exact=True)).to_be_visible()
            expect(page.get_by_text('共 4 题',exact=True)).to_be_visible()
            expect(page.get_by_test_id('review-answer-input')).to_have_count(0)
            expect(page.get_by_test_id('next-graded-review')).to_have_count(0)
            graded=[(path,body) for path,body in requests if '/review-attempts' in path]
            assert len(graded)==8,graded
            assert [path.split('/')[3] for path,body in graded if path.endswith('/review-attempts')]==ordered
            assert all('entry_ids' not in body for path,body in requests if path.endswith('/confirm'))
            assert not errors,errors
            print('PASS: full app related preview, confirm guards, exact review queue and existing grading; screenshot:',screenshot)
        except Exception:
            print('Browser state:',page.locator('body').inner_text()[:4000])
            print('Browser errors:',errors)
            page.screenshot(path='.dev-services/review-bundle-navigation-failure.png')
            raise
        finally:
            browser.close()


if __name__=='__main__': run()
