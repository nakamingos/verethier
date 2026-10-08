"""Restore the bot's SQL backup and rehearse its NFT, L2, Ordinals and trait migrations.

Run: python3 backend/test/check-backup.py backup [ordinal-sql-file] [trait-sql-file]
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
ordinal_sql = Path(sys.argv[2]) if len(sys.argv) > 2 else root / "backend/supabase/migrations/20261008010000_add_ordinals_verification.sql"
trait_sql = Path(sys.argv[3]) if len(sys.argv) > 3 else root / "backend/supabase/migrations/20261008020000_add_nft_trait_verification.sql"
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


def fingerprint(table, upgraded=False, ordinal_upgraded=False):
    row = "to_jsonb(t)"
    if upgraded and table == "verifier_rules":
        row += " - ARRAY['asset_type','chain_id','contract_address','token_standard','token_ids','collection_name']"
    if ordinal_upgraded and table == "user_wallets":
        row += " - 'wallet_type'"
    return hashlib.sha256(sql(f"SELECT COALESCE(jsonb_agg({row} ORDER BY ({row})::text), '[]'::jsonb) FROM public.\"{table}\" t;").encode()).hexdigest()


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

    has_nft_columns = sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='verifier_rules' AND column_name='asset_type';").strip() == "1"
    if not has_nft_columns:
        before = {table: fingerprint(table) for table in tables}
        migration = root / "backend/supabase/migrations/20261006223000_add_nft_verification_rules.sql"
        sql(migration.read_text())
        for table in tables:
            if fingerprint(table, upgraded=True) != before[table]:
                raise RuntimeError(f"NFT migration changed existing data in {table}")
        if sql("SELECT count(*) FROM public.verifier_rules WHERE asset_type IS DISTINCT FROM 'ethscription' OR chain_id IS DISTINCT FROM 1;").strip() != "0":
            raise RuntimeError("Existing rules did not receive the expected Ethscriptions defaults")
        print("PASS: NFT migration succeeds and preserves all existing application data")
    has_ordinal_columns = sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='user_wallets' AND column_name='wallet_type';").strip() == "1"
    if not has_ordinal_columns:
        # Rehearse the L2 upgrade before Ordinals; never downgrade an Ordinals backup.
        before_robinhood = {table: fingerprint(table) for table in tables}
        sql((root / "backend/supabase/migrations/20261007033000_add_robinhood_nft_rules.sql").read_text())
        for table in tables:
            if fingerprint(table) != before_robinhood[table]:
                raise RuntimeError(f"Robinhood migration changed existing data in {table}")
        print("PASS: Robinhood migration succeeds and preserves all existing application data")

        before_ordinals = {table: fingerprint(table) for table in tables}
        if len(sys.argv) > 2:
            # Only in this disposable database: model the production history table
            # so the exact guarded rollout transaction can also be rehearsed.
            sql("""CREATE SCHEMA IF NOT EXISTS supabase_migrations;
              CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
                version text PRIMARY KEY, applied_at timestamptz DEFAULT now(), statements text[], name text);
              INSERT INTO supabase_migrations.schema_migrations (version, name)
                VALUES ('20261006223000', 'add_nft_verification_rules'), ('20261007033000', 'add_robinhood_nft_rules')
                ON CONFLICT DO NOTHING;""")
        sql(ordinal_sql.read_text())
        for table in tables:
            if fingerprint(table, ordinal_upgraded=True) != before_ordinals[table]:
                raise RuntimeError(f"Ordinals migration changed existing data in {table}")
        if sql("SELECT count(*) FROM public.user_wallets WHERE wallet_type IS DISTINCT FROM 'evm';").strip() != "0":
            raise RuntimeError("Existing wallets did not receive the expected EVM default")
        print("PASS: Ordinals migration succeeds and preserves every existing application value")
    else:
        print("PASS: backup already includes the Ordinals wallet schema")
    sql((root / "backend/test/ordinals-migration.sql").read_text())
    print("PASS: Bitcoin wallet and Ordinals rule constraints and duplicate guards")
    has_traits = sql("SELECT to_regclass('public.nft_token_metadata') IS NOT NULL;").strip() == "t"
    if not has_traits:
        before_traits = {table: fingerprint(table) for table in tables}
        if len(sys.argv) > 3:
            # Only in this disposable database, recreate the linked migration history.
            sql("""CREATE SCHEMA IF NOT EXISTS supabase_migrations;
              CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
                version text PRIMARY KEY, applied_at timestamptz DEFAULT now(), statements text[], name text);
              INSERT INTO supabase_migrations.schema_migrations (version)
                VALUES ('20261006223000'), ('20261007033000'), ('20261008010000')
                ON CONFLICT DO NOTHING;""")
        sql(trait_sql.read_text())
        for table in tables:
            if fingerprint(table) != before_traits[table]:
                raise RuntimeError(f"NFT trait migration changed existing data in {table}")
        print("PASS: NFT trait migration succeeds and preserves every existing application value")
    sql((root / "backend/test/nft-traits-migration.sql").read_text())
    print("PASS: NFT trait rules, duplicate guards, uint256 cache IDs and cache permissions")
    sql((root / "backend/test/nft-migration.sql").read_text())
    sql((root / "backend/test/robinhood-nft-migration.sql").read_text())
    print("PASS: existing ERC-721, ERC-1155 and Robinhood rule constraints")
finally:
    run("Removing disposable database", "docker", "stop", container)
    print("Disposable database removed; remote database was not accessed")
