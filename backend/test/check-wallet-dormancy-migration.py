"""Rehearse wallet dormancy and signed reactivation using a private backup in disposable PostgreSQL.
Usage: python3 backend/test/check-wallet-dormancy-migration.py BACKUP [GUARDED_SQL]
No remote database is changed. Existing application values must remain identical.
"""
from pathlib import Path
import hashlib
import os
import re
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

root = Path(__file__).resolve().parents[2]
backup = Path(sys.argv[1]).resolve()
container = f"bouncer-wallet-dormancy-{os.getpid()}"
error_log = Path("/tmp/bouncer-wallet-dormancy-migration-error.private.log")


def run(*args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        with os.fdopen(os.open(error_log, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "wb") as log:
            log.write(result.stderr)
        raise RuntimeError(f"Migration rehearsal failed; details in {error_log}")
    return result.stdout.decode()


def sql(source):
    return run("docker", "exec", "-i", container, "psql", "-X", "-U", "supabase_admin",
               "-d", "rehearsal", "-v", "ON_ERROR_STOP=1", "-qAt", input=source.encode())


files = {name: (backup / f"{name}.sql").read_text() for name in ["roles", "schema", "data"]}
tables = re.findall(r'-- Data for Name: ([a-z_]+); Type: TABLE DATA; Schema: public;', files['data'])
if not {'user_wallets', 'verifier_member_actions', 'verifier_privacy_choices'}.issubset(set(tables)):
    raise RuntimeError('Incomplete application backup')


def fingerprints():
    result = {}
    for table in tables:
        rows = sql(f"SELECT coalesce(jsonb_agg((to_jsonb(t)-'ordinal_provider_policy') ORDER BY (to_jsonb(t)-'ordinal_provider_policy')::text),'[]'::jsonb) FROM public.\"{table}\" t;")
        result[table] = hashlib.sha256(rows.encode()).hexdigest()
    return result


run("docker", "run", "--rm", "--detach", "--pull=never", "--name", container,
    "--env", "POSTGRES_PASSWORD=disposable-audit-test", "public.ecr.aws/supabase/postgres:17.6.1.132")
try:
    for _ in range(45):
        ready = subprocess.run(["docker", "exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "supabase_admin"], capture_output=True)
        if ready.returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError("Disposable PostgreSQL did not become ready")
    # postgres owns the production database; retain its default table grants.
    run("docker", "exec", container, "createdb", "-U", "supabase_admin", "--owner", "postgres", "rehearsal")
    sql("CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS vault; CREATE PUBLICATION supabase_realtime;")
    sql(files["roles"] + "\n" + files["schema"] + "\nSET session_replication_role=replica;\n"
        + files["data"])
    # This backup may precede the immediately previous bulk-worker release.
    if sql("SELECT position('591228933' IN pg_get_functiondef('public.verifier_claim_bulk_role_member(uuid)'::regprocedure));").strip() == '0':
        sql("SET ROLE postgres;\n" + (root / "backend/supabase/migrations/20261109030000_bulk_role_throughput_resume.sql").read_text())
    if sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='verifier_reconciliation_jobs' AND column_name='ordinal_provider_policy';").strip() == '0':
        sql("SET ROLE postgres;\n" + (root / "backend/supabase/migrations/20261109040000_ordnet_rule_save_checks.sql").read_text())
    if sql("SELECT to_regprocedure('public.verifier_delete_bulk_role_check(text,uuid)') IS NULL;").strip() == 't':
        sql("SET ROLE postgres;\n" + (root / "backend/supabase/migrations/20261109050000_delete_bulk_role_checks.sql").read_text())
    originals = sql("SELECT proname || ':' || md5(prosrc) FROM pg_proc JOIN pg_namespace n ON n.oid=pronamespace WHERE n.nspname='public' AND proname IN ('verifier_link_verified_wallet','verifier_member_link_wallet') ORDER BY proname;").strip()
    before = fingerprints()
    if len(sys.argv) > 2:
        sql("SET ROLE postgres; CREATE SCHEMA IF NOT EXISTS supabase_migrations; "
            "CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]); "
            "INSERT INTO supabase_migrations.schema_migrations(version) VALUES('20261109050000');")
        sql(Path(sys.argv[2]).read_text())
        assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261109060000';").strip() == '1'
    else:
        sql("SET ROLE postgres;\n" + (root / "backend/supabase/migrations/20261109060000_wallet_dormancy.sql").read_text())
    assert fingerprints() == before, "Existing application values changed"
    preserved = sql("SELECT replace(proname,'_before_dormancy','') || ':' || md5(prosrc) FROM pg_proc JOIN pg_namespace n ON n.oid=pronamespace WHERE n.nspname='public' AND proname IN ('verifier_link_verified_wallet_before_dormancy','verifier_member_link_wallet_before_dormancy') ORDER BY proname;").strip()
    assert originals == preserved, "Existing proof implementation changed"
    sql("BEGIN;\n" + (root / "backend/test/wallet-dormancy-migration.sql").read_text() + "\nROLLBACK;")
    sql("BEGIN;\n" + (root / "backend/test/smart-wallet-migration.sql").read_text() + "\nROLLBACK;")
    # Real simultaneous sessions: an older zero result must never survive a
    # fresh signature, whichever session obtains the wallet lock first.
    server, user = 'dormancy-signature-race', 'dormancy-race-member'
    address = '0x' + 'de' * 20
    sql(f"SELECT public.verifier_portal_mutate_rule('{server}','admin','{uuid.uuid4()}',NULL,'{{\"server_id\":\"{server}\",\"server_name\":\"Test\",\"channel_id\":\"verify\",\"channel_name\":\"verify\",\"role_id\":\"977777777777777779\",\"role_name\":\"Holder\",\"asset_type\":\"ethscription\",\"chain_id\":1,\"slug\":\"nakamingos\",\"min_items\":1}}'::jsonb);")
    for _ in range(6):
        sql(f"SELECT public.verifier_link_verified_wallet('{user}','{address}','evm',NULL,'{uuid.uuid4()}','discord','{server}',NULL);")
        proof = sql(f"SELECT last_verified_at FROM public.user_wallets WHERE address='{address}';").strip()
        gate = Barrier(2)
        def race(statement):
            gate.wait()
            return sql("SET statement_timeout='10s'; " + statement)
        with ThreadPoolExecutor(max_workers=2) as pool:
            mark = pool.submit(race, f"SELECT public.verifier_mark_wallet_dormant('{user}','{server}','{address}','ethereum','{proof}',(SELECT jsonb_agg(to_jsonb(r)) FROM public.verifier_rules r WHERE server_id='{server}'));")
            sign = pool.submit(race, f"SELECT public.verifier_link_verified_wallet('{user}','{address}','evm',NULL,'{uuid.uuid4()}','discord','{server}',NULL);")
            mark.result(), sign.result()
        assert sql(f"SELECT count(*) FROM public.verifier_wallet_dormancy WHERE address='{address}';").strip() == '0'
    print(f"PASS: preserved {len(before)} public tables; dormancy coverage, proof scope, reactivation, cancellation, privacy, signature regression and six simultaneous proof races passed", flush=True)
finally:
    run("docker", "stop", container)
    print("Disposable migration database removed", flush=True)
