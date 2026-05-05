# syntax=docker/dockerfile:1.7
# Single-stage Debian slim image. Nixpacks couldn't expose libstdc++ to Bun's
# native dlopen path (argon2 binding). This Dockerfile guarantees libstdc++6
# is on the standard linker path.

FROM oven/bun:1.3-debian AS deps
WORKDIR /app

# argon2 native binding requires libstdc++.so.6 at runtime.
# openssl is needed by Prisma engines.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        openssl \
        libstdc++6 \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Install Node 22 alongside Bun — Prisma engines + final runtime use node.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build
COPY . .
RUN bunx prisma generate && bun run build

# Default port; Railway injects PORT env at runtime.
EXPOSE 3000

CMD ["bash", "./start.sh"]
