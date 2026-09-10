# syntax=docker/dockerfile:1.7

FROM oven/bun:1.4.0 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
ENV VITE_ENABLE_DEMO=false
RUN bun run routes:generate && bun run typecheck && bun run build

# Reusable target for controlled database/auth migrations in Compose.
FROM build AS migrate
ENV NODE_ENV=production
CMD ["sh", "-lc", "bun run db:migrate && bun run auth:migrate && bun run license:migrate"]

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

RUN groupadd --system --gid 10001 silonr \
    && useradd --system --uid 10001 --gid silonr --home-dir /nonexistent --shell /usr/sbin/nologin silonr

COPY --from=build --chown=silonr:silonr /app/.output ./.output

EXPOSE 3000
USER silonr

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
