import hashlib
import os
import time
from uuid import uuid4

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from src.db_sql.auth import get_current_user
from src.db_sql import crud
from src.db_sql.database import get_db
from src.db_sql.models import UserModel
from src.db_sql.pdf_question_import import (
    EditDraft, ConfirmDraft, accept_parsed, apply_edits, commit_draft, job_dir,
    lock_job, public_job, read_job, verify_asset_token, write_job, recover_before_edit,
)

router=APIRouter(prefix='/api/question-imports',tags=['PDF错题导入'])


async def process_job(owner, job_id, authorization):
    try:
        with lock_job(owner,job_id):
            job=read_job(owner,job_id)
            if job['status'] in {'cancelling','cancelled'}:
                return
            job.update(status='parsing',message='MinerU 正在解析版面、文字和图片…')
            write_job(job)
        source=job_dir(owner,job_id)/'source.pdf'
        url=os.getenv('RAG_AGENT_URL','http://127.0.0.1:8001').rstrip('/')
        async with httpx.AsyncClient(timeout=httpx.Timeout(990,connect=10),trust_env=False) as client:
            with source.open('rb') as stream:
                response=await client.post(url+'/question-import/parse',data={'job_id':job_id},files={'file':(job['filename'],stream,'application/pdf')},
                    headers={'Authorization':authorization})
        if response.status_code!=200:
            detail=response.json().get('detail','解析服务未完成')
            raise ValueError(detail if isinstance(detail,str) else '解析服务返回无效响应')
        if len(response.content)>65*1024*1024:
            raise ValueError('解析结果过大，请拆分文件')
        with lock_job(owner,job_id):
            job=read_job(owner,job_id)
            if job['status'] in {'cancelling','cancelled'}:
                return
            accept_parsed(job,response.json())
    except Exception as error:
        with lock_job(owner,job_id):
            job=read_job(owner,job_id)
            if job['status'] in {'cancelling','cancelled'}:
                return
            job.update(status='failed',message=str(error) if isinstance(error,ValueError) else 'PDF 解析未完成，请检查服务后重试。')
            write_job(job)


@router.post('')
async def upload(background_tasks:BackgroundTasks, notebook_id:str=Form(...), file:UploadFile=File(...),
                 user:UserModel=Depends(get_current_user), db:Session=Depends(get_db), authorization:str=Header(default='')):
    crud.owned_notebook(db,notebook_id,user.id)
    filename=(file.filename or '').replace('\\','/').split('/')[-1]
    if not filename.lower().endswith('.pdf') or len(filename)>255:
        raise HTTPException(422,'请选择 PDF 文件')
    job_id=str(uuid4())
    directory=job_dir(user.id,job_id)
    directory.mkdir(parents=True,exist_ok=False)
    size,digest=0,hashlib.sha256()
    with (directory/'source.pdf').open('wb') as target:
        while chunk:=await file.read(1024*1024):
            size+=len(chunk)
            if size>100*1024*1024:
                raise HTTPException(413,'PDF 不能超过 100 MB')
            digest.update(chunk)
            target.write(chunk)
    if not size or not (directory/'source.pdf').read_bytes()[:1024].lstrip().startswith(b'%PDF-'):
        raise HTTPException(422,'PDF 文件为空或格式无效')
    job={'id':job_id,'owner':user.id,'notebook_id':notebook_id,'filename':filename,'status':'uploaded',
         'revision':0,'message':'PDF 已上传，正在启动解析。','source_sha256':digest.hexdigest(),'created_at':time.time()}
    write_job(job)
    owner=user.id
    db.rollback()  # 模型处理期间不占用 MySQL 读事务。
    background_tasks.add_task(process_job,owner,job_id,authorization)
    return public_job(job)


@router.get('/{job_id}')
def status(job_id:str,user:UserModel=Depends(get_current_user)):
    job=read_job(user.id,job_id)
    if job['status'] in {'uploaded','parsing'} and time.time()-job.get('updated_at',job['created_at'])>1200:
        with lock_job(user.id,job_id):
            job=read_job(user.id,job_id)
            if job['status'] in {'uploaded','parsing'} and time.time()-job.get('updated_at',job['created_at'])>1200:
                job.update(status='failed',message='解析任务已超时或服务中断，请重新上传 PDF。')
                write_job(job)
    return public_job(job)


@router.get('/{job_id}/draft')
def draft(job_id:str,user:UserModel=Depends(get_current_user)):
    return public_job(read_job(user.id,job_id),True)


@router.post('/{job_id}/cancel')
async def cancel(job_id:str,user:UserModel=Depends(get_current_user),authorization:str=Header(default='')):
    read_job(user.id,job_id)
    with lock_job(user.id,job_id):
        job=read_job(user.id,job_id)
        if job['status']=='cancelled':
            return public_job(job)
        if job['status'] not in {'uploaded','parsing','cancelling','ready_for_review','failed'}:
            raise HTTPException(409,'任务已经结束，不能取消解析')
        job.update(status='cancelling',message='正在停止 PDF 解析…')
        write_job(job)
    url=os.getenv('RAG_AGENT_URL','http://127.0.0.1:8001').rstrip('/')
    try:
        async with httpx.AsyncClient(timeout=10,trust_env=False) as client:
            response=await client.post(f'{url}/question-import/{job_id}/cancel',
                                      headers={'Authorization':authorization})
        response.raise_for_status()
        if response.json().get('status')!='cancellation_requested':
            raise ValueError('Invalid cancellation response')
    except (httpx.HTTPError,ValueError) as exc:
        raise HTTPException(503,'停止解析暂未确认，请重试取消。') from exc
    with lock_job(user.id,job_id):
        job=read_job(user.id,job_id)
        job.update(status='cancelled',message='PDF 解析已取消，未录入题目。')
        write_job(job)
        return public_job(job)


@router.patch('/{job_id}/draft')
def edit(job_id:str,payload:EditDraft,user:UserModel=Depends(get_current_user),db:Session=Depends(get_db)):
    read_job(user.id,job_id)
    with lock_job(user.id,job_id):
        job=read_job(user.id,job_id)
        recover_before_edit(db,job)
        if job['status']=='committed':
            return public_job(job,True)
        apply_edits(job,payload)
        return public_job(job,True)


@router.post('/{job_id}/confirm')
def confirm(job_id:str,payload:ConfirmDraft,user:UserModel=Depends(get_current_user),db:Session=Depends(get_db)):
    read_job(user.id,job_id)
    with lock_job(user.id,job_id):
        job=read_job(user.id,job_id)
        return commit_draft(db,job,payload)


@router.get('/{job_id}/assets/{asset_key}')
def asset(job_id:str,asset_key:str,token:str,db:Session=Depends(get_db),authorization:str=Header(default='')):
    owner=verify_asset_token(token,job_id,asset_key)
    if authorization:
        if not authorization.startswith('Bearer ') or get_current_user(authorization[7:],db).id!=owner:
            raise HTTPException(403,'图片不属于当前账号')
    job=read_job(owner,job_id)
    crud.owned_notebook(db,job['notebook_id'],owner)
    known=next((a for a in job.get('draft',{}).get('assets',[]) if a['key']==asset_key),None)
    path=job_dir(owner,job_id)/'assets'/asset_key
    if not known or not path.is_file():
        raise HTTPException(404,'图片未找到')
    return FileResponse(path,media_type=known['mime'],headers={'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'})
