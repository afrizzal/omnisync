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
COPY --from=prune /app/.npmrc .
RUN pnpm install --frozen-lockfile
# Copy full pruned source and build
COPY --from=prune /app/out/full/ .
# turbo prune --docker omits root config files; every package tsconfig extends
# ../../tsconfig.base.json (and Prisma's TS-client generator reads it too), so copy it in.
COPY tsconfig.base.json ./
# Build the worker AND its workspace deps in topological order (turbo respects
# dependsOn ^build) — mirrors local `pnpm build`. This also runs @omnisync/db's
# `prisma generate`, which is part of that package's build script.
RUN pnpm exec turbo run build --filter=@omnisync/worker

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=build /app .
ENV NODE_ENV=production
CMD ["node", "apps/worker/dist/index.js"]
