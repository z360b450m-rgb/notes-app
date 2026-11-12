"""Lazy-content browser checks with a mocked API; requires Vite at 127.0.0.1:5173."""
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright


def run():
    entries = {}
    for i in range(300):
        key = f'e{i}'
        entries[key] = dict(id=key, notebook_id='n1', title=f'Title {i}', question=f'<p>Body {i}</p>',
            wrong_answer=f'Wrong {i}', correct_answer='secret-answer-token' if i == 200 else f'Correct {i}',
            subject='Math', source='test', tags=['old'], drawings={}, sort_order=i,
            created_at=1, updated_at=1, mastery_level=0, review_count=0, next_review_date=0)
    entries['other'] = dict(entries['e0'], id='other', notebook_id='n2', title='Other notebook')
    entries['e9'].update(group_id='g1', sub_question_order=0)
    group = dict(id='g1', notebook_id='n1', title='Group', material='<p>Shared material</p>', created_at=1, updated_at=1)
    requests, writes, held, held_fonts = [], [], {}, []
    state = {'fail': None, 'hold': set(), 'offline': False}

    def api(route):
        url = urlparse(route.request.url)
        query = parse_qs(url.query)
        requests.append((route.request.method, url.path, query))
        if state['offline']:
            route.abort()
            return
        result = {'items': []}
        if url.path == '/api/users/me':
            result = dict(id='lazy-test', email='lazy@example.test', full_name=None, is_active=True, created_at=1)
        elif url.path == '/api/notebooks':
            result = {'items': [dict(id=n, name='Lazy Notebook' if n == 'n1' else 'Other', description='', instructions='', created_at=1, updated_at=1) for n in ['n1', 'n2']]}
        elif url.path == '/api/entries/search':
            raise AssertionError('Startup must not download complete notebook contents')
        elif url.path == '/api/entries/summaries':
            selected = [e for e in entries.values() if e['notebook_id'] == query['notebook_id'][0]]
            term = query.get('q', [''])[0]
            if term:
                selected = [e for e in selected if term.lower() in json.dumps(e).lower()]
            result = {'items': [{k: v for k, v in e.items() if k not in ['question', 'wrong_answer', 'correct_answer', 'drawings']} for e in selected]}
        elif url.path == '/api/question-groups/summaries':
            result = {'items': [{k: v for k, v in group.items() if k != 'material'}] if query['notebook_id'][0] == 'n1' else []}
        elif url.path == '/api/question-groups/g1':
            result = group
        elif url.path.startswith('/api/entries/') and route.request.method == 'GET':
            key = url.path.rsplit('/', 1)[1]
            if key in state['hold']:
                held[key] = route
                return
            if state['fail'] == key:
                route.fulfill(status=503, content_type='application/json', body='{}')
                return
            result = entries[key]
        elif route.request.method in ['PATCH', 'POST', 'DELETE']:
            writes.append((url.path, route.request.post_data_json))
            if route.request.method == 'PATCH' and url.path.startswith('/api/entries/'):
                entries[url.path.rsplit('/', 1)[1]].update(route.request.post_data_json)
        route.fulfill(status=200, content_type='application/json', body=json.dumps(result))

    harness = r'''<script type="module">
      import {useEntries} from '/src/composables/useEntries.ts';
      import {useFilter} from '/src/composables/useFilter.ts';
      import {useReview} from '/src/composables/useReview.ts';
      import * as db from '/src/services/db.ts';
      const source=await(await fetch('/src/composables/useEntries.ts')).text();
      const vueUrl=source.match(/from "([^"]*\/vue\.js[^"]*)"/)[1];
      const {effectScope,ref}=await import(vueUrl);
      window.scope=effectScope();
      window.state=scope.run(()=>{
        const owner=ref('n1');
        const items=useEntries(()=>owner.value);
        const filters=useFilter(items.notebookEntries,items.questionGroups,items.searchEntryIds);
        const review=useReview(items.notebookEntries,()=>owner.value,items.showToast,items.ensureEntry);
        return {owner,items,filters,review,db};
      });
      window.ready=true;
    </script>'''

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, channel=os.getenv('PLAYWRIGHT_CHANNEL', 'msedge'))
        try:
            context = browser.new_context(service_workers='block')
            context.route('https://fonts.googleapis.com/**', lambda route: held_fonts.append(route))
            context.route('https://fonts.gstatic.com/**', lambda route: route.abort())
            context.add_init_script("localStorage.setItem('notes_app_current_user',JSON.stringify({id:'lazy-test'}));localStorage.setItem('notes_app_access_token','test-token');localStorage.setItem('CuotiDB:lazy-test:legacy-migrated','true')")
            context.route('http://localhost:8000/**', api)
            context.route('**/lazy-entry-harness', lambda route: route.fulfill(content_type='text/html', body=harness))
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto('http://127.0.0.1:5173/lazy-entry-harness')
            page.wait_for_function('window.ready === true')
            page.evaluate('state.items.loadEntries()')
            assert page.evaluate('state.items.entries.value.length') == 300
            assert page.evaluate('state.items.entries.value.every(e=>e.isSummary&&!e.question&&!e.correctAnswer)')
            assert page.evaluate("state.db.indexedDbEntryRepository.getAll('n1').then(items=>items.length)") == 0
            assert not [r for r in requests if r[1].startswith('/api/entries/e')]

            page.evaluate("state.items.loadEntry('e0')")
            assert page.evaluate('state.items.activeEntry.value.question') == '<p>Body 0</p>'
            before = len(requests)
            page.evaluate("state.items.loadEntry('e0')")
            assert len(requests) == before, 'Already-loaded entries must reuse content'

            state['hold'].add('e1')
            page.evaluate("void state.items.loadEntry('e1')")
            page.wait_for_function('state.items.detailLoading.value')
            page.wait_for_timeout(100)
            assert 'e1' in held
            page.evaluate("state.items.loadEntry('e2')")
            held.pop('e1').fulfill(status=200, content_type='application/json', body=json.dumps(entries['e1']))
            state['hold'].remove('e1')
            page.wait_for_timeout(100)
            assert page.evaluate('state.items.activeEntry.value.id') == 'e2'
            assert not page.evaluate('state.items.detailLoading.value')

            page.evaluate("state.filters.setSearch('secret-answer-token')")
            page.wait_for_function("!state.filters.searchLoading.value && state.filters.filteredEntries.value.length===1")
            assert page.evaluate('state.filters.filteredEntries.value[0].id') == 'e200'
            assert page.evaluate("state.items.entries.value.find(e=>e.id==='e200').isSummary")
            assert not [r for r in requests if r[1] == '/api/entries/e200']
            page.evaluate("state.filters.setSearch('')")

            page.evaluate("state.items.batchTag(['e201','e202'],['new-tag'])")
            page.wait_for_function("JSON.parse(localStorage.getItem('offline_pending_sync_queue_v1:lazy-test')||'[]').length===0")
            tagged = [body for path, body in writes if path in ['/api/entries/e201', '/api/entries/e202']]
            assert len(tagged) == 2
            assert all(body['correct_answer'] and body['question'] and 'new-tag' in body['tags'] for body in tagged)
            assert not [r for r in requests if r[1] == '/api/entries/e203']

            page.evaluate("state.items.loadEntry('e203')")
            entries['e203'].update(correct_answer='Updated answer', updated_at=20)
            page.evaluate('state.items.loadEntries()')
            assert page.evaluate('state.items.activeEntry.value.correctAnswer') == 'Updated answer'
            assert len([r for r in requests if r[1] == '/api/entries/e203']) == 2
            page.evaluate("state.items.activeEntry.value.correctAnswer='Unsaved draft';state.items.markDirty()")
            entries['e203'].update(correct_answer='Latest server answer', updated_at=30)
            page.evaluate('state.items.loadEntries()')
            assert page.evaluate('state.items.activeEntry.value.correctAnswer') == 'Unsaved draft'
            page.evaluate('state.items.discardChanges()')
            assert page.evaluate('state.items.activeEntry.value.correctAnswer') == 'Latest server answer'

            state['offline'] = True
            page.evaluate("state.filters.setSearch('Correct 201')")
            page.wait_for_function('!state.filters.searchLoading.value && !!state.filters.searchError.value')
            assert page.evaluate('state.filters.searchError.value').startswith('当前只能搜索已缓存')
            assert page.evaluate("state.filters.filteredEntries.value.some(e=>e.id==='e201')")
            state['offline'] = False
            page.evaluate("state.filters.setSearch('')")

            state['fail'] = 'e6'
            page.evaluate("state.items.loadEntry('e6')")
            assert page.evaluate('!!state.items.detailError.value')
            assert page.evaluate('state.items.activeEntry.value === undefined')
            state['fail'] = None
            page.evaluate("state.items.loadEntry('e6')")
            assert page.evaluate('state.items.activeEntry.value.id') == 'e6'
            page.evaluate("state.items.loadEntry('e9')")
            assert page.evaluate('state.items.activeGroup.value.material') == group['material']

            assert page.evaluate("""async()=>{
              state.items.activeId.value='e7';
              if(await state.items.saveEntry())return false;
              try {await state.db.entryRepository.put('n1',JSON.parse(JSON.stringify(state.items.entries.value.find(e=>e.id==='e7'))));return false}
              catch{return true}
            }""")
            with page.expect_download() as download:
                page.evaluate("state.items.batchExport(['e8'])")
            exported = json.loads(Path(download.value.path()).read_text(encoding='utf8'))
            assert exported[0]['correctAnswer'] == 'Correct 8'
            assert not exported[0].get('isSummary')

            state['hold'].add('e4')
            page.evaluate("void state.items.loadEntry('e4')")
            page.wait_for_timeout(100)
            page.evaluate("async()=>{state.owner.value='n2';await state.items.loadEntries()}")
            held.pop('e4').fulfill(status=200, content_type='application/json', body=json.dumps(entries['e4']))
            state['hold'].remove('e4')
            page.wait_for_timeout(100)
            assert page.evaluate("state.items.entries.value.every(e=>e.notebookId==='n2')")
            assert page.evaluate('state.items.activeId.value === null')

            page.evaluate("async()=>{state.owner.value='n1';await state.items.loadEntries()}")
            assert page.evaluate("state.review.startReview({scope:'all',random:false,limit:3})")
            page.wait_for_function('!state.review.cardLoading.value && !!state.review.currentCard.value')
            page.wait_for_function("!state.items.entries.value.find(e=>e.id==='e1').isSummary")
            assert page.evaluate("state.items.entries.value.find(e=>e.id==='e200').isSummary")
            page.evaluate("state.review.revealAnswer();state.review.rateCard('good')")
            page.wait_for_function("!state.review.cardLoading.value&&state.review.currentCard.value?.id==='e1'")
            assert page.evaluate('state.review.currentCard.value.correctAnswer') == 'Correct 1'
            assert not errors, errors

            # Exercise the actual page and loading UI with the same isolated API.
            ui = context.new_page()
            ui.on('pageerror', lambda error: errors.append(str(error)))
            ui.goto('http://127.0.0.1:5173/', wait_until='domcontentloaded')
            expect(ui.get_by_text('Lazy Notebook', exact=True).first).to_be_visible()
            ui.get_by_text('Lazy Notebook', exact=True).first.click()
            expect(ui.locator('[data-entry-id="e0"]')).to_be_visible()
            ui.locator('[data-entry-id="e0"]').click()
            expect(ui.get_by_test_id('panel-module-question')).to_contain_text('Body 0')
            assert held_fonts, 'Exercise startup with an unresponsive font stylesheet'
            for route in held_fonts:
                route.abort()
            held_fonts.clear()
            state['fail'] = 'e11'
            ui.locator('[data-entry-id="e11"]').click()
            expect(ui.get_by_role('button', name='重试加载', exact=True)).to_be_visible()
            state['fail'] = None
            ui.get_by_role('button', name='重试加载', exact=True).click()
            expect(ui.get_by_test_id('panel-module-question')).to_contain_text('Body 11')
            ui.screenshot(path=str(Path(__file__).resolve().parents[2] / '.dev-services' / 'lazy-loading-verified.png'))
            assert not errors, errors
            print('PASS: metadata-only startup, cached detail reads, fast switching, unloaded-answer search, safe batch writes/export, group content, retry, notebook switching and review prefetch')
        finally:
            for route in held_fonts:
                route.abort()
            for route in held.values():
                route.abort()
            context.unroute_all(behavior='ignoreErrors')
            browser.close()


if __name__ == '__main__':
    run()
