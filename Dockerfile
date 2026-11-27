# syntax=docker/dockerfile:1
# Multi-stage build for the Next.js standalone server (Prisma 7 needs no
# native query engine, so the runtime image is just Node + the traced app).

FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ── Dependencies (postinstall runs `prisma generate`) ─────────────────────────
FROM base AS deps
COPY package.json package-lock.json prisma7.config.ts ./
COPY prisma ./prisma
RUN npm ci

# ── Build ─────────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholders so modules can be imported at build time. Never used at runtime:
# the runner stage gets real values from the host's environment/secrets.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    BETTER_AUTH_SECRET="build-time-placeholder-secret-not-used-at-runtime" \
    npx prisma generate && \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    BETTER_AUTH_SECRET="build-time-placeholder-secret-not-used-at-runtime" \
    npm run build

# ── One-off: apply migrations + seed rules (has the full toolchain) ───────────
# docker compose --profile app run --rm migrate
FROM builder AS migrate
ENV SEED_DEMO=false
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

# ── Migration toolchain carried in the runtime image ─────────────────────────
# Some hosts (e.g. Render) build only the last stage, so the runtime image must
# be able to apply migrations itself: `sh /app/migrate.sh` (a pre-deploy or
# release command). Just the Prisma CLI (JS + WebAssembly, no native engine),
# at the same version as package.json, plus the schema and migrations.
FROM base AS migrator
WORKDIR /migrator
COPY package.json /tmp/app-package.json
RUN printf '{"name":"migrator","private":true}\n' > package.json \
 && PRISMA=$(node -p "require('/tmp/app-package.json').devDependencies.prisma") \
 && DOTENV=$(node -p "require('/tmp/app-package.json').devDependencies.dotenv") \
 && npm install --omit=dev --no-audit --no-fund --save-exact "prisma@$PRISMA" "dotenv@$DOTENV" \
 && npm cache clean --force
COPY prisma7.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations ./prisma/migrations

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=migrator --chown=nextjs:nodejs /migrator ./migrator
COPY --chown=nextjs:nodejs docker/migrate.sh ./migrate.sh
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
