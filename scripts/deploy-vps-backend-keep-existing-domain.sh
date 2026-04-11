#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$SCRIPT_DIR/deploy-vps-backend.sh" \
  --branch main \
  --project-name copytrade-backend \
  --backend-filter copytrade-backend \
  --port 3001 \
  --skip-nginx \
  --skip-certbot
