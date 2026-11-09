"""Rehearse collection-scoped inscription numbers using a private backup in disposable PostgreSQL.
Usage: python3 backend/test/check-collection-inscription-migration.py BACKUP [GUARDED_SQL]
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
container = f"bouncer-collection-inscription-{os.getpid()}"
error_log = Path("/tmp/bouncer-collection-inscription-migration-error.private.log")


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
        rows = sql(f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.\"{table}\" t;")
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
    before = fingerprints()
    if len(sys.argv) > 2:
        sql("SET ROLE postgres; CREATE SCHEMA IF NOT EXISTS supabase_migrations; "
            "CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]); "
            "INSERT INTO supabase_migrations.schema_migrations(version) VALUES('20261109010000');")
        sql(Path(sys.argv[2]).read_text())
        assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261109020000';").strip() == "1"
    else:
        sql("SET ROLE postgres;\n" + (root / "backend/supabase/migrations/20261109020000_collection_inscription_numbers.sql").read_text())
    assert fingerprints() == before, "Existing application values changed"
    sql("BEGIN;\n" + (root / "backend/test/collection-inscription-migration.sql").read_text() + "\nROLLBACK;")
    print(f"PASS: preserved {len(before)} public tables; optional collection scopes, create/edit/duplicate, Undo/Redo and malformed inputs verified", flush=True)
finally:
    run("docker", "stop", container)
    print("Disposable migration database removed", flush=True)
