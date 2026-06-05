#!/usr/bin/env bash
set -euo pipefail
# One-command local bring-up. Adjust per stack as the project grows.
if [ -f docker-compose.yml ] || [ -f compose.yaml ]; then
  exec docker compose up "$@"
fi
echo "No docker-compose found — edit this script to start your stack."
echo "e.g.  {{TEST_CMD}}   |   npm run dev   |   ./gradlew bootRun   |   uvicorn app:app --reload"
