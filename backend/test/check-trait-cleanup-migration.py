"""Rehearse legacy trait-column cleanup on a private backup and verify every application value.
Usage: python3 backend/test/check-trait-cleanup-migration.py BACKUP_DIRECTORY [GUARDED_APPLY_FILE] [CONSOLIDATION_SQL]
Only a disposable local database is changed; errors stay in the private backup directory.
"""
from pathlib import Path
import hashlib, json, os, re, subprocess, sys, time

root = Path(__file__).resolve().parents[2]
backup = Path(sys.argv[1]).resolve()
container = f'bouncer-cleanup-check-{os.getpid()}'
image = 'public.ecr.aws/supabase/postgres:17.6.1.132'

def run(*args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        with os.fdopen(os.open(backup/'cleanup-restore-error.log', os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o600), 'wb') as log:
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
    return {m[1]: hashlib.sha256(sql(f'SELECT coalesce(jsonb_agg((to_jsonb(t)-\'attribute_key\'-\'attribute_value\') ORDER BY ((to_jsonb(t)-\'attribute_key\'-\'attribute_value\'))::text),\'[]\'::jsonb) FROM public."{m[1]}" t;').encode()).hexdigest() for m in copies}

run('docker', 'run', '--rm', '--detach', '--pull=never', '--name', container, '--env', 'POSTGRES_PASSWORD=local-cleanup-test-only', image)
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
        sql("CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]); INSERT INTO supabase_migrations.schema_migrations(version) VALUES('20261018070000');")
        sql(Path(sys.argv[2]).read_text())
        assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261018080000';").strip() == '1'
    else:
        sql((root/'backend/supabase/migrations/20261018080000_remove_legacy_trait_columns.sql').read_text())
    assert before == fingerprints(), 'Trait cleanup changed existing application values'
    print('PASS: all existing application values preserved', flush=True)
    sql('BEGIN; TRUNCATE public.verifier_rules CASCADE;\n'+(root/'backend/test/trait-cleanup-migration.sql').read_text()+'\nROLLBACK;')
    print('PASS: canonical storage, historical Undo, trait limits and snapshot invalidation', flush=True)
    if len(sys.argv)>3:
        plans=json.loads((Path(sys.argv[3]).parent/'rule-consolidation-plan.json').read_text())
        counts=json.loads(sql("SELECT jsonb_build_object('rules',(SELECT count(*) FROM public.verifier_rules),'actions',(SELECT count(*) FROM public.verifier_portal_actions),'jobs',(SELECT count(*) FROM public.verifier_reconciliation_jobs));"))
        actions_hash=sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.verifier_portal_actions t;")
        actions_ids=sql("SELECT coalesce(jsonb_agg(id),'[]') FROM public.verifier_portal_actions;")
        jobs_ids=sql("SELECT coalesce(jsonb_agg(id),'[]') FROM public.verifier_reconciliation_jobs;")
        jobs_hash=sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-'rule_id' ORDER BY id)::text,'[]')) FROM public.verifier_reconciliation_jobs t;")
        members_hash=sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-'rule_id' ORDER BY id)::text,'[]')) FROM public.verifier_user_roles t;")
        sql(Path(sys.argv[3]).read_text())
        after=fingerprints()
        for table,digest in before.items():
            if table not in ['verifier_rules','verifier_user_roles','verifier_reconciliation_jobs','verifier_portal_actions']:
                assert digest==after[table], 'Consolidation changed unrelated application values'
        assert actions_hash==sql(f"SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) FROM public.verifier_portal_actions t WHERE id IN (SELECT jsonb_array_elements_text('{actions_ids}'::jsonb)::uuid);")
        assert jobs_hash==sql(f"SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-'rule_id' ORDER BY id)::text,'[]')) FROM public.verifier_reconciliation_jobs t WHERE id IN (SELECT jsonb_array_elements_text('{jobs_ids}'::jsonb)::uuid);")
        assert members_hash==sql("SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-'rule_id' ORDER BY id)::text,'[]')) FROM public.verifier_user_roles t;"), 'Assignment data other than pointers changed'
        retired=[r['id'] for p in plans for r in p['before'] if r['id']!=p['after']['id']]
        assert int(sql('SELECT count(*) FROM public.verifier_rules;'))==counts['rules']-len(retired)
        assert int(sql('SELECT count(*) FROM public.verifier_portal_actions;'))==counts['actions']+sum(len(p['before']) for p in plans)
        ids=','.join(str(n) for n in retired)
        assert sql(f"SELECT count(*) FROM public.verifier_rules WHERE id IN ({ids});").strip()=='0'
        assert sql(f"SELECT count(*) FROM public.verifier_user_roles WHERE rule_id IN ({ids});").strip()=='0'
        assert sql(f"SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE rule_id IN ({ids}) AND status IN ('pending','failed');").strip()=='0'
        for p in plans:
            expected=json.dumps(p['after']).replace("'","''")
            assert sql(f"SELECT public.verifier_portal_definition(to_jsonb(r))=public.verifier_portal_definition('{expected}'::jsonb) FROM public.verifier_rules r WHERE id={p['after']['id']};").strip()=='t'
        print('PASS: actual consolidation preserves history, wallets, assignment data, pending audiences and all unrelated tables; retired references redirected',flush=True)

finally:
    run('docker', 'stop', container)
    print('Disposable migration database removed', flush=True)
