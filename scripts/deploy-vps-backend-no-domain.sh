#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$SCRIPT_DIR/deploy-vps-backend.sh" \
  --free-domain sslip \
  --email adityacaturputra25@gmail.com
