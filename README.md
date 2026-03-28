# CloudOS VM Bootstrap

This repository bootstraps the first layer of the CloudOS stack on a fresh Ubuntu VM.

Current scope:

- Create a hardened base VM user and SSH setup
- Install Docker Engine and the Compose plugin
- Configure a minimal firewall policy
- Prepare persistent directories under `/opt/cloudos`
- Start the base infrastructure services:
  - Nginx Proxy Manager
  - Portainer
  - n8n
  - Dozzle

This is the foundation for the larger control panel system. Application services such as VPN, media, downloads, ad blocking, and file workflows can be added on top of this stack in later phases.

## Files

- [infra/cloud-init.yaml](C:\CloudOs\infra\cloud-init.yaml): optional first-boot provisioning for a new Ubuntu VM
- [infra/docker-compose.yml](C:\CloudOs\infra\docker-compose.yml): base Docker stack
- [scripts/bootstrap-vm.sh](C:\CloudOs\scripts\bootstrap-vm.sh): idempotent VM setup script
- [scripts/post-install-check.sh](C:\CloudOs\scripts\post-install-check.sh): basic health checks after deployment
- [\.env.example](C:\CloudOs\.env.example): environment variables for the Docker stack

## Recommended Host

- Ubuntu Server 24.04 LTS
- 2 vCPU minimum
- 4 GB RAM minimum
- 40 GB disk minimum

## Ports

Open only what you need:

- `22/tcp` for SSH
- `80/tcp` for HTTP
- `81/tcp` for Nginx Proxy Manager admin
- `443/tcp` for HTTPS
- `9000/tcp` for Portainer
- `5678/tcp` for n8n
- `9999/tcp` for Dozzle

In production, prefer exposing only `80` and `443` publicly and routing the other services through the reverse proxy or a VPN.

## Quick Start

1. Copy [\.env.example](C:\CloudOs\.env.example) to `.env` and set strong secrets.
2. Provision the VM with [infra/cloud-init.yaml](C:\CloudOs\infra\cloud-init.yaml) or run [scripts/bootstrap-vm.sh](C:\CloudOs\scripts\bootstrap-vm.sh) manually on the server.
3. Run:

```bash
cd /opt/cloudos
docker compose --env-file .env -f docker-compose.yml up -d
```

4. Verify with:

```bash
/opt/cloudos/scripts/post-install-check.sh
```

## Phase 1 Outcome

After this setup, the VM will be ready to host:

- the reverse proxy entry point
- container orchestration and logs
- the first automation workflows

The next step after VM setup is to add the actual CloudOS dashboard service and wire it through the proxy.
