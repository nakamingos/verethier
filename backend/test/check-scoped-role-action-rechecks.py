"""Rehearse scoped role-action jobs against a private backup in disposable PostgreSQL.
Usage: python3 backend/test/check-scoped-role-action-rechecks.py BACKUP
No remote database is changed. Existing application values must remain identical.
"""
from pathlib import Path
import hashlib
import os
import re
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[2]
backup = Path(sys.argv[1]).resolve()
container = f"bouncer-role-action-scope-{os.getpid()}"
error_log = Path("/tmp/bouncer-role-action-scope-migration-error.private.log")


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
    before = fingerprints()
    sql("SET ROLE postgres;\n" + (root / "backend/supabase/migrations/20261109070000_scope_role_action_rechecks.sql").read_text())
    assert fingerprints() == before, "Existing application values changed"
    # Verify replace/replay and server-scoped receipts against disposable fixtures.
    for fixture in ["scoped-role-action-rechecks.sql"]:
        sql("BEGIN; TRUNCATE public.verifier_role_actions, public.verifier_member_flows, public.verifier_reconciliation_jobs, public.verifier_member_actions, public.verifier_user_roles, public.verifier_portal_actions, public.user_wallets CASCADE;\n" + (root / "backend/test" / fixture).read_text() + "\nROLLBACK;")
    print(f"PASS: preserved {len(before)} public tables; scoped create/edit/delete jobs, direct enforcement, restoration history, idempotence, receipt isolation and backend-only permissions", flush=True)
finally:
    run("docker", "stop", container)
    print("Disposable migration database removed", flush=True)
