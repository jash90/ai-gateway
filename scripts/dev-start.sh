#!/bin/bash
# Start development environment for ai-gateway in worktree
set -e

echo "🚀 Starting AI Gateway dev environment..."

cd ~/ai-projects/backend

# Check services
echo "Checking Postgres..."
pg_isready -h localhost -p 5433 -q || { echo "❌ Postgres not available on :5433"; exit 1; }

echo "Checking Redis..."
redis-cli -h localhost -p 6379 ping > /dev/null || { echo "❌ Redis not available"; exit 1; }

echo "✅ All services up. Starting backend..."
bun run start:dev
