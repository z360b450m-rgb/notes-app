import base64
import asyncio
import copy
import hashlib
import json
import os
import time
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch, AsyncMock, MagicMock

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from src.db_sql.main import app
from src.db_sql.auth import get_current_user
from src.db_sql.database import Base, get_db
from src.db_sql.models import UserModel, NotebookModel, NoteEntryModel, QuestionGroupModel, ReviewLogModel
from src.db_sql import pdf_question_import as store
from src.db_sql.routers import pdf_question_imports as api
PROCESS_JOB=api.process_job

SOURCE=b'%PDF-1.7\nfixture'
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=')
KEY='asset-'+hashlib.sha256(PNG).hexdigest()[:24]


def parsed():
    def question(key, number, group):
        return dict(key=key,source_number=number,title='第'+number+'题',stem='Choose an answer',kind='choice',
            options=[{'key':'A','text':'first'},{'key':'B','text':'second'}],asset_keys=[KEY],group_key=group,
            source_pages=[2],source_block_ids=['p2-b1'],correct_answer='',explanation='',student_answer='',warnings=[],answer_status='missing')
    return {'schema_version':'pdf-question-draft-v1','filename':'fixture.pdf','source_sha256':hashlib.sha256(SOURCE).hexdigest(),
        'page_count':2,'mineru_version':'3.4.5','questions':[question('q1','1','g1'),question('q2','2','g1')],
        'groups':[dict(key='g1',title='共享材料',material_text='Original shared passage',asset_keys=[KEY],block_ids=['p2-b0'],
                       decision='suggested',question_keys=['q1','q2'],warnings=[])],
        'assets':[dict(key=KEY,sha256=hashlib.sha256(PNG).hexdigest(),mime='image/png',width=1,height=1,
                       page_number=2,bbox=[0,0,1,1],content_base64=base64.b64encode(PNG).decode())],
        'notices':['Confirm before saving']}


class PdfImportTests(unittest.TestCase):
    def test_cancel_is_idempotent_scoped_and_does_not_insert_questions(self):
        job_id=self.upload().json()['id']
        job=store.read_job('alice',job_id)
        job.update(status='parsing')
        store.write_job(job)
        client=MagicMock()
        client.__aenter__=AsyncMock(return_value=client)
        client.__aexit__=AsyncMock(return_value=None)
        response=MagicMock()
        response.json.return_value={'status':'cancellation_requested'}
        client.post=AsyncMock(return_value=response)
        with patch.object(api.httpx,'AsyncClient',return_value=client):
            result=self.client.post(f'/api/question-imports/{job_id}/cancel',headers={'Authorization':'Bearer test'})
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(result.json()['status'],'cancelled')
            self.assertEqual(self.client.post(f'/api/question-imports/{job_id}/cancel').status_code,200)
            client.post.assert_awaited_once()
            self.assertEqual(client.post.call_args.kwargs['headers']['Authorization'],'Bearer test')
            app.dependency_overrides[get_current_user]=lambda:SimpleNamespace(id='bob')
            self.assertEqual(self.client.post(f'/api/question-imports/{job_id}/cancel').status_code,404)
        self.assertEqual(self.db.query(NoteEntryModel).count(),0)
        self.assertEqual(self.db.query(ReviewLogModel).count(),0)

    def test_cancelled_job_ignores_late_parser_response(self):
        job_id=self.upload().json()['id']
        job=store.read_job('alice',job_id)
        job.update(status='uploaded')
        store.write_job(job)
        client=MagicMock()
        client.__aenter__=AsyncMock(return_value=client)
        client.__aexit__=AsyncMock(return_value=None)
        async def late_result(*args,**kwargs):
            current=store.read_job('alice',job_id)
            current.update(status='cancelled',message='cancelled')
            store.write_job(current)
            result=MagicMock(status_code=200,content=b'{}')
            result.json.return_value=parsed()
            return result
        client.post=AsyncMock(side_effect=late_result)
        with patch.object(api.httpx,'AsyncClient',return_value=client), patch.object(api,'accept_parsed') as accept:
            asyncio.run(PROCESS_JOB('alice',job_id,'Bearer test'))
            accept.assert_not_called()
        self.assertEqual(store.read_job('alice',job_id)['status'],'cancelled')

    def setUp(self):
        self.addCleanup(patch.stopall)
        self.temp=TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        patch.dict(os.environ,{'PDF_IMPORT_STORAGE_DIR':self.temp.name}).start()
        engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.db=Session(engine)
        self.addCleanup(engine.dispose)
        self.addCleanup(self.db.close)
        for owner in ('alice','bob'):
            self.db.add(UserModel(id=owner,email=owner+'@example.test',hashed_password='unused'))
            self.db.add(NotebookModel(id=owner,user_id=owner,name=owner))
        self.db.commit()
        app.dependency_overrides[get_current_user]=lambda:SimpleNamespace(id='alice')
        app.dependency_overrides[get_db]=lambda:self.db
        self.addCleanup(app.dependency_overrides.clear)
        self.client=TestClient(app)
        self.addCleanup(self.client.close)
        async def process(owner,job_id,authorization):
            job=store.read_job(owner,job_id)
            store.accept_parsed(job,parsed())
        patch.object(api,'process_job',side_effect=process).start()

    def upload(self, notebook='alice', name='fixture.pdf', data=SOURCE):
        return self.client.post('/api/question-imports',data={'notebook_id':notebook},files={'file':(name,data,'application/pdf')})

    def draft(self, job_id):
        result=self.client.get(f'/api/question-imports/{job_id}/draft')
        self.assertEqual(result.status_code,200,result.text)
        return result.json()

    def confirm(self, job_id, revision=1, keys=None, **extra):
        return self.client.post(f'/api/question-imports/{job_id}/confirm',json={
            'expected_revision':revision,'question_keys':keys or ['q1','q2'],'reviewed':True,**extra})

    def edits(self,draft):
        allowed={'key','title','stem','kind','options','group_key','correct_answer','explanation','student_answer'}
        return {'expected_revision':draft['revision'],
            'questions':[{k:v for k,v in q.items() if k in allowed} for q in draft['draft']['questions']],
            'groups':[{k:g[k] for k in ('key','title','material_text')} for g in draft['draft']['groups']]}

    def test_300_page_draft_accepts_last_page_and_rejects_301_pages(self):
        payload=parsed()
        payload['page_count']=300
        payload['assets'][0]['page_number']=300
        payload['questions'][0]['source_pages']=[300]
        self.assertEqual(store.ParsedDraft.model_validate(payload).page_count,300)
        payload['page_count']=301
        with self.assertRaises(ValueError):
            store.ParsedDraft.model_validate(payload)

    def test_upload_preview_and_asset_do_not_write_questions_or_reviews(self):
        response=self.upload()
        self.assertEqual(response.status_code,200,response.text)
        job_id=response.json()['id']
        draft=self.draft(job_id)
        self.assertEqual(draft['status'],'ready_for_review')
        self.assertEqual(len(draft['draft']['questions']),2)
        self.assertEqual(len(draft['draft']['groups']),1)
        self.assertNotIn('content_base64',draft['draft']['assets'][0])
        self.assertEqual(self.db.query(NoteEntryModel).count(),0)
        self.assertEqual(self.db.query(ReviewLogModel).count(),0)
        url=draft['draft']['assets'][0]['url']
        asset=self.client.get(url)
        self.assertEqual(asset.status_code,200)
        self.assertEqual(asset.content,PNG)
        self.assertEqual(self.client.get(url.replace(KEY,'asset-'+'0'*24)).status_code,403)
        self.assertEqual(self.client.get(url.split('?')[0]+'?token=bad').status_code,403)

    def test_confirm_is_atomic_and_idempotent_and_counts_stay_zero(self):
        job_id=self.upload().json()['id']
        first=self.confirm(job_id)
        self.assertEqual(first.status_code,200,first.text)
        self.assertEqual(first.json()['importedCount'],2)
        self.assertEqual(self.confirm(job_id).json(),first.json())
        entries=self.db.query(NoteEntryModel).all()
        self.assertEqual(len(entries),2)
        self.assertEqual(self.db.query(QuestionGroupModel).count(),1)
        self.assertEqual(len({e.group_id for e in entries}),1)
        self.assertEqual([e.sub_question_order for e in entries],[1,2])
        self.assertTrue(all(e.review_count==0 and e.correct_answer=='' for e in entries))
        self.assertEqual(self.db.query(ReviewLogModel).count(),0)
        self.assertEqual(self.confirm(job_id,keys=['q1']).status_code,409)

    def test_split_group_preserves_shared_material_and_escapes_edited_text(self):
        job_id=self.upload().json()['id']
        draft=self.draft(job_id)
        edits=self.edits(draft)
        edits['questions'][1].update(group_key=None,stem='<script>alert(1)</script> Which answer?')
        changed=self.client.patch(f'/api/question-imports/{job_id}/draft',json=edits)
        self.assertEqual(changed.status_code,200,changed.text)
        standalone=changed.json()['draft']['questions'][1]
        self.assertIn('Original shared passage',standalone['standalone_material_text'])
        self.assertEqual(standalone['standalone_asset_keys'],[KEY])
        self.assertEqual(self.confirm(job_id,revision=1).status_code,409)
        result=self.confirm(job_id,revision=2)
        self.assertEqual(result.status_code,200,result.text)
        entry=self.db.get(NoteEntryModel,result.json()['entry_ids'][1])
        self.assertIsNone(entry.group_id)
        self.assertIn('Original shared passage',entry.question)
        self.assertNotIn('<script>',entry.question)
        self.assertIn('&lt;script&gt;',entry.question)

    def test_deleted_notebook_invalid_options_and_tampered_counters_cannot_commit(self):
        job_id=self.upload().json()['id']
        self.assertEqual(self.confirm(job_id,reviewed=False).status_code,422)
        self.assertEqual(self.confirm(job_id,review_count=99).status_code,422)
        edits=self.edits(self.draft(job_id))
        edits['questions'][1]['options']=[{'key':'A','text':'one'}]
        self.assertEqual(self.client.patch(f'/api/question-imports/{job_id}/draft',json=edits).status_code,200)
        self.assertEqual(self.confirm(job_id,revision=2).status_code,422)
        self.assertEqual(self.db.query(NoteEntryModel).count(),0)
        self.assertEqual(self.db.query(QuestionGroupModel).count(),0)
        self.db.delete(self.db.get(NotebookModel,'alice'))
        self.db.commit()
        self.assertEqual(self.confirm(job_id,revision=2).status_code,404)

    def test_confirm_preserves_image_options_without_requiring_fabricated_text_options(self):
        job_id=self.upload().json()['id']
        job=store.read_job('alice',job_id)
        job['draft']['questions'][1].update(option_mode='image',options=[],correct_answer='B')
        store.write_job(job)
        response=self.confirm(job_id)
        self.assertEqual(response.status_code,200,response.text)
        entry=self.db.get(NoteEntryModel,response.json()['entry_ids'][1])
        self.assertIn('<img',entry.question)
        self.assertEqual(entry.correct_answer,'B')
        self.assertEqual(self.db.query(ReviewLogModel).count(),0)

    def test_option_errors_list_exact_question_page_and_letter_before_any_insert(self):
        job_id=self.upload().json()['id']
        job=store.read_job('alice',job_id)
        first,second=job['draft']['questions']
        first['options']=[{'key':'A','text':'one'},{'key':'A','text':'two'}]
        second['options']=[{'key':'A','text':'one'},{'key':'B','text':' '}]
        store.write_job(job)
        response=self.confirm(job_id)
        self.assertEqual(response.status_code,422,response.text)
        message=response.json()['detail']
        self.assertIn('导入第 1 道',message)
        self.assertIn('原第 1 题',message)
        self.assertIn('PDF 第 2 页',message)
        self.assertIn('选项字母重复：A',message)
        self.assertIn('导入第 2 道',message)
        self.assertIn('原第 2 题',message)
        self.assertIn('选项内容为空：B',message)
        self.assertEqual(self.db.query(NoteEntryModel).count(),0)

    def test_plain_question_image_does_not_bypass_missing_options_and_image_mode_needs_own_image(self):
        job_id=self.upload().json()['id']
        job=store.read_job('alice',job_id)
        q=job['draft']['questions'][1]
        q['options']=[]
        store.write_job(job)
        response=self.confirm(job_id)
        self.assertEqual(response.status_code,422)
        self.assertIn('仅有 0 个文字选项',response.json()['detail'])
        q.update(option_mode='image',asset_keys=[])
        store.write_job(job)
        response=self.confirm(job_id)
        self.assertEqual(response.status_code,422)
        self.assertIn('图形选项缺少本题原图',response.json()['detail'])
        self.assertEqual(self.db.query(NoteEntryModel).count(),0)

    def test_permission_file_bounds_and_unknown_tasks(self):
        self.assertEqual(self.upload(notebook='bob').status_code,404)
        self.assertEqual(self.upload(name='bad.txt').status_code,422)
        self.assertEqual(self.upload(data=b'not a PDF').status_code,422)
        self.assertEqual(self.upload(data=b'').status_code,422)
        self.assertEqual(self.client.get('/api/question-imports/not-a-uuid').status_code,404)
        job_id=self.upload().json()['id']
        app.dependency_overrides[get_current_user]=lambda:SimpleNamespace(id='bob')
        self.assertEqual(self.client.get(f'/api/question-imports/{job_id}/draft').status_code,404)
        self.assertEqual(self.confirm(job_id).status_code,404)
        app.dependency_overrides.pop(get_current_user)
        self.assertEqual(self.upload().status_code,401)

    def test_upstream_data_is_revalidated_and_lost_response_recovers_without_duplicates(self):
        job_id=self.upload().json()['id']
        job=store.read_job('alice',job_id)
        for mutation in ('fingerprint','asset','group'):
            data=parsed()
            if mutation=='fingerprint':data['source_sha256']='0'*64
            if mutation=='asset':data['assets'][0]['sha256']='0'*64
            if mutation=='group':data['groups'][0]['question_keys']=[]
            with self.assertRaises(ValueError):store.accept_parsed(copy.deepcopy(job),data)
        # Simulate crash after the database transaction, before final manifest write.
        original_write=store.write_job
        def fail_final(value):
            if value['status']=='committed':raise OSError('simulated disk error')
            original_write(value)
        with patch.object(store,'write_job',side_effect=fail_final):
            with self.assertRaises(OSError):
                store.commit_draft(self.db,job,store.ConfirmDraft(expected_revision=1,question_keys=['q1','q2'],reviewed=True))
        self.assertEqual(self.db.query(NoteEntryModel).count(),2)
        edits=self.edits(self.draft(job_id))
        recovered_edit=self.client.patch(f'/api/question-imports/{job_id}/draft',json=edits)
        self.assertEqual(recovered_edit.status_code,200,recovered_edit.text)
        self.assertEqual(recovered_edit.json()['status'],'committed')
        recovered=self.confirm(job_id)
        self.assertEqual(recovered.status_code,200,recovered.text)
        self.assertEqual(self.db.query(NoteEntryModel).count(),2)

    def test_interrupted_parse_reports_failure_instead_of_polling_forever(self):
        job_id=self.upload().json()['id']
        job=store.read_job('alice',job_id)
        job.update(status='parsing',updated_at=time.time()-1300)
        path=store.job_dir('alice',job_id)/'job.json'
        path.write_text(json.dumps(job),encoding='utf-8')
        response=self.client.get(f'/api/question-imports/{job_id}')
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['status'],'failed')
        self.assertIn('中断',response.json()['message'])
        self.assertEqual(self.db.query(NoteEntryModel).count(),0)


if __name__=='__main__':unittest.main()
