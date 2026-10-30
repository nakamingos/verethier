"""Rehearse the compressed Solana NFT migration against a private pre-upgrade backup.
Usage: python3 backend/test/check-solana-compressed-migration.py BACKUP_DIRECTORY [GUARDED_APPLY_FILE]
Only a disposable local database is changed. Errors go to /tmp/bouncer-solana-migration-error.log.
"""
from pathlib import Path
import hashlib, os, re, subprocess, sys, time

root = Path(__file__).resolve().parents[2]
backup = Path(sys.argv[1]).resolve()
container = f'bouncer-compressed-check-{os.getpid()}'
image = 'public.ecr.aws/supabase/postgres:17.6.1.132'

def run(*args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        with os.fdopen(os.open(Path('/tmp/bouncer-solana-migration-error.log'), os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o600), 'wb') as log:
            log.write(result.stderr)
        raise RuntimeError('Rehearsal failed; details are in the private /tmp migration log')
    return result.stdout.decode()

def sql(source):
    return run('docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'portal_restore', '-v', 'ON_ERROR_STOP=1', '-qAt', input=source.encode())

files = {name: (backup/f'{name}.sql').read_text() for name in ['roles', 'schema', 'data']}
copies = list(re.finditer(r'^COPY "public"\."([^"\n]+)" \([^\n]*\) FROM stdin;\n.*?^\\\.\n', files['data'], re.M|re.S))
if not {'verifier_rules', 'user_wallets', 'verifier_server_settings'}.issubset({m[1] for m in copies}):
    raise RuntimeError('Incomplete application backup')
sequences = re.findall(r'^SELECT pg_catalog\.setval\(\'"public"\.[^\n]+;', files['data'], re.M)

def fingerprints():
    return {m[1]: hashlib.sha256(sql(f'SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),\'[]\'::jsonb) FROM public."{m[1]}" t;').encode()).hexdigest() for m in copies}

run('docker', 'run', '--rm', '--detach', '--pull=never', '--name', container, '--env', 'POSTGRES_PASSWORD=local-base-test-only', image)
try:
    for _ in range(45):
        if subprocess.run(['docker', 'exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True).returncode == 0:
            break
        time.sleep(1)
    run('docker', 'exec', container, 'createdb', '-U', 'postgres', 'portal_restore')
    sql('CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS vault; CREATE PUBLICATION supabase_realtime;')
    sql(files['roles']+'\n'+files['schema']+'\nSET session_replication_role=replica;\n'+'\n'.join(m[0] for m in copies)+'\n'+'\n'.join(sequences))
    # Older backups need prerequisites; a fresh production backup already has them.
    has_scope = sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='user_wallets' AND column_name='evm_chain_ids';").strip() == '1'
    if not has_scope:
        sql((root/'backend/supabase/migrations/20261027020000_add_base_network.sql').read_text())
        sql((root/'backend/supabase/migrations/20261028010000_smart_wallet_proofs.sql').read_text())
    has_solana = sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='verifier_rules' AND column_name='solana_criteria';").strip() == '1'
    if not has_solana:
        sql((root/'backend/supabase/migrations/20261029010000_solana_verification.sql').read_text())
    before = fingerprints()
    if len(sys.argv) > 2:
        sql("CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]); INSERT INTO supabase_migrations.schema_migrations(version) VALUES('20261029010000');")
        sql(Path(sys.argv[2]).read_text())
        assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261029020000';").strip() == '1'
    else:
        sql((root/'backend/supabase/migrations/20261029020000_solana_compressed_nfts.sql').read_text())
    assert before == fingerprints(), 'Compressed NFT migration changed existing application values'
    print('PASS: every existing application value preserved, including rule criteria and wallet scopes', flush=True)
    sql('BEGIN;\n'+(root/'backend/test/solana-compressed-migration.sql').read_text()+'\nROLLBACK;')
    print('PASS: standard/compressed criteria, rule creation, immutable formats, edits and RPC permissions', flush=True)
finally:
    run('docker', 'stop', container)
    print('Disposable migration database removed', flush=True)
