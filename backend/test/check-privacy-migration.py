"""Restore a private backup into disposable PostgreSQL and test privacy boundaries.
Usage: python3 backend/test/check-privacy-migration.py BACKUP_DIRECTORY [GUARDED_APPLY_FILE]
Never prints member rows or database errors; diagnostic logs remain private.
"""
from pathlib import Path
import hashlib, os, re, subprocess, sys, time
root=Path(__file__).resolve().parents[2]
backup=Path(sys.argv[1]).resolve()
container=f'bouncer-privacy-check-{os.getpid()}'

def run(*args, **kwargs):
    r=subprocess.run(args,capture_output=True,**kwargs)
    if r.returncode:
        with os.fdopen(os.open(backup/'privacy-rehearsal-error.log',os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600),'wb') as log: log.write(r.stderr)
        raise RuntimeError('Privacy rehearsal failed; details are in the private backup log')
    return r.stdout.decode()

def sql(source):
    return run('docker','exec','-i',container,'psql','-X','-U','postgres','-d','portal_restore','-v','ON_ERROR_STOP=1','-qAt',input=source.encode())
files={n:(backup/f'{n}.sql').read_text() for n in ['roles','schema','data']}
copies=list(re.finditer(r'^COPY "public"\."([^"\n]+)" \([^\n]*\) FROM stdin;\n.*?^\\\.\n',files['data'],re.M|re.S))
assert {'user_wallets','verifier_member_actions','verifier_rules'}.issubset({m[1] for m in copies})
sequences=re.findall(r'^SELECT pg_catalog\.setval\(\'"public"\.[^\n]+;',files['data'],re.M)
def fingerprints():
    return {m[1]:hashlib.sha256(sql(f'SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),\'[]\'::jsonb) FROM public."{m[1]}" t;').encode()).hexdigest() for m in copies}
run('docker','run','--rm','--detach','--pull=never','--name',container,'--env','POSTGRES_PASSWORD=local-privacy-test-only','public.ecr.aws/supabase/postgres:17.6.1.132')
try:
    for _ in range(45):
        if subprocess.run(['docker','exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0: break
        time.sleep(1)
    run('docker','exec',container,'createdb','-U','postgres','portal_restore')
    sql('CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS vault; CREATE PUBLICATION supabase_realtime;')
    sql(files['roles']+'\n'+files['schema']+'\nSET session_replication_role=replica;\n'+'\n'.join(m[0] for m in copies)+'\n'+'\n'.join(sequences))
    before=fingerprints()
    if len(sys.argv)>2:
        sql("CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]); INSERT INTO supabase_migrations.schema_migrations(version) VALUES('20261018080000');")
        sql(Path(sys.argv[2]).read_text())
        assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261027010000';").strip()=='1'
    else:
        sql((root/'backend/supabase/migrations/20261027010000_privacy_controls.sql').read_text())
    assert before==fingerprints(),'Existing application values changed during additive migration'
    print('PASS: migration preserves every existing application value',flush=True)
    sql('BEGIN;\n'+(root/'backend/test/privacy-migration.sql').read_text()+'\nROLLBACK;')
    print('PASS: default privacy, sharing epochs, filtered audits, retention, deletion, export leases and database permissions',flush=True)
finally:
    run('docker','stop',container)
    print('Disposable privacy rehearsal database removed',flush=True)
