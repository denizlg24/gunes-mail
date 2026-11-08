# Build context: repository root (the server depends on packages/shared).
FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --production --filter @gunes/server --ignore-scripts

FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=deps --chown=bun:bun /repo/node_modules ./node_modules
COPY --from=deps --chown=bun:bun /repo/apps/server/node_modules ./apps/server/node_modules
COPY --chown=bun:bun packages/shared ./packages/shared
COPY --chown=bun:bun apps/server/package.json apps/server/tsconfig.json ./apps/server/
COPY --chown=bun:bun apps/server/drizzle ./apps/server/drizzle
COPY --chown=bun:bun apps/server/src ./apps/server/src
WORKDIR /repo/apps/server
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["bun", "src/index.ts"]
