// Run with backend DB_SUPABASE_URL and DB_SUPABASE_KEY, using a service credential.
// Keep recovery ledgers restricted; they contain pseudonymous account fingerprints.
const fs = require("node:fs");
const { createClient } = require("@supabase/supabase-js");
const [operation, file] = process.argv.slice(2);
if (!file || !["snapshot", "reapply"].includes(operation))
  throw new Error(
    "Usage: node backend/scripts/privacy-recovery.cjs snapshot|reapply PRIVATE_LEDGER_FILE",
  );
const db = createClient(
  process.env.DB_SUPABASE_URL,
  process.env.DB_SUPABASE_KEY,
  { auth: { persistSession: false } },
);
(async () => {
  if (operation === "snapshot") {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const r = await db
        .from("verifier_privacy_deletions")
        .select("id,subject_hash,completed_at")
        .not("subject_hash", "is", null)
        .order("id")
        .range(offset, offset + 999);
      if (r.error) throw new Error("Cannot read deletion recovery ledger.");
      rows.push(
        ...r.data.map(({ subject_hash, completed_at }) => ({
          subject_hash,
          completed_at,
        })),
      );
      if (r.data.length < 1000) break;
    }
    fs.writeFileSync(file, JSON.stringify(rows), { flag: "wx", mode: 0o600 });
    console.log("Restricted deletion recovery ledger saved.");
  } else {
    if (process.env.BOUNCER_RECOVERY_OFFLINE !== "true")
      throw new Error(
        "Keep the public application offline and set BOUNCER_RECOVERY_OFFLINE=true before reapplying deletions.",
      );
    const markers = JSON.parse(fs.readFileSync(file, "utf8"));
    const r = await db.rpc("verifier_privacy_reapply_deletions", {
      p_markers: markers,
    });
    if (r.error) throw new Error("Cannot reapply deletion recovery ledger.");
    const cleanup = await db.rpc("verifier_privacy_cleanup", {
      p_grace_seconds: Math.max(
        900,
        Math.ceil((Number(process.env.NONCE_EXPIRY) || 300000) / 1000) + 60,
      ),
    });
    if (cleanup.error)
      throw new Error("Cannot run restored-data retention cleanup.");
    console.log(
      "Deletion ledger reapplied; finish queued role reconciliation and privacy cleanup before opening the application.",
    );
  }
})().catch(() => {
  console.error(
    "Privacy recovery operation failed. Check operation, offline mode, file permissions and database configuration.",
  );
  process.exitCode = 1;
});
