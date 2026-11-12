"""离线命令：导出明确作答、训练DAS3H、输出评估JSON。不会修改复习记录。"""
import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import json
from pathlib import Path
import os

from src.db_sql.review_risk import Event, train_model


def write_json(path,data):
    path = Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary = path.with_name(path.name+'.tmp')
    temporary.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    os.replace(temporary,path)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--input',help='脱敏事件JSON，由--export生成')
    source.add_argument('--user-id',action='append',help='明确指定本地数据库账号ID，可重复')
    parser.add_argument('--skills-file',required=True,help='审核通过的知识点名称JSON数组')
    parser.add_argument('--export',help='只导出脱敏事件，不训练')
    parser.add_argument('--output',help='输出候选模型JSON')
    parser.add_argument('--min-train',type=int,default=100)
    parser.add_argument('--min-holdout',type=int,default=20)
    args = parser.parse_args(argv)
    if not args.output and not args.export:
        parser.error('必须指定--output或--export')
    skills = json.loads(Path(args.skills_file).read_text(encoding='utf-8-sig'))
    if not isinstance(skills,list) or not skills or any(not isinstance(s,str) or not s.strip() for s in skills):
        parser.error('skills-file必须为非空审核知识点名称数组')
    if args.input:
        rows = json.loads(Path(args.input).read_text(encoding='utf-8-sig'))
        events = [Event(**{**row,'skills':tuple(row['skills'])}) for row in rows]
    else:
        from src.db_sql.database import SessionLocal
        from src.db_sql.review_risk_data import load_events
        with SessionLocal() as db:
            events = load_events(db,args.user_id,int(datetime.now(timezone.utc).timestamp()*1000),skills)
    if args.export:
        write_json(args.export,[asdict(event) for event in events])
        print(json.dumps({'exported_events':len(events)},ensure_ascii=False))
        return 0
    try:
        model = train_model(events,skills,min_train=args.min_train,min_holdout=args.min_holdout)
    except ValueError as exc:
        print(json.dumps({'trained':False,'reason':str(exc)},ensure_ascii=False))
        return 2
    write_json(args.output,model.to_dict())
    print(json.dumps({'trained':True,'validated':model.validated,'evaluation':model.report},ensure_ascii=False))
    return 0 if model.validated else 3


if __name__ == '__main__':
    raise SystemExit(main())
