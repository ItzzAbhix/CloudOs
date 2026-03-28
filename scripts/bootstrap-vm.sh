#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root or with sudo."
  exit 1
fi

CLOUDOS_ROOT="/opt/cloudos"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${CLOUDOS_ROOT}/.env"

if [[ ! -f "${REPO_ROOT}/.env" ]]; then
  echo "Missing ${REPO_ROOT}/.env. Copy .env.example to .env and fill in real secrets first."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get upgrade -y
apt-get install -y \
  ca-certificates \
  curl \
  git \
  gnupg \
  lsb-release \
  ufw \
  fail2ban \
  apache2-utils

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

apt-get install -y docker-compose-plugin
systemctl enable --now docker

mkdir -p "${CLOUDOS_ROOT}"
mkdir -p "${CLOUDOS_ROOT}/data/nginx-proxy-manager/data"
mkdir -p "${CLOUDOS_ROOT}/data/nginx-proxy-manager/letsencrypt"
mkdir -p "${CLOUDOS_ROOT}/data/portainer"
mkdir -p "${CLOUDOS_ROOT}/data/n8n"
mkdir -p "${CLOUDOS_ROOT}/data/cloudos/storage/files"
mkdir -p "${CLOUDOS_ROOT}/data/cloudos/storage/downloads"
mkdir -p "${CLOUDOS_ROOT}/data/cloudos/storage/media"
mkdir -p "${CLOUDOS_ROOT}/secrets"
mkdir -p "${CLOUDOS_ROOT}/scripts"
mkdir -p "${CLOUDOS_ROOT}/apps"

install -m 600 "${REPO_ROOT}/.env" "${ENV_FILE}"
install -m 644 "${REPO_ROOT}/infra/docker-compose.yml" "${CLOUDOS_ROOT}/docker-compose.yml"
install -m 755 "${REPO_ROOT}/scripts/post-install-check.sh" "${CLOUDOS_ROOT}/scripts/post-install-check.sh"
install -m 644 "${REPO_ROOT}/package.json" "${CLOUDOS_ROOT}/package.json"
install -m 644 "${REPO_ROOT}/package-lock.json" "${CLOUDOS_ROOT}/package-lock.json"
install -m 644 "${REPO_ROOT}/tsconfig.base.json" "${CLOUDOS_ROOT}/tsconfig.base.json"
install -m 644 "${REPO_ROOT}/.gitignore" "${CLOUDOS_ROOT}/.gitignore"
cp -R "${REPO_ROOT}/apps/api" "${CLOUDOS_ROOT}/apps/"
cp -R "${REPO_ROOT}/apps/web" "${CLOUDOS_ROOT}/apps/"
if [[ -f "${REPO_ROOT}/data/cloudos-state.json" ]]; then
  install -m 644 "${REPO_ROOT}/data/cloudos-state.json" "${CLOUDOS_ROOT}/data/cloudos-state.json"
fi

if [[ ! -f "${CLOUDOS_ROOT}/secrets/portainer_admin_password" ]]; then
  openssl rand -base64 24 | tr -d '\n' | htpasswd -niB admin | cut -d: -f2 > "${CLOUDOS_ROOT}/secrets/portainer_admin_password"
fi

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 81/tcp
ufw allow 443/tcp
ufw allow 9000/tcp
ufw allow 5678/tcp
ufw allow 9999/tcp
ufw allow 4000/tcp
ufw allow 8088/tcp
ufw --force enable

docker compose --env-file "${ENV_FILE}" -f "${CLOUDOS_ROOT}/docker-compose.yml" pull nginx-proxy-manager portainer n8n dozzle
docker compose --env-file "${ENV_FILE}" -f "${CLOUDOS_ROOT}/docker-compose.yml" up -d --build

echo "CloudOS base stack deployed to ${CLOUDOS_ROOT}."
echo "Run ${CLOUDOS_ROOT}/scripts/post-install-check.sh to verify services."
