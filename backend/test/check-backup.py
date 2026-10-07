"""Restore the bot's SQL backup and rehearse its NFT migration locally.

Run from the repository root: python3 backend/test/check-backup.py backup
Requires Docker and the cached Supabase Postgres image. No remote connections.
Supabase-managed auth/storage tables are outside this application-table check.
"""
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import time


root = Path(__file__).resolve().parents[2]
backup = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "backup"
container = f"verethier-backup-check-{os.getpid()}"
image = "public.ecr.aws/supabase/postgres:17.6.1.132"
database = "verethier_backup_check"


def run(stage, *args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        # PostgreSQL error details can include backed-up values. Keep them local.
        log = backup / "restore-test-error.log"
        descriptor = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(result.stderr)
        raise RuntimeError(f"{stage} failed; private error details: {log}")
    return result.stdout


def sql(statement, target=database):
    return run("SQL restore/check", "docker", "exec", "-i", container,
               "psql", "-X", "-U", "postgres", "-d", target,
               "-v", "ON_ERROR_STOP=1", "-qAt", "--single-transaction", "--file=-",
               input=statement.encode()).decode()


def fingerprint(table, upgraded=False):
    row = "to_jsonb(t)"
    if upgraded and table == "verifier_rules":
        row += " - ARRAY['asset_type','chain_id','contract_address','token_standard','token_ids','collection_name']"
    return hashlib.sha256(sql(f"SELECT COALESCE(jsonb_agg({row} ORDER BY t.id), '[]'::jsonb) FROM public.\"{table}\" t;").encode()).hexdigest()


files = {name: (backup / f"{name}.sql").read_text() for name in ["roles", "schema", "data"]}
copy_pattern = re.compile(
    r'^COPY "(?P<schema>[^"\n]+)"\."(?P<table>[^"\n]+)" '
    r'(?P<columns>\([^\n]*\)) FROM stdin;\n(?P<rows>.*?)^\\\.\n',
    re.MULTILINE | re.DOTALL,
)
copies = list(copy_pattern.finditer(files["data"]))
app_copies = [copy for copy in copies if copy["schema"] == "public"]
tables = {copy["table"] for copy in app_copies}
required = {"user_wallets", "verifier_rules", "verifier_user_roles"}
if not required.issubset(tables):
    raise RuntimeError("Backup is missing COPY data sections for the bot's three tables")
if len(tables) != len(app_copies):
    raise RuntimeError("Backup contains repeated application table sections")
sequences = re.findall(r'^SELECT pg_catalog\.setval\(\'"public"\.[^\n]+;', files["data"], re.MULTILINE)
app_data = "\n".join(copy[0] for copy in app_copies) + "\n" + "\n".join(sequences)

run("Starting disposable PostgreSQL", "docker", "run", "--rm", "--detach", "--pull=never",
    "--name", container, "--env", "POSTGRES_PASSWORD=local-backup-test-only", image)
try:
    for attempt in range(45):
        ready = subprocess.run(["docker", "exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], capture_output=True)
        if ready.returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError("Disposable PostgreSQL did not become ready")
    # CREATE DATABASE cannot run inside a transaction.
    run("Creating empty restore target", "docker", "exec", container, "createdb", "-U", "postgres", database)
    # Hosted Supabase already provides these schemas and its Realtime publication.
    sql("CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS vault; CREATE PUBLICATION supabase_realtime;")
    sql(files["roles"] + "\n" + files["schema"] + "\nSET session_replication_role = replica;\n" + app_data)
    print("PASS: schema, custom roles and application data restored without errors")

    for copy in app_copies:
        name = copy["table"]
        columns = copy["columns"]
        actual = sql(f"SET timezone = 'UTC'; SET DateStyle = 'ISO'; SET extra_float_digits = 3; COPY public.\"{name}\" {columns} TO STDOUT;")
        expected_rows = sorted(copy["rows"].splitlines())
        if sorted(actual.splitlines()) != expected_rows:
            raise RuntimeError(f"Restored values differ from the backup for {name}")
        print(f"PASS: {name}: {len(expected_rows)} rows, every backed-up value matches")

    before = {table: fingerprint(table) for table in tables}
    migration = root / "backend/supabase/migrations/20261006223000_add_nft_verification_rules.sql"
    sql(migration.read_text())
    for table in tables:
        if fingerprint(table, upgraded=True) != before[table]:
            raise RuntimeError(f"NFT migration changed existing data in {table}")
    if sql("SELECT count(*) FROM public.verifier_rules WHERE asset_type IS DISTINCT FROM 'ethscription' OR chain_id IS DISTINCT FROM 1;").strip() != "0":
        raise RuntimeError("Existing rules did not receive the expected Ethscriptions defaults")
    print("PASS: NFT migration succeeds and preserves all existing application data")
finally:
    run("Removing disposable database", "docker", "stop", container)
    print("Disposable database removed; remote database was not accessed")
