"""Restore a private remote backup, check preservation, and exercise portal transactions.
Usage: python3 backend/test/check-portal-migration.py backup/portals-YYYYMMDD
No remote connections; the disposable database is removed even on failure.
"""
from pathlib import Path
import hashlib, os, re, subprocess, sys, time
root=Path(__file__).resolve().parents[2]
backup=Path(sys.argv[1]).resolve()
container=f'bouncer-portal-check-{os.getpid()}'
image='public.ecr.aws/supabase/postgres:17.6.1.132'
def run(*args,**kwargs):
    result=subprocess.run(args,capture_output=True,**kwargs)
    if result.returncode:
        fd=os.open(backup/'portal-restore-error.log',os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
        with os.fdopen(fd,'wb') as file:file.write(result.stderr)
        raise RuntimeError('Private restore error saved in backup directory')
    return result.stdout.decode()
def sql(s):return run('docker','exec','-i',container,'psql','-X','-U','postgres','-d','portal_restore','-v','ON_ERROR_STOP=1','-qAt',input=s.encode())
files={name:(backup/f'{name}.sql').read_text() for name in ['roles','schema','data']}
copies=list(re.finditer(r'^COPY "public"\."([^"\n]+)" \([^\n]*\) FROM stdin;\n.*?^\\\.\n',files['data'],re.M|re.S))
if not {'verifier_rules','user_wallets','verifier_user_roles'}.issubset({m[1] for m in copies}):raise RuntimeError('Incomplete application backup')
sequences=re.findall(r'^SELECT pg_catalog\.setval\(\'"public"\.[^\n]+;',files['data'],re.M)
def fingerprints(upgraded=False):
    output={}
    for m in copies:
        row="to_jsonb(t)"
        if upgraded and m[1]=='verifier_reconciliation_jobs':row+=" - ARRAY['rule_id','member_ids']"
        output[m[1]]=hashlib.sha256(sql(f'SELECT coalesce(jsonb_agg({row} ORDER BY ({row})::text),\'[]\'::jsonb) FROM public."{m[1]}" t;').encode()).hexdigest()
    return output
run('docker','run','--rm','--detach','--pull=never','--name',container,'--env','POSTGRES_PASSWORD=local-portal-test-only',image)
try:
    for _ in range(45):
        if subprocess.run(['docker','exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
        time.sleep(1)
    run('docker','exec',container,'createdb','-U','postgres','portal_restore')
    sql('CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS vault; CREATE PUBLICATION supabase_realtime;')
    sql(files['roles']+'\n'+files['schema']+'\nSET session_replication_role=replica;\n'+'\n'.join(m[0] for m in copies)+'\n'+'\n'.join(sequences))
    has_portal=sql("SELECT to_regclass('public.verifier_web_sessions') IS NOT NULL;").strip()=='t'
    before=fingerprints()
    if len(sys.argv)>2:
        prior='20261017010000' if has_portal else '20261016020000'
        sql("CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]); INSERT INTO supabase_migrations.schema_migrations(version) VALUES('"+prior+"');")
        sql(Path(sys.argv[2]).read_text())
    else:
        filename='20261017020000_add_rule_role_changes.sql' if has_portal else '20261017010000_add_portals.sql'
        sql((root/'backend/supabase/migrations'/filename).read_text())
    assert before==fingerprints(upgraded=has_portal),'Portal migration changed existing data'
    print('PASS: backup restored; migration preserves all existing application values',flush=True)
    sql('BEGIN; TRUNCATE public.verifier_reconciliation_jobs,public.verifier_portal_actions;\n'+(root/'backend/test/portal-migration.sql').read_text()+'\nROLLBACK;')
    print('PASS: create/edit/delete, endless Undo/Redo, original IDs, stale writes, replay protection, durable jobs and backend-only access',flush=True)
    if has_portal:
        sql('BEGIN; TRUNCATE public.verifier_reconciliation_jobs,public.verifier_portal_actions;\n'+(root/'backend/test/portal-role-changes.sql').read_text()+'\nROLLBACK;')
        print('PASS: role edits, affected audiences, rapid edits, reversals, duplicate rollback and access restrictions',flush=True)

finally:
    run('docker','stop',container)
    print('Disposable portal test database removed',flush=True)
