# Base/x402 gateway image.

FROM node:24-alpine AS builder

WORKDIR /app

COPY packages/zk-credits-shared/package.json packages/zk-credits-shared/package-lock.json* packages/zk-credits-shared/
RUN cd packages/zk-credits-shared && npm ci
COPY packages/zk-credits-shared/ packages/zk-credits-shared/
RUN cd packages/zk-credits-shared && npm run build

COPY packages/x402-zk-prepaid/package.json packages/x402-zk-prepaid/package-lock.json* packages/x402-zk-prepaid/
RUN cd packages/x402-zk-prepaid && npm ci
COPY packages/x402-zk-prepaid/ packages/x402-zk-prepaid/
RUN cd packages/x402-zk-prepaid && npm run build

COPY ts/package.json ts/package-lock.json* ts/
RUN cd ts && npm ci
COPY ts/ ts/

FROM node:24-alpine
WORKDIR /app

COPY --from=builder /app/packages/zk-credits-shared /app/packages/zk-credits-shared
COPY --from=builder /app/packages/x402-zk-prepaid /app/packages/x402-zk-prepaid
COPY --from=builder /app/ts/node_modules /app/ts/node_modules
COPY --from=builder /app/ts /app/ts

# Docker COPY does not preserve local file dependency symlinks reliably.
RUN rm -rf /app/ts/node_modules/@zk-credits/shared /app/ts/node_modules/@zk-credits/x402-zk-prepaid && \
    mkdir -p /app/ts/node_modules/@zk-credits && \
    cp -a /app/packages/zk-credits-shared /app/ts/node_modules/@zk-credits/shared && \
    cp -a /app/packages/x402-zk-prepaid /app/ts/node_modules/@zk-credits/x402-zk-prepaid

EXPOSE 3001
ENV PORT=3001
ENV NODE_ENV=production
WORKDIR /app/ts
CMD ["npx", "tsx", "server.ts"]
