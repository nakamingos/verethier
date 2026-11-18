type CorsCallback = (error: Error | null, options?: Record<string, unknown>) => void;

/** Freewallet's sign callback: posted from the Freewallet app, which has no allowed origin. */
const RELAY_CALLBACK = /^\/api\/bitcoin-relay\/[A-Za-z0-9_-]+$/;

/**
 * CORS for known origins only. Requests without an origin (apps, servers) pass.
 * Freewallet's sign callback is served without CORS headers instead of being
 * rejected: it returns nothing readable, and the signature is verified.
 */
export function corsDelegate(allowedOrigins: string[], blocked: (origin: string) => void = () => {}) {
  const options = {
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      blocked(origin);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
  return (req: { method?: string; url?: string }, callback: CorsCallback) => {
    if (req.method === 'POST' && RELAY_CALLBACK.test(String(req.url ?? '').split('?')[0]))
      return callback(null, { origin: false });
    callback(null, options);
  };
}
