"""Test migration preservation and a backup restore in a disposable Docker DB.

Run: python3 test/check-nft-migration.py (from backend).
Requires Docker and the cached Supabase Postgres image below; no remote access.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

root = Path(__file__).resolve().parents[1]
container = f"verethier-nft-check-{os.getpid()}"
image = "public.ecr.aws/supabase/postgres:17.6.1.132"


def run(*args, **kwargs):
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(result.stderr.decode().strip())
    return result


def sql(statement, database="postgres"):
    return run("docker", "exec", "-i", container, "psql", "-U", "postgres",
               "-d", database, "-v", "ON_ERROR_STOP=1", "-At",
               input=statement.encode()).stdout.decode().strip()


def snapshot(database="postgres", upgraded=False):
    rule = "to_jsonb(r)"
    if upgraded:
        rule += " - ARRAY['asset_type','chain_id','contract_address','token_standard','token_ids','collection_name']"
    return json.loads(sql(f"""
      SELECT json_build_object(
        'rules', (SELECT json_agg({rule} ORDER BY r.id) FROM verifier_rules r),
        'wallets', (SELECT json_agg(w ORDER BY w.id) FROM user_wallets w),
        'roles', (SELECT json_agg(a ORDER BY a.id) FROM verifier_user_roles a));
    """, database))


run("docker", "run", "--rm", "--detach", "--name", container,
    "--env", "POSTGRES_PASSWORD=local-migration-test-only", image)
try:
    for attempt in range(30):
        ready = subprocess.run(["docker", "exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], capture_output=True)
        if ready.returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError("Disposable PostgreSQL did not become ready")
    migrations = root / "supabase/migrations"
    initial_nft_migration = migrations / "20261006223000_add_nft_verification_rules.sql"
    for path in sorted(migrations.glob("*.sql")):
        if path.name >= initial_nft_migration.name:
            continue
        sql(path.read_text())
    sql("""
      INSERT INTO verifier_rules (server_id, channel_id, role_id, slug, min_items)
        VALUES ('legacy-server', 'legacy-channel', 'legacy-role', 'example', 3);
      INSERT INTO user_wallets (user_id, address)
        VALUES ('legacy-user', '0x2222222222222222222222222222222222222222');
      INSERT INTO verifier_user_roles (user_id, server_id, role_id, rule_id, verification_data)
        VALUES ('legacy-user', 'legacy-server', 'legacy-role', 1, '{"existing_metadata":true}');
    """)
    before = snapshot()
    with tempfile.TemporaryDirectory(prefix="verethier-migration-") as directory:
        dump = Path(directory) / "before-nft.dump"
        dump.write_bytes(run("docker", "exec", container, "pg_dump", "-U", "postgres", "-Fc", "postgres").stdout)
        run("docker", "cp", str(dump), f"{container}:/tmp/before-nft.dump")
        run("docker", "exec", container, "pg_restore", "--list", "/tmp/before-nft.dump")
        sql("CREATE DATABASE verethier_restore_check;")
        # The migration changes only public application tables. Supabase owns
        # managed schemas such as vault; restore the app schema into the empty DB.
        run("docker", "exec", container, "pg_restore", "-U", "postgres", "--exit-on-error", "--schema=public",
            "--no-owner", "--no-privileges", "-d", "verethier_restore_check", "/tmp/before-nft.dump")
        assert snapshot("verethier_restore_check") == before, "Backup restore changed existing data"
    sql(initial_nft_migration.read_text())
    assert snapshot(upgraded=True) == before, "NFT migration changed existing rules, wallets or assignments"
    assert sql("SELECT asset_type || ':' || chain_id FROM verifier_rules WHERE id=1;") == "ethscription:1"
    sql((root / "test/nft-migration.sql").read_text())
    sql("""
      INSERT INTO verifier_rules (server_id, role_id, slug, asset_type, contract_address, token_standard, token_ids, collection_name)
        VALUES ('existing-nft', 'holder', NULL, 'nft', '0x1111111111111111111111111111111111111111', 'erc1155', ARRAY['0', '1'], 'Existing collection');
    """)
    before_robinhood = snapshot()
    sql((migrations / "20261007033000_add_robinhood_nft_rules.sql").read_text())
    assert snapshot() == before_robinhood, "Robinhood migration changed existing rules, wallets or assignments"
    sql((root / "test/robinhood-nft-migration.sql").read_text())
    before_ordinals = snapshot()
    sql((migrations / "20261008010000_add_ordinals_verification.sql").read_text())
    after_ordinals = snapshot()
    for wallet in after_ordinals["wallets"]:
        assert wallet.pop("wallet_type") == "evm", "Existing wallet was not classified as EVM"
    assert after_ordinals == before_ordinals, "Ordinals migration changed existing application records"
    sql((root / "test/ordinals-migration.sql").read_text())
    with tempfile.TemporaryDirectory(prefix="verethier-nft-backup-") as directory:
        backup = Path(directory)
        (backup / "roles.sql").write_text("")
        for kind, option in [("schema", "--schema-only"), ("data", "--data-only")]:
            dump = run(
                "docker", "exec", container, "pg_dump", "-U", "postgres", "--schema=public",
                "--quote-all-identifiers", "--no-owner", "--no-privileges", "--no-publications", option, "postgres").stdout
            # Match Supabase CLI's schema dump, which omits creation of the existing public schema.
            if kind == "schema":
                dump = dump.replace(b'CREATE SCHEMA "public";\n', b'')
            (backup / f"{kind}.sql").write_bytes(dump)
        try:
            run(sys.executable, str(root / "test/check-backup.py"), str(backup))
        except RuntimeError:
            # This backup contains only the dummy rows above, so diagnostics are safe to show.
            log = backup / "restore-test-error.log"
            if log.exists():
                raise RuntimeError(log.read_text())
            raise
    print("PASS: existing rules, wallets and role assignments preserved")
    print("PASS: public app schema restored from custom-format backup with identical test data")
    print("PASS: NFT constraints and duplicate indexes, including 1,000 IDs")
    print("PASS: Robinhood migration preserves Ethscriptions and Ethereum NFT rules; network constraints and duplicate indexes work")
    print("PASS: Ordinals migration preserves existing records and adds Bitcoin wallets, quantity rules and duplicate guards")
    print("PASS: SQL backup checker also restores a database with existing NFT columns and Ethereum NFT rules")
except Exception:
    logs = run("docker", "logs", container)
    print((logs.stdout + logs.stderr).decode()[-5000:])
    raise
finally:
    run("docker", "stop", container)
