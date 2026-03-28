# CloudOS

CloudOS is a self-hosted master control panel for your private VM stack. This repository includes both the infrastructure bootstrap and the dashboard codebase.

## Repo layout

- `apps/api`: authenticated control-plane API
- `apps/web`: React dashboard UI
- `infra/docker-compose.yml`: runtime stack for the dashboard, proxy, Portainer, n8n, and Dozzle
- `infra/cloud-init.yaml`: optional first-boot provisioning
- `scripts/bootstrap-vm.sh`: VM bootstrap and deployment
- `scripts/post-install-check.sh`: service verification

## Included control surfaces

- system stats
- service status and restart actions
- logs viewer
- login and session protection
- VPN device management model
- file browser and tagging endpoints
- download queue engine
- media library scanning
- automation workflows and smart rules
- notifications
- analytics
- security and network monitoring adapters
- share links
- script runner
- game server manager stub

## Recommended GCP VM

- Ubuntu Server 24.04 LTS
- `e2-standard-2`
- 30-40 GB `pd-balanced`

## Default ports

- `22` SSH
- `80` HTTP
- `81` Nginx Proxy Manager admin
- `443` HTTPS
- `4000` CloudOS API
- `5678` n8n
- `8088` CloudOS web dashboard
- `9000` Portainer
- `9999` Dozzle

Use VPN-only firewall rules for admin access when you lock this down.

## Local development

```bash
npm install
npm run dev:api
npm run dev:web
```

Default login:

- username: `admin`
- password: `cloudosadmin`

Change that immediately before any real deployment.

## VM deployment

1. Copy `.env.example` to `.env` and replace the placeholder secrets.
2. Clone the repo on the VM.
3. Run:

```bash
sudo chmod +x scripts/bootstrap-vm.sh scripts/post-install-check.sh
sudo ./scripts/bootstrap-vm.sh
```

4. Verify:

```bash
sudo /opt/cloudos/scripts/post-install-check.sh
```

The dashboard stack will run alongside Nginx Proxy Manager, Portainer, n8n, and Dozzle under Docker.
