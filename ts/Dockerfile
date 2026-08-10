# ─── Gateway Docker image (stellar-launch M3.2) ───────────────────
# Build:  docker build -t zk-gateway -f ts/Dockerfile .
# Run:    docker run -p 3001:3001 --env-file .env zk-gateway
#
# The gateway needs the shared crypto package and its own ts/ sources.
# All deps are installed at build time; tsx serves as the runtime.

FROM node:24-alpine AS builder

WORKDIR /app

# ── Shared package (needed by both gateway and fee-sponsor) ──────
COPY packages/zk-credits-shared/package.json packages/zk-credits-shared/package-lock.json* packages/zk-credits-shared/
RUN cd packages/zk-credits-shared && npm ci

COPY packages/zk-credits-shared/ packages/zk-credits-shared/
RUN cd packages/zk-credits-shared && npm run build

# ── Gateway ──────────────────────────────────────────────────────
COPY ts/package.json ts/package-lock.json* ts/
RUN cd ts && npm ci

COPY ts/ ts/

# ── Runtime ──────────────────────────────────────────────────────
FROM node:24-alpine
WORKDIR /app

# Copy shared package dist + node_modules + package.json + gateway with deps
COPY --from=builder /app/packages/zk-credits-shared/package.json /app/packages/zk-credits-shared/package.json
COPY --from=builder /app/packages/zk-credits-shared/dist /app/packages/zk-credits-shared/dist
COPY --from=builder /app/packages/zk-credits-shared/node_modules /app/packages/zk-credits-shared/node_modules
COPY --from=builder /app/ts/node_modules /app/ts/node_modules
COPY --from=builder /app/ts /app/ts

# Fix file: symlink — Docker COPY doesn't preserve npm symlinks reliably.
# Replace the symlink with a real copy of the built shared package.
RUN rm -rf /app/ts/node_modules/@zk-credits/shared && \
    mkdir -p /app/ts/node_modules/@zk-credits && \
    cp -a /app/packages/zk-credits-shared /app/ts/node_modules/@zk-credits/shared

# Circuit verification keys (the gateway verifies RLN proofs at startup).
# Only the small JSON VKs are needed — the large zkey/wasm stay client-side.
COPY circuits/verification_key_deposit.json circuits/verification_key_rln.json circuits/verification_key_slash.json /app/circuits/
ENV CIRCUITS_DIR=/app/circuits

EXPOSE 3001

ENV PORT=3001
ENV NODE_ENV=production

WORKDIR /app/ts
CMD ["npx", "tsx", "server.ts"]
