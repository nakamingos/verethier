"""Rehearse community-wallet visibility in disposable PostgreSQL using an existing private backup.
Usage: python3 backend/test/check-community-wallet-migration.py BACKUP_DIRECTORY
No remote connections. No member records or raw SQL errors are printed.
"""
from pathlib import Path
import hashlib, os, re, subprocess, sys, time
root=Path(__file__).resolve().parents[2]
backup=Path(sys.argv[1]).resolve()
container=f'bouncer-community-wallets-{os.getpid()}'
log=Path('/tmp')/f'{container}.private.log'
def run(*args,**kwargs):
 r=subprocess.run(args,capture_output=True,**kwargs)
 if r.returncode:
  with os.fdopen(os.open(log,os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600),'ab') as f: f.write(r.stderr+r.stdout)
  raise RuntimeError(f'Private rehearsal failed; diagnostics: {log}')
 return r.stdout.decode()
def sql(s):return run('docker','exec','-i',container,'psql','-X','-U','postgres','-d','portal_restore','-v','ON_ERROR_STOP=1','-qAt',input=s.encode())
files={n:(backup/f'{n}.sql').read_text() for n in ['roles','schema','data']}
copies=list(re.finditer(r'^COPY "public"\."([^"\n]+)" \([^\n]*\) FROM stdin;\n.*?^\\\.\n',files['data'],re.M|re.S))
sequences=re.findall(r'^SELECT pg_catalog\.setval\(\'"public"\.[^\n]+;',files['data'],re.M)
def fingerprints():
 names=sql("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;").splitlines()
 return {n:hashlib.sha256(sql(f'SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),\'[]\'::jsonb) FROM public."{n}" t;').encode()).hexdigest() for n in names}
run('docker','run','--rm','--detach','--pull=never','--name',container,'--env','POSTGRES_PASSWORD=local-community-test-only','public.ecr.aws/supabase/postgres:17.6.1.132')
try:
 for _ in range(45):
  if subprocess.run(['docker','exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(1)
 run('docker','exec',container,'createdb','-U','postgres','portal_restore')
 sql('CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS vault; CREATE PUBLICATION supabase_realtime;')
 sql(files['roles']+'\n'+files['schema']+'\nSET session_replication_role=replica;\n'+'\n'.join(m[0] for m in copies)+'\n'+'\n'.join(sequences)+'\nSET session_replication_role=origin;')
 # This supported private backup predates the Bouncer log release. Later
 # migrations are prerequisites, not changes performed by the visibility upgrade.
 for path in sorted((root/'backend/supabase/migrations').glob('*.sql')):
  if '20261107020000'<=path.name[:14]<'20261116010000':sql(path.read_text())
 sql("INSERT INTO public.user_wallets(user_id,address,wallet_type,last_verified_at) VALUES('111111111111111111','0xabcabcabcabcabcabcabcabcabcabcabcabcabca','evm',now()),('111111111111111111','0xdefdefdefdefdefdefdefdefdefdefdefdefdefd','evm',now());")
 before=fingerprints()
 sql((root/'backend/supabase/migrations/20261116010000_community_wallet_visibility.sql').read_text())
 after=fingerprints()
 assert all(after[n]==value for n,value in before.items()),'Visibility migration changed existing application records'
 print('PASS: additive migration preserves every existing application record',flush=True)
 sql('BEGIN;\n'+(root/'backend/test/community-wallet-migration.sql').read_text()+'\nROLLBACK;')
 print('PASS: grandfathering, proof transitions, opt-outs, transfer/removal, isolation, exports eligibility, retention, and restricted SQL access',flush=True)
finally:
 run('docker','stop',container)
 print('Disposable community-wallet database removed',flush=True)
