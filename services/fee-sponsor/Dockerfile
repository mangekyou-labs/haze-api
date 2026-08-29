# ─── Fee-sponsor Docker image (stellar-launch M3.4) ──────────────
# Build:  docker build -t zk-fee-sponsor -f services/fee-sponsor/Dockerfile .
# Run:    docker run -p 3002:3002 --env-file .env zk-fee-sponsor
#
# The fee-sponsor imports gateway sources via @gateway/* path mapping
# and also needs the shared crypto package. All three are copied.

FROM node:24-alpine AS builder

WORKDIR /app

# ── Shared package ───────────────────────────────────────────────
COPY packages/zk-credits-shared/package.json packages/zk-credits-shared/package-lock.json* packages/zk-credits-shared/
RUN cd packages/zk-credits-shared && npm ci

COPY packages/zk-credits-shared/ packages/zk-credits-shared/
RUN cd packages/zk-credits-shared && npm run build

# ── Gateway sources (fee-sponsor imports them at runtime) ────────
COPY ts/package.json ts/package-lock.json* ts/
RUN cd ts && npm ci

COPY ts/ ts/

# ── Fee-sponsor ──────────────────────────────────────────────────
COPY services/fee-sponsor/package.json services/fee-sponsor/package-lock.json* services/fee-sponsor/
RUN cd services/fee-sponsor && npm ci

COPY services/fee-sponsor/ services/fee-sponsor/

# ── Runtime ──────────────────────────────────────────────────────
FROM node:24-alpine
WORKDIR /app

COPY --from=builder /app/packages/zk-credits-shared/package.json /app/packages/zk-credits-shared/package.json
COPY --from=builder /app/packages/zk-credits-shared/dist /app/packages/zk-credits-shared/dist
COPY --from=builder /app/packages/zk-credits-shared/node_modules /app/packages/zk-credits-shared/node_modules
COPY --from=builder /app/ts /app/ts
COPY --from=builder /app/ts/node_modules /app/ts/node_modules
COPY --from=builder /app/services/fee-sponsor /app/services/fee-sponsor
COPY --from=builder /app/services/fee-sponsor/node_modules /app/services/fee-sponsor/node_modules

# Fix file: symlink — Docker COPY doesn't preserve npm symlinks reliably.
RUN rm -rf /app/services/fee-sponsor/node_modules/@zk-credits/shared && \
    mkdir -p /app/services/fee-sponsor/node_modules/@zk-credits && \
    cp -a /app/packages/zk-credits-shared /app/services/fee-sponsor/node_modules/@zk-credits/shared

EXPOSE 3002

ENV PORT=3002
ENV NODE_ENV=production

WORKDIR /app/services/fee-sponsor
CMD ["npx", "tsx", "src/server.ts"]
