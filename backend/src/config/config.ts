import { z } from 'zod';

/**
 * Process-env schema. Validated once at startup in `main.ts` — the app refuses
 * to boot if any required field is missing or malformed. Per CLAUDE.md, secret
 * env vars must be enforced at startup, not lazily at first use.
 */
export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  JWT_SECRET: z.string().min(32),
  ADMIN_API_KEY: z.string().min(1),

  // ---------------------------------------------------------------------------
  // BYOK envelope encryption (D-004 / D-010)
  // The master key is base64-encoded and MUST decode to exactly 32 bytes for
  // AES-256-GCM. Generate with: `openssl rand -base64 32`.
  // ---------------------------------------------------------------------------
  MASTER_ENCRYPTION_KEY: z
    .string()
    .min(1)
    .refine(
      (s) => {
        try {
          return Buffer.from(s, 'base64').length === 32;
        } catch {
          return false;
        }
      },
      {
        message:
          'MASTER_ENCRYPTION_KEY must decode to exactly 32 bytes — generate with `openssl rand -base64 32`',
      },
    ),
  MASTER_KEY_ID: z.string().min(1).default('v1'),

  // ---------------------------------------------------------------------------
  // App URLs (used for verify/reset-password email links)
  // ---------------------------------------------------------------------------
  APP_URL: z.string().url().default('http://localhost:5173'),

  // ---------------------------------------------------------------------------
  // CORS — comma-separated whitelist for production. Empty / unset in dev
  // means the dev fallback (`origin: true`) accepts any origin so
  // `vite dev` on a different port doesn't get blocked.
  // ---------------------------------------------------------------------------
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : [],
    ),

  // ---------------------------------------------------------------------------
  // Optional integrations
  // ---------------------------------------------------------------------------
  RESEND_API_KEY: z.string().optional(),

  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    const message = Object.entries(errors)
      .map(([key, vals]) => `${key}: ${vals?.join(', ')}`)
      .join('; ');
    throw new Error(`Invalid env: ${message}`);
  }
  return parsed.data;
}
