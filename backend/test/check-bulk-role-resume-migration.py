"""Rehearse bulk throughput and resumable checkpoints using a private backup in disposable PostgreSQL.
Usage: python3 backend/test/check-bulk-role-resume-migration.py BACKUP [GUARDED_SQL]
No remote database is changed. Existing application values must remain identical.
"""
from pathlib import Path
import hashlib
import os
import re
import subprocess
import sys
import time
import json
import uuid
from concurrent.futures import ThreadPoolExecutor

root = Path(__file__).resolve().parents[2]
backup = Path(sys.argv[1]).resolve()
container = f"bouncer-bulk-role-resume-{os.getpid()}"
error_log = Path("/tmp/bouncer-bulk-role-resume-migration-error.private.log")


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
            "INSERT INTO supabase_migrations.schema_migrations(version) VALUES('20261109020000');")
        sql(Path(sys.argv[2]).read_text())
        assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261109030000';").strip() == "1"
    else:
        sql("SET ROLE postgres;\n" + (root / "backend/supabase/migrations/20261109030000_bulk_role_throughput_resume.sql").read_text())
    assert fingerprints() == before, "Existing application values changed"
    sql("BEGIN;\n" + (root / "backend/test/bulk-role-resume-migration.sql").read_text() + "\nROLLBACK;")
    # Separate committed sessions exercise real claim/completion races.
    sql("UPDATE public.verifier_bulk_role_jobs SET status='cancelled' WHERE status IN ('pending','running'); "
        "UPDATE public.verifier_bulk_role_members SET locked_until=now()-interval '1 second' WHERE status='running';")
    jobs = [str(uuid.uuid4()), str(uuid.uuid4())]
    members = [{"id": str(994444444444444440 + index), "name": "Synthetic member"} for index in range(6)]
    for job in jobs:
        payload = json.dumps({"id": job, "server_id": "995555555555555555", "created_by": "996666666666666666", "audience": "verified", "mode": "grant", "rules_version": "v1", "labels": {}})
        sql(f"SELECT public.verifier_bulk_role_preview('{payload}'::jsonb,'{json.dumps(members)}'::jsonb); "
            f"SELECT public.verifier_bulk_role_transition('{job}','995555555555555555','996666666666666666','start','{uuid.uuid4()}');")

    def claim(_):
        return json.loads(sql(f"SET statement_timeout='10s'; SELECT coalesce(jsonb_agg(jsonb_build_object('job',job_id,'user',user_id,'worker',locked_by)),'[]'::jsonb) FROM public.verifier_claim_bulk_role_member('{uuid.uuid4()}');").strip())

    def finish(item):
        sql(f"SET statement_timeout='10s'; SELECT public.verifier_finish_bulk_role_member('{item['job']}','{item['user']}','{item['worker']}','{{}}'::jsonb,false);")

    with ThreadPoolExecutor(max_workers=12) as workers:
        first = [row for result in workers.map(claim, range(12)) for row in result]
        assert len(first) == 6 and len({row['user'] for row in first}) == 6, "Concurrent jobs claimed the same member"
        assert {row['job'] for row in first} == {jobs[0]}, "First job should claim its eligible audience"
        list(workers.map(finish, first))
        assert sql(f"SELECT status FROM public.verifier_bulk_role_jobs WHERE id='{jobs[0]}';").strip() == "completed", "Concurrent completion left a job running"
        second = [row for result in workers.map(claim, range(12)) for row in result]
        assert len(second) == 6 and {row['job'] for row in second} == {jobs[1]}
        list(workers.map(finish, second))
        assert sql(f"SELECT status FROM public.verifier_bulk_role_jobs WHERE id='{jobs[1]}';").strip() == "completed"
    print(f"PASS: preserved {len(before)} public tables; checkpoint/resume/retry guards and 12 concurrent claim/completion sessions verified", flush=True)
finally:
    run("docker", "stop", container)
    print("Disposable migration database removed", flush=True)
