#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf "\n[deploy] %s\n" "$*"
}

warn() {
  printf "\n[deploy][warn] %s\n" "$*" >&2
}

die() {
  printf "\n[deploy][error] %s\n" "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy-vps-backend.sh \
    --domain <api.example.com> \
    --free-domain <sslip|nip> \
    --email <you@example.com>

Options:
  --app-dir         Target repo directory (default: auto-detect from script location)
  --branch          Git branch to deploy (default: main)
  --project-name    PM2 process + nginx file base name (default: copytrade-backend)
  --backend-filter  pnpm filter name for backend package (default: copytrade-backend)
  --port            Backend local port used by Node app + nginx upstream (default: 3001)
  --domain          Public API domain for nginx/certbot (optional but recommended)
  --free-domain     Auto-generate free domain from public IP: sslip or nip
  --public-ip       Public IPv4 to use for --free-domain (auto-detect if omitted)
  --email           Email for Let's Encrypt (required when --domain + certbot enabled)
  --skip-nginx      Skip nginx configuration
  --skip-certbot    Skip HTTPS certificate setup
  -h, --help        Show this help

Notes:
  - Script is idempotent: already installed tools and existing setup are skipped.
  - Requires Ubuntu/Debian with apt.
  - Run this script from inside the repository (or pass --app-dir).
  - Run as a sudo-capable user (not necessarily root).
EOF
}

APP_DIR=""
BRANCH="main"
PROJECT_NAME="copytrade-backend"
BACKEND_FILTER="copytrade-backend"
PORT="3001"
DOMAIN=""
EMAIL=""
SKIP_NGINX="false"
SKIP_CERTBOT="false"
FREE_DOMAIN_PROVIDER=""
PUBLIC_IP=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)
      APP_DIR="${2:-}"; shift 2 ;;
    --branch)
      BRANCH="${2:-}"; shift 2 ;;
    --project-name)
      PROJECT_NAME="${2:-}"; shift 2 ;;
    --backend-filter)
      BACKEND_FILTER="${2:-}"; shift 2 ;;
    --port)
      PORT="${2:-}"; shift 2 ;;
    --domain)
      DOMAIN="${2:-}"; shift 2 ;;
    --free-domain)
      FREE_DOMAIN_PROVIDER="${2:-}"; shift 2 ;;
    --public-ip)
      PUBLIC_IP="${2:-}"; shift 2 ;;
    --email)
      EMAIL="${2:-}"; shift 2 ;;
    --skip-nginx)
      SKIP_NGINX="true"; shift ;;
    --skip-certbot)
      SKIP_CERTBOT="true"; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      die "Unknown argument: $1" ;;
  esac
done

# Auto-detect repo root if not explicitly provided.
if [[ -z "$APP_DIR" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  die "No git repo found at $APP_DIR. Set --app-dir to your repo path."
fi

if [[ -n "$DOMAIN" && -n "$FREE_DOMAIN_PROVIDER" ]]; then
  die "Use either --domain or --free-domain, not both"
fi

if ! command -v apt-get >/dev/null 2>&1; then
  die "This script currently supports Ubuntu/Debian (apt-get) only"
fi

if [[ "$EUID" -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

APT_UPDATED="false"
apt_update_once() {
  if [[ "$APT_UPDATED" == "false" ]]; then
    log "Running apt-get update..."
    $SUDO apt-get update -y
    APT_UPDATED="true"
  fi
}

ensure_apt_pkg() {
  local pkg="$1"
  if dpkg -s "$pkg" >/dev/null 2>&1; then
    log "$pkg already installed. Skipping."
    return
  fi
  apt_update_once
  log "Installing $pkg..."
  $SUDO apt-get install -y "$pkg"
}

ensure_node20() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p "process.versions.node.split('.')[0]")"
    if [[ "$major" -ge 20 ]]; then
      log "Node.js $(node -v) already installed. Skipping."
      return
    fi
    warn "Node.js $(node -v) found, but >=20 required. Upgrading."
  else
    log "Node.js not found. Installing Node.js 20..."
  fi

  apt_update_once
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    log "pnpm $(pnpm -v) already installed. Skipping."
    return
  fi

  if command -v corepack >/dev/null 2>&1; then
    log "Installing pnpm via corepack..."
    corepack enable
    corepack prepare pnpm@10.33.0 --activate
  else
    log "Installing pnpm globally via npm..."
    $SUDO npm install -g pnpm@10.33.0
  fi
}

ensure_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    log "pm2 already installed. Skipping."
    return
  fi
  log "Installing pm2 globally..."
  $SUDO npm install -g pm2
}

is_valid_ipv4() {
  local ip="$1"
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  IFS='.' read -r o1 o2 o3 o4 <<<"$ip"
  for o in "$o1" "$o2" "$o3" "$o4"; do
    (( o >= 0 && o <= 255 )) || return 1
  done
  return 0
}

detect_public_ip() {
  local ip=""
  ip="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
  if [[ -z "$ip" ]]; then
    ip="$(curl -fsS --max-time 8 https://ifconfig.me/ip 2>/dev/null || true)"
  fi
  if [[ -z "$ip" ]]; then
    ip="$(curl -fsS --max-time 8 https://checkip.amazonaws.com 2>/dev/null || true)"
  fi
  echo "$ip" | tr -d '[:space:]'
}

resolve_free_domain() {
  if [[ -n "$DOMAIN" || -z "$FREE_DOMAIN_PROVIDER" ]]; then
    return
  fi

  case "$FREE_DOMAIN_PROVIDER" in
    sslip|nip) ;;
    *)
      die "--free-domain must be 'sslip' or 'nip'"
      ;;
  esac

  if [[ -z "$PUBLIC_IP" ]]; then
    log "Detecting public IP for free domain..."
    PUBLIC_IP="$(detect_public_ip)"
  fi

  if ! is_valid_ipv4 "$PUBLIC_IP"; then
    die "Could not determine a valid public IPv4. Pass --public-ip <x.x.x.x>"
  fi

  if [[ "$FREE_DOMAIN_PROVIDER" == "sslip" ]]; then
    DOMAIN="${PUBLIC_IP//./-}.sslip.io"
  else
    DOMAIN="${PUBLIC_IP}.nip.io"
  fi

  log "Using free domain: $DOMAIN"
}

update_repo() {
  log "Updating repo at $APP_DIR (branch: $BRANCH)..."
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
}

setup_env_if_missing() {
  local env_file="$APP_DIR/server/.env"
  local env_example="$APP_DIR/server/.env.example"
  if [[ -f "$env_file" ]]; then
    log "server/.env already exists. Skipping template copy."
    return
  fi

  if [[ ! -f "$env_example" ]]; then
    die "Missing $env_example"
  fi

  cp "$env_example" "$env_file"
  warn "Created $env_file from template. Edit it before production use."
}

install_and_build() {
  log "Installing dependencies..."
  (cd "$APP_DIR" && pnpm install)

  log "Type checking backend package ($BACKEND_FILTER)..."
  (cd "$APP_DIR" && pnpm --filter "$BACKEND_FILTER" lint)

  log "Building backend package ($BACKEND_FILTER)..."
  (cd "$APP_DIR" && pnpm --filter "$BACKEND_FILTER" build)
}

start_or_restart_pm2() {
  log "Starting/restarting PM2 process: $PROJECT_NAME"
  if pm2 describe "$PROJECT_NAME" >/dev/null 2>&1; then
    (cd "$APP_DIR" && pm2 restart "$PROJECT_NAME" --update-env)
  else
    (cd "$APP_DIR" && pm2 start "pnpm --filter $BACKEND_FILTER start" --name "$PROJECT_NAME")
  fi
  pm2 save
}

configure_nginx() {
  if [[ "$SKIP_NGINX" == "true" ]]; then
    log "Skipping nginx setup (--skip-nginx)."
    return
  fi
  if [[ -z "$DOMAIN" ]]; then
    warn "No --domain provided; skipping nginx setup."
    return
  fi

  local conf_name="${PROJECT_NAME}.conf"
  local conf_avail="/etc/nginx/sites-available/$conf_name"
  local conf_enabled="/etc/nginx/sites-enabled/$conf_name"

  log "Configuring nginx for $DOMAIN -> 127.0.0.1:$PORT"
  $SUDO tee "$conf_avail" >/dev/null <<EOF
server {
  listen 80;
  server_name $DOMAIN;

  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
EOF

  if [[ ! -L "$conf_enabled" ]]; then
    $SUDO ln -s "$conf_avail" "$conf_enabled"
  else
    log "nginx symlink already exists. Skipping link step."
  fi

  $SUDO nginx -t
  $SUDO systemctl reload nginx
}

setup_https() {
  if [[ "$SKIP_CERTBOT" == "true" ]]; then
    log "Skipping certbot setup (--skip-certbot)."
    return
  fi
  if [[ -z "$DOMAIN" ]]; then
    warn "No --domain provided; skipping HTTPS setup."
    return
  fi
  if [[ -z "$EMAIL" ]]; then
    die "--email is required to request a Let's Encrypt certificate"
  fi

  if [[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
    log "Existing certificate found for $DOMAIN. Skipping certbot."
    return
  fi

  log "Requesting Let's Encrypt certificate for $DOMAIN"
  $SUDO certbot --nginx \
    -d "$DOMAIN" \
    --agree-tos \
    -m "$EMAIL" \
    --redirect \
    --non-interactive
}

main() {
  log "Starting backend deployment..."

  ensure_apt_pkg "git"
  ensure_apt_pkg "curl"
  ensure_apt_pkg "nginx"
  ensure_apt_pkg "certbot"
  ensure_apt_pkg "python3-certbot-nginx"
  ensure_node20
  ensure_pnpm
  ensure_pm2
  resolve_free_domain

  update_repo
  setup_env_if_missing
  install_and_build
  start_or_restart_pm2
  configure_nginx
  setup_https

  log "Done."
  log "Backend should now be running under PM2 process: $PROJECT_NAME"
  if [[ -n "$DOMAIN" ]]; then
    log "Expected public URL: https://$DOMAIN"
  else
    log "No domain configured. Backend listens behind nginx on port 80 only if configured manually."
  fi
}

main "$@"
