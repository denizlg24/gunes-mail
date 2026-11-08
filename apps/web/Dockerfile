# Build context: repository root (the site depends on packages/shared).
FROM oven/bun:1.4.4-alpine AS build
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --filter @gunes/web --ignore-scripts
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
ARG NEXT_PUBLIC_SITE_URL=https://gunes-mail.denizlg24.com
ARG NEXT_PUBLIC_API_URL=https://gunes-mail-api.denizlg24.com
ARG NEXT_PUBLIC_CONTACT_EMAIL=geral@oceaninformatix.com
ARG NEXT_PUBLIC_OPERATOR_NAME=
ENV NEXT_TELEMETRY_DISABLED=1
RUN cd apps/web && bun run build

FROM caddy:2.10-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/out /srv
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["wget", "-qO-", "http://127.0.0.1:80/"]
