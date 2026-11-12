"""显式入库的快照、差异计算和可重试索引任务，不挂接错题CRUD。"""
import hashlib
import json
import logging
import os
import time
import uuid

import httpx
from sqlalchemy.orm import selectinload
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from src.db_sql import crud
from src.db_sql.auth import create_access_token
from src.db_sql.database import SessionLocal
from src.db_sql.models import NotebookIndexModel, NotebookModel, NoteEntryModel, QuestionGroupModel

PROCESS_ID = str(uuid.uuid4())


def now_ms():
    return int(time.time() * 1000)


def content_hash(entry, group, notebook_name):
    #1.检索内容与AI学习计数参与；更新时间和掌握评级不参与。
    content = {key: entry.get(key) for key in (
        'title', 'question', 'wrong_answer', 'correct_answer', 'subject', 'source', 'tags',
        'drawings', 'group_id', 'sub_question_order', 'folder',
        'review_count', 'wrong_count', 'learning_tags',
    )}
    content['tags'] = sorted(content.get('tags') or [])
    content['material'] = {key: group.get(key) for key in ('title', 'material', 'drawings')}
    content['notebook_name'] = notebook_name
    content['index_format'] = 'wrong-entry-v3'
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def serialize_index(row):
    status = row.status
    if status == 'running' and row.snapshot.get('worker_id') != PROCESS_ID:
        status = 'interrupted'
    return {'id': row.id, 'kb_id': row.kb_id, 'notebook_id': row.notebook_id,
            'notebook_name': row.notebook_name, 'task_id': row.task_id, 'status': status,
            'report': row.report, 'indexed_count': sum(bool(value) for value in row.hashes.values()), 'updated_at': row.updated_at}


def prepare_index(db, user_id, kb_id, notebook_id, remove=False):
    #1.登录身份限定来源；已删除错题本只允许通过当前用户已有清单清理。
    book = db.query(NotebookModel).filter_by(id=notebook_id, user_id=user_id).first()
    row = db.query(NotebookIndexModel).filter_by(user_id=user_id, kb_id=kb_id,
                                                notebook_id=notebook_id).with_for_update().first()
    if not book and not row:
        raise HTTPException(404, '错题本未找到')
    if row and row.status == 'running' and row.snapshot.get('worker_id') == PROCESS_ID and now_ms() - row.updated_at < 2 * 3600000:
        raise HTTPException(409, '该错题本正在入库，请等待完成')
    name = book.name if book else row.notebook_name
    entries, groups = [], []
    if book and not remove:
        entries = [crud.serialize_entry(item) for item in db.query(NoteEntryModel)
                   .options(selectinload(NoteEntryModel.tags), selectinload(NoteEntryModel.review_logs))
                   .filter_by(user_id=user_id, notebook_id=notebook_id).order_by(NoteEntryModel.id).all()]
        groups = [crud.serialize_question_group(item) for item in db.query(QuestionGroupModel)
                  .filter_by(notebook_id=notebook_id).all()]
    group_map = {group['id']: group for group in groups}
    for entry in entries:
        if entry['group_id'] and entry['group_id'] not in group_map:
            raise HTTPException(409, '错题公共材料缺失，请先修复题组')
        entry['notebook_name'] = name
        entry['content_hash'] = content_hash(entry, group_map.get(entry['group_id'], {}), name)
    snapshot = {'entries': entries, 'question_groups': groups, 'worker_id': PROCESS_ID}
    hashes = row.hashes if row else {}
    current = {entry['id']: entry['content_hash'] for entry in entries}
    report = {'total': len(entries), 'added': 0, 'updated': 0, 'deleted': 0, 'skipped': 0,
              'processed': 0, 'failed': 0, 'failures': [], 'pending':
              sum(hashes.get(key) != value for key, value in current.items()) + len(set(hashes) - set(current))}

    #2.点击执行后才保存任务及数据快照；成功清单保持原样直到对应操作成功。
    if not row:
        row = NotebookIndexModel(id=str(uuid.uuid4()), user_id=user_id, kb_id=kb_id,
                                 notebook_id=notebook_id, hashes={})
        db.add(row)
    row.notebook_name, row.task_id = name, str(uuid.uuid4())
    row.status, row.snapshot, row.report, row.updated_at = 'running', snapshot, report, now_ms()
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, '该错题本已有入库任务，请刷新后重试') from exc
    db.refresh(row)
    return row


def run_index(index_id, task_id, sessions=SessionLocal):
    try:
        _run_index(index_id, task_id, sessions)
    except Exception as exc:
        logging.getLogger(__name__).warning('Notebook index interrupted: %s', type(exc).__name__)
        with sessions() as db:
            row = db.query(NotebookIndexModel).filter_by(id=index_id, task_id=task_id).first()
            if row:
                report = dict(row.report)
                report['failed'] += 1
                report['failures'] = [*report['failures'], {'entry_id': '', 'message': '任务中断，请重新执行入库'}]
                row.status, row.report, row.snapshot = 'partial', report, {}
                row.updated_at = now_ms()
                db.commit()


def _run_index(index_id, task_id, sessions):
    #1.后台只执行这次手动提交的快照；不监听错题的新增修改删除。
    with sessions() as db:
        row = db.get(NotebookIndexModel, index_id)
        if not row or row.task_id != task_id or row.status != 'running':
            return
        owner, kb_id, notebook_id = row.user_id, row.kb_id, row.notebook_id
        snapshot, hashes, report = row.snapshot, dict(row.hashes), dict(row.report)
        entries = snapshot['entries']
        current_ids = {entry['id'] for entry in entries}
        operations = []
        for entry in entries:
            if hashes.get(entry['id']) == entry['content_hash']:
                report['skipped'] += 1
            else:
                operations.append(('upsert', entry['id'], entry))
        operations.extend(('delete', key, None) for key in sorted(set(hashes) - current_ids))
    base_url = os.getenv('RAG_AGENT_URL', 'http://127.0.0.1:8001').rstrip('/')
    timeout = float(os.getenv('RAG_INDEX_TIMEOUT_SECONDS', '600'))

    #2.逐题执行，成功才更新清单；失败保留旧指纹，下次手动执行可重试。
    with httpx.Client(timeout=timeout, trust_env=False) as client:
        for operation, entry_id, entry in operations:
            try:
                with sessions() as db:
                    row = db.get(NotebookIndexModel, index_id)
                    if not row or row.task_id != task_id:
                        return
                response = client.post(f'{base_url}/index/wrong-entry',
                    headers={'Authorization': f'Bearer {create_access_token(owner)}'},
                    json={'operation': operation, 'kb_id': kb_id, 'notebook_id': notebook_id,
                          'entry_id': entry_id, 'entry': entry, 'question_groups': snapshot['question_groups']})
                response.raise_for_status()
                result = response.json()
                if result.get('status') != 'completed':
                    raise ValueError('索引服务没有完成写入')
                if operation == 'delete':
                    hashes.pop(entry_id, None)
                    report['deleted'] += 1
                else:
                    report['updated' if hashes.get(entry_id) else 'added'] += 1
                    hashes[entry_id] = entry['content_hash']
            except (httpx.HTTPError, ValueError, TypeError, AttributeError):
                # 未确认的首次写入也可能留下切片，保留ID以便重试或显式清理。
                if operation == 'upsert':
                    hashes.setdefault(entry_id, None)
                report['failed'] += 1
                report['failures'].append({'entry_id': entry_id, 'message': '索引处理失败，请检查RAG服务、向量模型和Milvus后重新执行'})
            report['processed'] += 1
            with sessions() as db:
                row = db.query(NotebookIndexModel).filter_by(id=index_id, task_id=task_id).with_for_update().first()
                if not row:
                    return
                row.hashes, row.report, row.updated_at = dict(hashes), dict(report), now_ms()
                db.commit()

        # 简介按整个批次概括一次；没有内容变更时也能补充空简介，失败不影响索引结果。
        try:
            with sessions() as db:
                current = db.query(NotebookIndexModel).filter_by(id=index_id, task_id=task_id).first()
                if not current:
                    return
            response = client.post(f'{base_url}/knowledge/libraries/{kb_id}/summary',
                headers={'Authorization': f'Bearer {create_access_token(owner)}'})
            response.raise_for_status()
        except httpx.HTTPError as exc:
            logging.getLogger(__name__).warning('Library summary unavailable: %s', type(exc).__name__)

    #3.清除任务快照，保留成功清单和可查看的失败结果。
    with sessions() as db:
        row = db.query(NotebookIndexModel).filter_by(id=index_id, task_id=task_id).with_for_update().first()
        if row:
            row.status = 'partial' if report['failed'] else 'completed'
            row.hashes, row.report, row.snapshot, row.updated_at = hashes, report, {}, now_ms()
            db.commit()
