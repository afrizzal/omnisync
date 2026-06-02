# ── Stage 1: prune ──────────────────────────────────────────────────────────
# Prune the monorepo to just what @omnisync/worker needs (Turborepo v2 --docker).
FROM node:22-slim AS prune
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm dlx turbo prune @omnisync/worker --docker

# ── Stage 2: install + build ─────────────────────────────────────────────────
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
# Install deps from pruned manifest (faster than full workspace)
COPY --from=prune /app/out/json/ .
RUN pnpm install --frozen-lockfile
# Copy full pruned source and build
COPY --from=prune /app/out/full/ .
RUN pnpm --filter @omnisync/db generate
RUN pnpm --filter @omnisync/worker build

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=build /app .
ENV NODE_ENV=production
CMD ["node", "apps/worker/dist/index.js"]
