# Raccoon AI Gateway

Multi-tenant **BYOK (Bring-Your-Own-Key)** proxy SaaS for OpenAI, Anthropic, and OpenRouter.
One endpoint, your provider keys, unified usage analytics.

```
https://api.raccoon.dev/v1/chat/completions   (OpenAI-compat)
https://api.raccoon.dev/v1/messages           (Anthropic-compat)
```

## Repository layout

```
ai-gateway/
├── backend/              NestJS 11 + Fastify + Prisma — control & data plane
├── apps/
│   └── dashboard/        Vite 6 + React 19 + TanStack Router/Query — admin UI
├── packages/
│   └── sdk/              @raccoon/sdk — native TypeScript client
├── AGENTS.md             Task-oriented procedures for AI coding agents
├── CLAUDE.md             Universal project conventions
└── PLAN.md               Architecture & sprint plan
```

## Stack

**Backend** — NestJS 11, Fastify, Prisma 6, PostgreSQL, Redis, BullMQ, JWT (access 15m / refresh 30d), Stripe, Argon2id, AES-256-GCM envelope encryption for BYOK secrets.

**Dashboard** — Vite 6, React 19, TanStack Router, TanStack Query, Orval (OpenAPI → typed client), Zustand, Tailwind v4, shadcn/ui primitives, React Hook Form + Zod.

**SDK** — Zero-dep TypeScript client targeting `sk-rcn-live-*` Application Keys.

## Prerequisites

- Bun ≥ 1.1
- Node ≥ 18 (for the SDK)
- PostgreSQL 15+
- Redis 7+

## Quick start

```bash
# 1. Install deps
cd backend && bun install
cd ../apps/dashboard && bun install

# 2. Bring up Postgres + Redis
cd ../../backend && docker compose up -d

# 3. Configure env (see backend/.env.example)
cp .env.example .env

# 4. Apply schema + seed
bun run db:migrate
bun run db:seed

# 5. Run backend (http://localhost:3000)
bun run start:dev

# 6. Run dashboard (http://localhost:5173)
cd ../apps/dashboard
bun run generate:api    # generate typed API client from backend OpenAPI
bun run dev
```

## Required environment

Backend (`backend/.env`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | 32+ char secret for access tokens |
| `MASTER_ENCRYPTION_KEY` | base64 256-bit key for BYOK envelope encryption |
| `MASTER_KEY_ID` | rotation marker (default `v1`) |
| `STRIPE_SECRET_KEY` | Stripe API key (billing module) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |

## Common commands

### Backend
```bash
bun run start:dev          # watch mode
bun run test               # vitest unit tests
bun run test:e2e           # vitest e2e
bun run db:migrate         # apply Prisma migrations
bun run db:studio          # Prisma Studio
bun run lint
```

### Dashboard
```bash
bun run dev                # Vite dev server
bun run generate:api       # regenerate API client (after backend schema change)
bun run typecheck
bun run build              # production build
```

### SDK
```bash
cd packages/sdk
bun run build
```

## Architecture highlights

- **Hard cutover to BYOK** — credit wallet, Stripe entitlements, and per-customer billing tables removed in favor of `Account → Application → ApplicationKey` + `UserProviderKey` model.
- **Data plane keys**: `sk-rcn-live-<prefix><secret>` — prefix indexed, secret verified with Argon2id.
- **BYOK secrets** stored as AES-256-GCM ciphertext (`[12B IV][16B Tag][ciphertext]`) with `encryptionKeyId` for rotation.
- **Streaming** is native — Fastify `reply.raw` + provider stream piped through a `UsageExtractorTransform` that captures token usage inline (no buffering).
- **Usage events** are recorded asynchronously through a BullMQ `usage-recording` queue.
- **Audit log** captures every `encrypt`/`decrypt`/`decryption_failed` and data-plane request (metadata only — never prompt content).

## Deployment

- **Backend** → Railway (`backend/railway.json`, `backend/nixpacks.toml`, `backend/Dockerfile`)
- **Dashboard** → Vercel (`apps/dashboard/vercel.json`)
- **SDK** → npm (`packages/sdk`)

## Documentation

- [`AGENTS.md`](./AGENTS.md) — procedures for AI coding agents working on this repo
- [`CLAUDE.md`](./CLAUDE.md) — project-wide conventions (architecture, code style, libraries)
- [`PLAN.md`](./PLAN.md) — sprint plan and architectural decisions
- [`backend/PLAN-BYOK.md`](./backend/PLAN-BYOK.md) — BYOK migration plan
- [`backend/CURRENT-STATE.md`](./backend/CURRENT-STATE.md) — backend implementation status
- [`apps/dashboard/CURRENT-STATE.md`](./apps/dashboard/CURRENT-STATE.md) — dashboard implementation status

## License

Proprietary — all rights reserved.
