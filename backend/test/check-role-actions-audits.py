"""Restore a private backup, check preservation, and exercise role actions and wallet-history audits.
Usage: python3 backend/test/check-role-actions-audits.py BACKUP_DIRECTORY [GUARDED_APPLY_FILE]
No remote connections; the disposable database is removed even on failure.
"""
from pathlib import Path
import hashlib, os, re, subprocess, sys, time
root=Path(__file__).resolve().parents[2]
backup=Path(sys.argv[1]).resolve()
container=f'bouncer-role-actions-check-{os.getpid()}'
image='public.ecr.aws/supabase/postgres:17.6.1.132'
def run(*args,**kwargs):
    result=subprocess.run(args,capture_output=True,**kwargs)
    if result.returncode:
        fd=os.open(backup/'role-actions-restore-error.log',os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
        with os.fdopen(fd,'wb') as file:file.write(result.stderr)
        raise RuntimeError('Private restore error saved in backup directory')
    return result.stdout.decode()
def sql(s):return run('docker','exec','-i',container,'psql','-X','-U','postgres','-d','portal_restore','-v','ON_ERROR_STOP=1','-qAt',input=s.encode())
files={name:(backup/f'{name}.sql').read_text() for name in ['roles','schema','data']}
copies=list(re.finditer(r'^COPY "public"\."([^"\n]+)" \([^\n]*\) FROM stdin;\n.*?^\\\.\n',files['data'],re.M|re.S))
if not {'verifier_rules','user_wallets','verifier_user_roles'}.issubset({m[1] for m in copies}):raise RuntimeError('Incomplete application backup')
sequences=re.findall(r'^SELECT pg_catalog\.setval\(\'"public"\.[^\n]+;',files['data'],re.M)
def fingerprints():
    output={}
    for m in copies:
        row="to_jsonb(t) - 'role_action_role_id'"
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
    before=fingerprints()
    if len(sys.argv)>2:
        sql("CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]); INSERT INTO supabase_migrations.schema_migrations(version) VALUES('20261018030000');")
        sql(Path(sys.argv[2]).read_text())
        assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261018040000';").strip()=='1','Migration history was not recorded'
    else:
        sql((root/'backend/supabase/migrations/20261018040000_role_actions_wallet_audits.sql').read_text())
    assert before==fingerprints(),'Role-action/audit migration changed existing data'
    print('PASS: private backup restored; role-action/audit migration preserves every application value',flush=True)
    sql('BEGIN; TRUNCATE public.verifier_role_actions,public.verifier_member_flows,public.verifier_reconciliation_jobs,public.verifier_member_actions,public.verifier_user_roles,public.verifier_portal_actions,public.user_wallets CASCADE;\n'+(root/'backend/test/role-actions-audits.sql').read_text()+'\nROLLBACK;')
    print('PASS: role-action versioning/cycles/durable jobs and private, complete wallet-audit grouping/pagination',flush=True)

finally:
    run('docker','stop',container)
    print('Disposable portal test database removed',flush=True)
