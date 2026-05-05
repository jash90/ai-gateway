#!/usr/bin/env bash
set -euo pipefail

echo ">>> [start.sh] 1. ENV check"
env | grep -E '^(NODE_|PORT|DATABASE_URL|REDIS_URL|JWT_SECRET|MASTER_)' \
    | sed 's/=.*/=<set>/' || true

echo ">>> [start.sh] 2. prisma migrate deploy"
bunx prisma migrate deploy

echo ">>> [start.sh] 3. prisma seed (idempotent)"
bun run prisma/seed.ts || echo ">>> [start.sh] seed exit code $? — continuing"

echo ">>> [start.sh] 4. starting node dist/main on port ${PORT:-3000}"
exec node dist/main
