# ── Stage 1: prune ──────────────────────────────────────────────────────────
# Prune the monorepo to just what @omnisync/mock-crm needs (Turborepo v2 --docker).
FROM node:22-slim AS prune
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm dlx turbo prune @omnisync/mock-crm --docker

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
# Build the mock-crm AND its workspace deps in topological order (turbo respects
# dependsOn ^build) — mirrors local `pnpm build`.
RUN pnpm exec turbo run build --filter=@omnisync/mock-crm

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=build /app .
ENV NODE_ENV=production
CMD ["node", "apps/mock-crm/dist/index.js"]
