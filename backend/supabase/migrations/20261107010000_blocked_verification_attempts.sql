BEGIN;
-- Signed ownership evidence refused by a server restriction. This table does
-- not create wallet links, privacy choices, role grants or export eligibility.
CREATE TABLE public.verifier_blocked_verification_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id text NOT NULL, server_id text NOT NULL, channel_id text,
 address text NOT NULL, wallet_type text NOT NULL CHECK(wallet_type IN ('evm','bitcoin','solana')),
 source text NOT NULL CHECK(source IN ('discord','portal')),
 chain_id integer,
 outcome text NOT NULL DEFAULT 'blocked' CHECK(outcome='blocked'),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 year',
 CHECK ((wallet_type='evm' AND chain_id IS NOT NULL AND chain_id IN (1,8453,4663)) OR (wallet_type<>'evm' AND chain_id IS NULL)),
 CHECK (expires_at>created_at AND expires_at<=created_at+interval '1 year')
);
CREATE INDEX verifier_blocked_attempt_member ON public.verifier_blocked_verification_attempts(server_id,user_id,created_at DESC,id DESC);
CREATE INDEX verifier_blocked_attempt_wallet ON public.verifier_blocked_verification_attempts(server_id,address,created_at DESC,id DESC);
CREATE INDEX verifier_blocked_attempt_expiry ON public.verifier_blocked_verification_attempts(expires_at);
ALTER TABLE public.verifier_blocked_verification_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verifier_blocked_verification_attempts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,DELETE ON public.verifier_blocked_verification_attempts TO service_role;
COMMENT ON TABLE public.verifier_blocked_verification_attempts IS 'Operator-only security evidence of signed, blocked requests. No successful wallet link. Expires after one year; no signatures or verification tokens retained.';
NOTIFY pgrst,'reload schema';
COMMIT;
