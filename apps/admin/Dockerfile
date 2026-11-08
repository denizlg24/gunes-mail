# Build context: repository root.
FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --production --filter @gunes/admin --ignore-scripts

FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=deps --chown=bun:bun /repo/node_modules ./node_modules
COPY --from=deps --chown=bun:bun /repo/apps/admin/node_modules ./apps/admin/node_modules
COPY --chown=bun:bun apps/admin/package.json apps/admin/tsconfig.json ./apps/admin/
COPY --chown=bun:bun apps/admin/src ./apps/admin/src
COPY --chown=bun:bun apps/admin/public ./apps/admin/public
WORKDIR /repo/apps/admin
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["bun", "src/index.ts"]
