"""Rehearse setup assistance on a private backup and verify every application value.
Usage: python3 backend/test/check-setup-migration.py BACKUP_DIRECTORY [GUARDED_APPLY_FILE]
Only a disposable local database is changed; errors stay in the private backup directory.
"""
from pathlib import Path
import hashlib, os, re, subprocess, sys, time

root = Path(__file__).resolve().parents[2]
backup = Path(sys.argv[1]).resolve()
container = f'bouncer-setup-check-{os.getpid()}'
image = 'public.ecr.aws/supabase/postgres:17.6.1.132'

def run(*args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        with os.fdopen(os.open(backup/'setup-restore-error.log', os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o600), 'wb') as log:
            log.write(result.stderr)
        raise RuntimeError('Rehearsal failed; details are in the private backup log')
    return result.stdout.decode()

def sql(source):
    return run('docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'portal_restore', '-v', 'ON_ERROR_STOP=1', '-qAt', input=source.encode())

files = {name: (backup/f'{name}.sql').read_text() for name in ['roles', 'schema', 'data']}
copies = list(re.finditer(r'^COPY "public"\."([^"\n]+)" \([^\n]*\) FROM stdin;\n.*?^\\\.\n', files['data'], re.M|re.S))
if not {'verifier_rules', 'user_wallets', 'verifier_server_settings'}.issubset({m[1] for m in copies}):
    raise RuntimeError('Incomplete application backup')
sequences = re.findall(r'^SELECT pg_catalog\.setval\(\'"public"\.[^\n]+;', files['data'], re.M)

def fingerprints():
    return {m[1]: hashlib.sha256(sql(f'SELECT coalesce(jsonb_agg(to_jsonb(t)-\'admin_channel_id\' ORDER BY (to_jsonb(t)-\'admin_channel_id\')::text),\'[]\'::jsonb) FROM public."{m[1]}" t;').encode()).hexdigest() for m in copies}

run('docker', 'run', '--rm', '--detach', '--pull=never', '--name', container, '--env', 'POSTGRES_PASSWORD=local-setup-test-only', image)
try:
    for _ in range(45):
        if subprocess.run(['docker', 'exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True).returncode == 0:
            break
        time.sleep(1)
    run('docker', 'exec', container, 'createdb', '-U', 'postgres', 'portal_restore')
    sql('CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS vault; CREATE PUBLICATION supabase_realtime;')
    sql(files['roles']+'\n'+files['schema']+'\nSET session_replication_role=replica;\n'+'\n'.join(m[0] for m in copies)+'\n'+'\n'.join(sequences))
    before = fingerprints()
    if len(sys.argv) > 2:
        sql("CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]); INSERT INTO supabase_migrations.schema_migrations(version) VALUES('20261018040000');")
        sql(Path(sys.argv[2]).read_text())
        assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261018050000';").strip() == '1'
    else:
        sql((root/'backend/supabase/migrations/20261018050000_setup_assistance.sql').read_text())
    assert before == fingerprints(), 'Setup migration changed existing application values'
    print('PASS: private backup restored; setup migration preserves every application value', flush=True)
    sql('BEGIN; TRUNCATE public.verifier_setup_requests, public.verifier_reconciliation_jobs, public.verifier_portal_actions, public.verifier_server_settings CASCADE;\n'+(root/'backend/test/setup-assistance.sql').read_text()+'\nROLLBACK;')
    print('PASS: setup preview scope, replay, expiry, per-server leases, stale-worker fencing, settings conflicts, audit receipts and private access', flush=True)
    # Pause the first settings INSERT after its missing-row check. Another
    # connection wins the insert; setup must not overwrite that newer choice.
    sql("""
    CREATE FUNCTION public.setup_test_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
     IF current_setting('bouncer.setup.race',true)='true' THEN PERFORM pg_sleep(3); END IF;
     RETURN NEW;
    END $$;
    CREATE TRIGGER setup_test_pause BEFORE INSERT ON public.verifier_server_settings FOR EACH ROW EXECUTE FUNCTION public.setup_test_pause();
    SELECT public.verifier_setup_request('preview','901111111111111111','902222222222222222','90111111-1111-4111-8111-111111111111','{"kind":"channels","before":{"admin_channel_id":null,"verification_channel_id":null}}');
    SELECT public.verifier_setup_request('claim','901111111111111111','902222222222222222','90111111-1111-4111-8111-111111111111','{}','90222222-2222-4222-8222-222222222222');
    """)
    race_sql = """SET application_name='bouncer-setup-race'; SET bouncer.setup.race='true';
    SELECT public.verifier_setup_request('finish','901111111111111111','902222222222222222','90111111-1111-4111-8111-111111111111','{"admin_channel_id":"903333333333333333","verification_channel_id":"904444444444444444"}','90222222-2222-4222-8222-222222222222');"""
    racer = subprocess.Popen(['docker','exec','-i',container,'psql','-X','-U','postgres','-d','portal_restore','-v','ON_ERROR_STOP=1','-qAt','-c',race_sql], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    for _ in range(100):
        if sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='bouncer-setup-race' AND wait_event='PgSleep';").strip() == '1':
            break
        time.sleep(0.02)
    else:
        racer.kill()
        racer.communicate()
        raise RuntimeError('Concurrent settings test did not enter its controlled insert window')
    sql("INSERT INTO public.verifier_server_settings(server_id,verification_channel_id,background_checks_enabled,updated_by) VALUES('901111111111111111','905555555555555555',false,'902222222222222222');")
    _, error = racer.communicate(timeout=10)
    assert racer.returncode != 0 and b'Channel settings changed' in error, 'Setup accepted a concurrent first settings insert'
    assert sql("SELECT verification_channel_id='905555555555555555' AND NOT background_checks_enabled FROM public.verifier_server_settings WHERE server_id='901111111111111111';").strip() == 't'
    print('PASS: concurrent first settings save wins without being overwritten by setup', flush=True)
finally:
    run('docker', 'stop', container)
    print('Disposable setup test database removed', flush=True)
