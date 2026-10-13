BEGIN;

CREATE TABLE public.verifier_wallet_blocks (
  server_id text NOT NULL CHECK (server_id ~ '^[0-9]{17,20}$'),
  address text NOT NULL,
  wallet_type text NOT NULL CHECK (wallet_type IN ('evm','bitcoin')),
  reason text CHECK (reason IS NULL OR (char_length(reason) BETWEEN 1 AND 200 AND reason = btrim(reason))),
  blocked_by text NOT NULL CHECK (blocked_by ~ '^[0-9]{17,20}$'),
  blocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, address),
  CONSTRAINT verifier_wallet_blocks_address_check CHECK (
    (wallet_type = 'evm' AND address ~ '^0x[0-9a-f]{40}$') OR
    (wallet_type = 'bitcoin' AND address ~ '^bc1p[ac-hj-np-z02-9]{58}$')
  )
);

COMMENT ON TABLE public.verifier_wallet_blocks IS 'Server-specific wallet restrictions managed by Discord administrators; wallet links remain intact.';
ALTER TABLE public.verifier_wallet_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verifier_wallet_blocks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.verifier_wallet_blocks TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
