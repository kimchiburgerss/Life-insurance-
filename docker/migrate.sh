#!/bin/sh
# Apply pending database migrations from the runtime image (forward-only, never
# resets data). Run before starting a new release: Render's pre-deploy command,
# Fly.io's release_command, or `docker compose run --rm app sh /app/migrate.sh`.
# Jurisdiction rules shipped with the release are added when the app starts.
set -e
cd "$(dirname "$0")/migrator"
exec node node_modules/prisma/build/index.js migrate deploy
