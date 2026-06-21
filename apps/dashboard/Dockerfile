# ── Stage 1: prune ──────────────────────────────────────────────
FROM node:22-slim AS prune
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm dlx turbo prune @omnisync/dashboard --docker

# ── Stage 2: install + build ────────────────────────────────────
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY --from=prune /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prune /app/out/full/ .
COPY tsconfig.base.json ./
# Client-side NEXT_PUBLIC_* must be present at build time (inlined into the bundle)
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm exec turbo run build --filter=@omnisync/dashboard

# ── Stage 3: runtime (Next standalone) ──────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/apps/dashboard/.next/standalone ./
COPY --from=build /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
EXPOSE 3000
CMD ["node", "apps/dashboard/server.js"]
