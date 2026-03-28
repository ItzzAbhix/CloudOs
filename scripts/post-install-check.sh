#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed."
  exit 1
fi

echo "Container status:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo
echo "Open ports:"
ss -tulpn | grep -E ':(22|80|81|443|4000|5678|8088|9000|9999)\s'

echo
echo "Firewall status:"
ufw status
