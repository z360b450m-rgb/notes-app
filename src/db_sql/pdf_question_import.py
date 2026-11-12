"""PDF 草稿的持久化、图片能力链接和事务录入；解析不写复习记录。"""
import base64
import copy
from contextlib import contextmanager
import hashlib
import hmac
import html
import json
import os
from pathlib import Path
import time
from typing import Literal
from uuid import UUID, uuid4, uuid5, NAMESPACE_URL

from fastapi import HTTPException
from filelock import FileLock, Timeout
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy.orm import Session

from src.db_sql import auth, crud
from src.db_sql.models import NoteEntryModel, QuestionGroupModel


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Option(StrictModel):
    key: str = Field(pattern=r'^[A-H]$')
    text: str = Field(max_length=4000)


class Question(StrictModel):
    key: str = Field(pattern=r'^q\d+$')
    source_number: str = Field(max_length=64)
    title: str = Field(max_length=255)
    stem: str = Field(max_length=20000)
    kind: Literal['choice','free_response']
    option_mode: Literal['text','image'] = 'text'
    options: list[Option] = Field(max_length=8)
    asset_keys: list[str] = Field(max_length=30)
    group_key: str | None
    source_pages: list[StrictInt] = Field(min_length=1,max_length=300)
    source_block_ids: list[str] = Field(max_length=1000)
    correct_answer: str = Field(max_length=20000)
    explanation: str = Field(max_length=20000)
    student_answer: str = Field(max_length=20000)
    warnings: list[str] = Field(max_length=30)
    answer_status: Literal['provided','missing']
    standalone_material_text: str = Field(default='', max_length=50000)
    standalone_asset_keys: list[str] = Field(default_factory=list,max_length=30)


class Group(StrictModel):
    key: str = Field(pattern=r'^g\d+$')
    title: str = Field(max_length=255)
    material_text: str = Field(max_length=50000)
    asset_keys: list[str] = Field(max_length=30)
    block_ids: list[str] = Field(max_length=1000)
    decision: Literal['suggested','candidate']
    question_keys: list[str] = Field(max_length=500)
    warnings: list[str] = Field(max_length=30)


class Asset(StrictModel):
    key: str = Field(pattern=r'^asset-[a-f0-9]{24}$')
    sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    mime: Literal['image/jpeg','image/png']
    width: StrictInt = Field(ge=1,le=10000)
    height: StrictInt = Field(ge=1,le=10000)
    page_number: StrictInt = Field(ge=1,le=300)
    bbox: list[float] = Field(min_length=4,max_length=4)
    content_base64: str = Field(max_length=8*1024*1024)


class ParsedDraft(StrictModel):
    schema_version: Literal['pdf-question-draft-v1']
    filename: str = Field(max_length=255)
    source_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    page_count: StrictInt = Field(ge=1,le=300)
    mineru_version: str = Field(max_length=40)
    groups: list[Group] = Field(max_length=500)
    questions: list[Question] = Field(min_length=1,max_length=500)
    assets: list[Asset] = Field(max_length=500)
    notices: list[str] = Field(max_length=30)


class QuestionEdit(StrictModel):
    key: str = Field(pattern=r'^q\d+$')
    title: str = Field(max_length=255)
    stem: str = Field(max_length=20000)
    kind: Literal['choice','free_response']
    options: list[Option] = Field(max_length=8)
    group_key: str | None
    correct_answer: str = Field(max_length=20000)
    explanation: str = Field(max_length=20000)
    student_answer: str = Field(max_length=20000)


class GroupEdit(StrictModel):
    key: str = Field(pattern=r'^g\d+$')
    title: str = Field(max_length=255)
    material_text: str = Field(max_length=50000)


class EditDraft(StrictModel):
    expected_revision: StrictInt = Field(ge=1)
    questions: list[QuestionEdit] = Field(min_length=1,max_length=500)
    groups: list[GroupEdit] = Field(max_length=500)


class ConfirmDraft(StrictModel):
    expected_revision: StrictInt = Field(ge=1)
    question_keys: list[str] = Field(min_length=1,max_length=500)
    reviewed: Literal[True]


def storage_root():
    return Path(os.getenv('PDF_IMPORT_STORAGE_DIR', str(Path(__file__).resolve().parents[2]/'.data'/'pdf-imports'))).resolve()


def job_dir(owner: str, job_id: str):
    try:
        canonical = str(UUID(job_id))
    except ValueError as exc:
        raise HTTPException(404, '导入任务未找到') from exc
    return storage_root()/hashlib.sha256(owner.encode()).hexdigest()/canonical


@contextmanager
def lock_job(owner, job_id):
    try:
        lock = FileLock(str(job_dir(owner,job_id)/'job.lock'), timeout=5)
        lock.acquire()
    except (Timeout, OSError) as exc:
        raise HTTPException(409,'导入任务正在处理，请稍后重试') from exc
    try:
        yield lock
    finally:
        lock.release()


def read_job(owner, job_id):
    path = job_dir(owner,job_id)/'job.json'
    if not path.is_file():
        raise HTTPException(404,'导入任务未找到')
    result = json.loads(path.read_text(encoding='utf-8'))
    if result['owner'] != owner:
        raise HTTPException(404,'导入任务未找到')
    return result


def write_job(job):
    directory = job_dir(job['owner'],job['id'])
    directory.mkdir(parents=True,exist_ok=True)
    job['updated_at']=time.time()
    temporary = directory/(uuid4().hex+'.json.tmp')
    temporary.write_text(json.dumps(job,ensure_ascii=False),encoding='utf-8')
    os.replace(temporary,directory/'job.json')


def asset_token(owner, job_id, asset_key):
    encoded = base64.urlsafe_b64encode(json.dumps([owner,job_id,asset_key],separators=(',',':')).encode()).decode().rstrip('=')
    signature = hmac.new(auth.SECRET_KEY.encode(),('pdf-image-v1:'+encoded).encode(),hashlib.sha256).hexdigest()
    return encoded+'.'+signature


def verify_asset_token(token, job_id, asset_key):
    try:
        encoded, signature = token.split('.')
        expected = hmac.new(auth.SECRET_KEY.encode(),('pdf-image-v1:'+encoded).encode(),hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature,expected):
            raise ValueError('signature')
        owner, job, asset = json.loads(base64.urlsafe_b64decode(encoded+'='*((-len(encoded))%4)))
        if job != job_id or asset != asset_key or not isinstance(owner,str):
            raise ValueError('scope')
        return owner
    except Exception as exc:
        raise HTTPException(403,'图片链接无效') from exc


def asset_url(job, key):
    base = os.getenv('PUBLIC_NOTES_API_URL','http://localhost:8000').rstrip('/')
    return f"{base}/api/question-imports/{job['id']}/assets/{key}?token={asset_token(job['owner'],job['id'],key)}"


def public_job(job, include_draft=False):
    result = {k:job[k] for k in ('id','notebook_id','filename','status','revision','message')}
    if job.get('result'):
        result['result'] = job['result']
    if include_draft and job.get('draft'):
        result['draft'] = copy.deepcopy(job['draft'])
        for asset in result['draft']['assets']:
            asset['url'] = asset_url(job,asset['key'])
    return result


def accept_parsed(job, payload):
    draft = ParsedDraft.model_validate(payload).model_dump()
    if draft['source_sha256'] != job['source_sha256']:
        raise ValueError('解析结果与上传文件不一致')
    questions, groups, assets = draft['questions'], draft['groups'], draft['assets']
    for rows in (questions,groups,assets):
        if len({r['key'] for r in rows}) != len(rows):
            raise ValueError('解析结果存在重复ID')
    group_keys = {r['key'] for r in groups}
    asset_keys = {r['key'] for r in assets}
    for row in questions:
        if row['standalone_material_text'] or row['standalone_asset_keys']:
            raise ValueError('独立题材料只能由校对拆组操作产生')
        if row['group_key'] is not None and row['group_key'] not in group_keys:
            raise ValueError('题组引用无效')
        if any(not 1<=p<=draft['page_count'] for p in row['source_pages']):
            raise ValueError('题目页码不合法')
    for group in groups:
        actual = [q['key'] for q in questions if q['group_key']==group['key']]
        if group['question_keys'] != actual:
            raise ValueError('题组成员不一致')
    for row in questions+groups:
        if not set(row['asset_keys']) <= asset_keys:
            raise ValueError('题目图片引用无效')
    directory = job_dir(job['owner'],job['id'])/'assets'
    directory.mkdir(exist_ok=True)
    total_bytes=0
    for asset in assets:
        if not 1<=asset['page_number']<=draft['page_count']:
            raise ValueError('图片页码不合法')
        data = base64.b64decode(asset.pop('content_base64'),validate=True)
        total_bytes+=len(data)
        if total_bytes>35*1024*1024 or hashlib.sha256(data).hexdigest()!=asset['sha256']:
            raise ValueError('图片校验失败或总大小超限')
        if not (data.startswith(b'\xff\xd8\xff') if asset['mime']=='image/jpeg' else data.startswith(b'\x89PNG\r\n\x1a\n')):
            raise ValueError('图片格式不合法')
        (directory/asset['key']).write_bytes(data)
    draft['filename'] = job['filename']
    job.update(status='ready_for_review',revision=1,message='解析完成，请核对题目、图片和题组后确认录入。',draft=draft)
    write_job(job)


def apply_edits(job, payload: EditDraft):
    if job.get('commit_intent'):
        raise HTTPException(409,'上次提交结果需先核对，请重试确认')
    if job['status']!='ready_for_review' or payload.expected_revision!=job['revision']:
        raise HTTPException(409,'草稿已变化，请重新加载')
    draft=job['draft']
    questions={q['key']:q for q in draft['questions']}
    groups={g['key']:g for g in draft['groups']}
    if len(payload.questions)!=len(questions) or {q.key for q in payload.questions}!=set(questions) or len(payload.groups)!=len(groups) or {g.key for g in payload.groups}!=set(groups):
        raise HTTPException(422,'修改需保留原题目和题组标识')
    for edit in payload.groups:
        groups[edit.key].update(edit.model_dump())
    for edit in payload.questions:
        question=questions[edit.key]
        if edit.group_key is not None and edit.group_key not in groups:
            raise HTTPException(422,'所选题组不存在')
        if question['group_key'] and edit.group_key is None:
            old=groups[question['group_key']]
            question['standalone_material_text']=old['material_text']
            question['standalone_asset_keys']=list(old['asset_keys'])
        elif edit.group_key:
            question['standalone_material_text']=''
            question['standalone_asset_keys']=[]
        question.update(edit.model_dump())
        question['answer_status']='provided' if question['correct_answer'].strip() else 'missing'
    for group in groups.values():
        group['question_keys']=[q['key'] for q in questions.values() if q['group_key']==group['key']]
    job['revision']+=1
    write_job(job)


def text_html(text):
    return html.escape(text).replace('\n','<br>')


def image_html(job, keys):
    return ''.join(f'<p><img src="{html.escape(asset_url(job,key),quote=True)}" alt="原题图片" style="max-width:100%;height:auto"></p>' for key in dict.fromkeys(keys))


def compile_question(job, question):
    material = question.get('standalone_material_text','')
    body=(f'<p>{text_html(material)}</p>' if material else '')+image_html(job,question.get('standalone_asset_keys',[]))
    body+=f"<p>{text_html(question['stem'])}</p>"+image_html(job,question['asset_keys'])
    for option in question['options']:
        body+=f"<br>{option['key']}. {text_html(option['text'])}"
    answer=text_html(question['correct_answer'])
    if question['explanation'].strip():
        answer+=f"<p>解析：{text_html(question['explanation'])}</p>"
    return body,answer,text_html(question['student_answer'])


def question_issues(question):
    """图形选项保留整图；文字选项错误具体到字母，不能用任意题图绕过检查。"""
    issues=[]
    if not question['stem'].strip() and not question['asset_keys']:
        issues.append('题干和本题图片均为空')
    if question['kind'] != 'choice':
        return issues
    options=question['options']
    if not options and question.get('option_mode','text') == 'image':
        if not question['asset_keys']:
            issues.append('图形选项缺少本题原图')
        return issues
    if len(options)<2:
        issues.append(f'仅有 {len(options)} 个文字选项，至少需要 2 个')
    keys=[o['key'] for o in options]
    duplicates=sorted({key for key in keys if keys.count(key)>1})
    if duplicates:
        issues.append('选项字母重复：'+'、'.join(duplicates))
    empty=[o['key'] for o in options if not o['text'].strip()]
    if empty:
        issues.append('选项内容为空：'+'、'.join(empty))
    return issues


def commit_draft(db: Session, job, payload: ConfirmDraft):
    crud.owned_notebook(db,job['notebook_id'],job['owner'])
    if job['status']=='committed':
        if payload.question_keys!=job['confirmed_keys']:
            raise HTTPException(409,'任务已录入，重复确认必须是同一组题目')
        return job['result']
    if job['status']!='ready_for_review' or payload.expected_revision!=job['revision']:
        raise HTTPException(409,'草稿已变化，请重新加载')
    known={q['key']:q for q in job['draft']['questions']}
    if len(set(payload.question_keys))!=len(payload.question_keys) or not set(payload.question_keys)<=set(known):
        raise HTTPException(422,'确认题目范围无效')
    selected=[known[key] for key in payload.question_keys]
    groups={g['key']:g for g in job['draft']['groups']}
    used_groups={q['group_key'] for q in selected if q['group_key']}
    problems=[]
    positions={q['key']:index+1 for index,q in enumerate(job['draft']['questions'])}
    for question in selected:
        issues=question_issues(question)
        if issues:
            group=groups.get(question['group_key'])
            group_label=f"材料组 {question['group_key'][1:]} · " if group else ''
            pages='、'.join(str(page) for page in question['source_pages'])
            label=f"导入第 {positions[question['key']]} 道 · {group_label}原第 {question['source_number']} 题 · PDF 第 {pages} 页"
            problems.append(label+'：'+'；'.join(issues))
    if problems:
        raise HTTPException(422,'以下题目未通过校验：\n'+'\n'.join(problems))
    def identifier(kind,key):
        return str(uuid5(NAMESPACE_URL,f"pdf-import-v1:{job['owner']}:{job['id']}:{kind}:{key}"))
    entry_ids=[identifier('question',q['key']) for q in selected]
    group_ids={key:identifier('group',key) for key in used_groups}
    intent=hashlib.sha256(json.dumps({'revision':job['revision'],'keys':payload.question_keys},sort_keys=True).encode()).hexdigest()
    existing=[db.get(NoteEntryModel,ident) for ident in entry_ids]
    if any(existing):
        # SQL 已提交但进程在写清单前中断，依据预先记录的提交意图恢复，绝不覆盖已有行。
        if not all(existing) or job.get('commit_intent')!=intent or any(e.user_id!=job['owner'] or e.notebook_id!=job['notebook_id'] for e in existing):
            raise HTTPException(409,'导入标识冲突，请联系维护者检查任务')
    else:
        job['commit_intent']=intent
        job['pending_keys']=payload.question_keys
        write_job(job)
        try:
            for key,ident in group_ids.items():
                group=groups[key]
                if db.get(QuestionGroupModel,ident):
                    raise HTTPException(409,'题组标识冲突')
                material=f"<p>{text_html(group['material_text'])}</p>"+image_html(job,group['asset_keys'])
                if len(material.encode('utf-8'))>65000:
                    raise HTTPException(422,'公共材料较长，请拆分或缩短后录入')
                db.add(QuestionGroupModel(id=ident,notebook_id=job['notebook_id'],title=group['title'],material=material))
            db.flush()
            group_order={key:0 for key in used_groups}
            for ident,question in zip(entry_ids,selected):
                group_key=question['group_key']
                if group_key:
                    group_order[group_key]+=1
                body,answer,student=compile_question(job,question)
                if any(len(text.encode('utf-8'))>65000 for text in (body,answer,student)):
                    raise HTTPException(422,'题目内容较长，请拆分或缩短后录入')
                db.add(NoteEntryModel(id=ident,user_id=job['owner'],notebook_id=job['notebook_id'],
                    title=question['title'] or f"第{question['source_number']}题",question=body,
                    correct_answer=answer,wrong_answer=student,subject='未分类',source=job['filename'][:255],
                    group_id=group_ids.get(group_key),sub_question_order=group_order.get(group_key),review_count=0))
            db.commit()
        except Exception:
            db.rollback()
            raise
    result={'status':'completed','importedCount':len(entry_ids),'entry_ids':entry_ids,'group_ids':list(group_ids.values())}
    job.update(status='committed',message=f'已录入 {len(entry_ids)} 道题目。',result=result,confirmed_keys=payload.question_keys)
    write_job(job)
    return result


def recover_before_edit(db,job):
    """提交清单写失败时先检查 SQL；编辑操作不会重试未落库的旧提交。"""
    pending=job.get('pending_keys') or []
    if not job.get('commit_intent') or not pending:
        return
    ids=[str(uuid5(NAMESPACE_URL,f"pdf-import-v1:{job['owner']}:{job['id']}:question:{key}")) for key in pending]
    if any(db.get(NoteEntryModel,key) for key in ids):
        commit_draft(db,job,ConfirmDraft(expected_revision=job['revision'],question_keys=pending,reviewed=True))
    else:
        job.pop('commit_intent',None)
        job.pop('pending_keys',None)
        write_job(job)
