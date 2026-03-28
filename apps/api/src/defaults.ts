import { hashSync } from "bcryptjs";
import type { AppState } from "./types.js";

const now = new Date().toISOString();

export const defaultState = (): AppState => ({
  users: [
    {
      id: "user-admin",
      username: "admin",
      passwordHash: hashSync("cloudosadmin", 10),
      role: "admin",
      createdAt: now
    }
  ],
  services: [
    {
      id: "nginx-proxy-manager",
      name: "Nginx Proxy Manager",
      category: "core",
      type: "docker",
      target: "nginx-proxy-manager",
      port: 81,
      description: "Reverse proxy and ingress management.",
      actions: ["restart", "open"]
    },
    {
      id: "portainer",
      name: "Portainer",
      category: "core",
      type: "docker",
      target: "portainer",
      port: 9000,
      description: "Container management control plane.",
      actions: ["restart", "open"]
    },
    {
      id: "n8n",
      name: "n8n",
      category: "automation",
      type: "docker",
      target: "n8n",
      port: 5678,
      description: "Workflow automation engine.",
      actions: ["restart", "open"]
    },
    {
      id: "dozzle",
      name: "Dozzle",
      category: "core",
      type: "docker",
      target: "dozzle",
      port: 9999,
      description: "Container log viewer.",
      actions: ["restart", "open"]
    },
    {
      id: "wireguard-vpn",
      name: "WireGuard VPN",
      category: "vpn",
      type: "external",
      target: "vpn-server",
      description: "External VPN gateway and device access layer.",
      actions: ["open"]
    }
  ],
  devices: [
    {
      id: "device-laptop",
      name: "Abhix Laptop",
      status: "active",
      ipAddress: "10.0.0.2",
      lastSeenAt: now,
      usageMb: 1842,
      killSwitchEnabled: true
    },
    {
      id: "device-phone",
      name: "Samsung Phone",
      status: "active",
      ipAddress: "10.0.0.3",
      lastSeenAt: now,
      usageMb: 620,
      killSwitchEnabled: false
    }
  ],
  fileTags: [],
  downloads: [],
  media: [],
  workflows: [
    {
      id: "workflow-download-sort",
      name: "Auto Sort Downloads",
      trigger: "download.completed",
      action: "Move file into categorized folder",
      enabled: true
    }
  ],
  rules: [
    {
      id: "rule-high-usage-alert",
      name: "High Usage Alert",
      condition: "device usage exceeds 5 GB in 24h",
      action: "send Telegram notification",
      enabled: true
    }
  ],
  notifications: [],
  scripts: [
    {
      id: "script-cleanup",
      name: "Cleanup Temp Files",
      command: "bash scripts/post-install-check.sh",
      description: "Placeholder maintenance action wired into the runner."
    }
  ],
  shareLinks: [],
  networkEvents: [
    {
      id: "evt-boot",
      source: "system",
      message: "CloudOS control plane initialized",
      severity: "info",
      createdAt: now
    }
  ],
  audit: [
    {
      id: "audit-bootstrap",
      type: "bootstrap",
      message: "Default state created",
      actor: "system",
      createdAt: now
    }
  ]
});
