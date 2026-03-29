import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { authMiddleware, createSessionToken, login } from "./auth.js";
import { config } from "./config.js";
import { appendAudit, enqueueDownload, getOverview, getServiceLogs, getServices, listFiles, runServiceAction, scanMediaLibrary } from "./system.js";
import { stateStore } from "./store.js";
import { createVpnPeer, getVpnBackups, getVpnDashboard, getVpnSystemInfo, performVpnInterfaceAction, saveVpnConfig, saveVpnSettings } from "./vpn.js";
import type { AuthenticatedRequest } from "./auth.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const serviceActionSchema = z.object({
  action: z.enum(["start", "stop", "restart"])
});

const downloadSchema = z.object({
  url: z.string().url(),
  targetName: z.string().optional()
});

const ruleSchema = z.object({
  name: z.string().min(1),
  condition: z.string().min(1),
  action: z.string().min(1),
  enabled: z.boolean()
});

const workflowSchema = z.object({
  name: z.string().min(1),
  trigger: z.string().min(1),
  action: z.string().min(1),
  enabled: z.boolean()
});

const notificationSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["telegram", "webhook"]),
  endpoint: z.string().min(1),
  enabled: z.boolean()
});

const deviceSchema = z.object({
  name: z.string().min(1),
  status: z.enum(["active", "inactive", "blocked"]),
  ipAddress: z.string().min(1),
  usageMb: z.number().nonnegative(),
  killSwitchEnabled: z.boolean()
});

const shareSchema = z.object({
  path: z.string().min(1),
  password: z.string().optional(),
  expiresAt: z.string().optional()
});

const scriptRunSchema = z.object({
  command: z.string().min(1)
});

const tagSchema = z.object({
  path: z.string().min(1),
  tags: z.array(z.string()),
  notes: z.string().optional()
});

const vpnSettingsSchema = z.object({
  endpoint: z.string(),
  dns: z.string(),
  allowedIps: z.string(),
  refreshSeconds: z.number().int().min(5)
});

const vpnPeerSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  dns: z.string().min(1),
  allowedIps: z.string().min(1),
  endpoint: z.string().min(1),
  keepalive: z.string().min(1)
});

const vpnConfigSchema = z.object({
  configText: z.string().min(1)
});

const upload = multer({ dest: config.filesRoot });

export const router = Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

router.post("/auth/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const user = login(parsed.data.username, parsed.data.password);
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  res.cookie(config.cookieName, createSessionToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
  res.json({ user });
});

router.post("/auth/logout", authMiddleware, (_req, res) => {
  res.clearCookie(config.cookieName);
  res.status(204).end();
});

router.get("/auth/session", authMiddleware, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

router.use(authMiddleware);

router.get("/overview", async (_req, res) => {
  res.json(await getOverview());
});

router.get("/services", async (_req, res) => {
  res.json(await getServices());
});

router.post("/services/:id/action", async (req, res) => {
  const service = stateStore.getState().services.find((entry) => entry.id === req.params.id);
  if (!service) {
    res.status(404).json({ error: "Service not found" });
    return;
  }

  const parsed = serviceActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const services = await runServiceAction(service, parsed.data.action);
    appendAudit("service.action", `${parsed.data.action} ${service.name}`, "admin");
    res.json(services);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Action failed" });
  }
});

router.get("/services/:id/logs", async (req, res) => {
  const service = stateStore.getState().services.find((entry) => entry.id === req.params.id);
  if (!service) {
    res.status(404).json({ error: "Service not found" });
    return;
  }

  res.json({ logs: await getServiceLogs(service) });
});

router.get("/vpn/dashboard", async (_req, res) => {
  res.json({
    ...(await getVpnDashboard()),
    system: getVpnSystemInfo(),
    backups: getVpnBackups()
  });
});

router.post("/vpn/interface/:action", async (req, res) => {
  const action = req.params.action;
  if (action !== "start" && action !== "stop" && action !== "restart" && action !== "reload") {
    res.status(404).json({ error: "Invalid action" });
    return;
  }

  try {
    await performVpnInterfaceAction(action);
    appendAudit("vpn.interface", `Performed ${action} on ${config.vpnInterface}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "VPN action failed" });
  }
});

router.post("/vpn/settings", (req, res) => {
  const parsed = vpnSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  saveVpnSettings(parsed.data);
  appendAudit("vpn.settings", "Updated VPN dashboard defaults", "admin");
  res.status(204).end();
});

router.post("/vpn/peers", (req, res) => {
  const parsed = vpnPeerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const generated = createVpnPeer(parsed.data);
    appendAudit("vpn.peer.create", `Created VPN peer ${generated.name}`, "admin");
    res.status(201).json(generated);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create VPN peer" });
  }
});

router.post("/vpn/config", (req, res) => {
  const parsed = vpnConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    saveVpnConfig(parsed.data.configText);
    appendAudit("vpn.config.save", "Saved VPN config", "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to save VPN config" });
  }
});

router.get("/devices", (_req, res) => {
  res.json(stateStore.getState().devices);
});

router.post("/devices", (req, res) => {
  const parsed = deviceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const record = {
    id: `device-${Date.now()}`,
    lastSeenAt: new Date().toISOString(),
    ...parsed.data
  };

  stateStore.update((draft) => {
    draft.devices.push(record);
  });
  appendAudit("device.created", `Added device ${record.name}`, "admin");
  res.status(201).json(record);
});

router.patch("/devices/:id/toggle", (req, res) => {
  let updated;
  stateStore.update((draft) => {
    const device = draft.devices.find((entry) => entry.id === req.params.id);
    if (device) {
      device.status = device.status === "blocked" ? "active" : "blocked";
      updated = device;
    }
  });

  if (!updated) {
    res.status(404).json({ error: "Device not found" });
    return;
  }

  appendAudit("device.updated", `Toggled device ${req.params.id}`, "admin");
  res.json(updated);
});

router.get("/files", (req, res) => {
  try {
    const requestedPath = typeof req.query.path === "string" ? req.query.path : config.filesRoot;
    res.json(listFiles(requestedPath));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to list files" });
  }
});

router.post("/files/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "File missing" });
    return;
  }

  const targetDir = path.join(config.filesRoot, typeof req.body.folder === "string" ? req.body.folder : "");
  fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, req.file.originalname);
  fs.renameSync(req.file.path, targetPath);
  appendAudit("file.upload", `Uploaded ${req.file.originalname}`, "admin");
  res.status(201).json({ path: targetPath });
});

router.post("/files/tags", (req, res) => {
  const parsed = tagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  stateStore.update((draft) => {
    const existing = draft.fileTags.find((entry) => entry.path === parsed.data.path);
    if (existing) {
      existing.tags = parsed.data.tags;
      existing.notes = parsed.data.notes;
      return;
    }

    draft.fileTags.push(parsed.data);
  });

  res.status(201).json(parsed.data);
});

router.get("/files/tags", (_req, res) => {
  res.json(stateStore.getState().fileTags);
});

router.get("/downloads", (_req, res) => {
  res.json(stateStore.getState().downloads);
});

router.post("/downloads", async (req, res) => {
  const parsed = downloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  res.status(201).json(await enqueueDownload(parsed.data.url, parsed.data.targetName));
});

router.get("/media", (_req, res) => {
  res.json(stateStore.getState().media);
});

router.post("/media/scan", (_req, res) => {
  res.json(scanMediaLibrary());
});

router.get("/automation/workflows", (_req, res) => {
  res.json(stateStore.getState().workflows);
});

router.post("/automation/workflows", (req, res) => {
  const parsed = workflowSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const record = {
    id: `workflow-${Date.now()}`,
    ...parsed.data
  };
  stateStore.update((draft) => {
    draft.workflows.push(record);
  });
  res.status(201).json(record);
});

router.get("/automation/rules", (_req, res) => {
  res.json(stateStore.getState().rules);
});

router.post("/automation/rules", (req, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const record = {
    id: `rule-${Date.now()}`,
    ...parsed.data
  };
  stateStore.update((draft) => {
    draft.rules.push(record);
  });
  res.status(201).json(record);
});

router.get("/notifications", (_req, res) => {
  res.json(stateStore.getState().notifications);
});

router.post("/notifications", (req, res) => {
  const parsed = notificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const record = {
    id: `notification-${Date.now()}`,
    ...parsed.data
  };
  stateStore.update((draft) => {
    draft.notifications.push(record);
  });
  res.status(201).json(record);
});

router.post("/notifications/test", async (req, res) => {
  const parsed = notificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  if (parsed.data.type === "webhook") {
    await fetch(parsed.data.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "CloudOS test notification" })
    });
  }

  if (parsed.data.type === "telegram") {
    await fetch(parsed.data.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "CloudOS test notification" })
    });
  }

  appendAudit("notification.test", `Sent test notification via ${parsed.data.type}`, "admin");
  res.status(204).end();
});

router.get("/analytics", (_req, res) => {
  const state = stateStore.getState();
  const bandwidthByDevice = state.devices.map((device) => ({
    name: device.name,
    usageMb: device.usageMb
  }));

  res.json({
    bandwidthByDevice,
    downloadsByStatus: ["queued", "running", "completed", "failed"].map((status) => ({
      status,
      count: state.downloads.filter((download) => download.status === status).length
    })),
    auditTimeline: state.audit.slice(-20).reverse()
  });
});

router.get("/security/adblock", (_req, res) => {
  res.json({
    enabled: false,
    provider: "Not configured",
    blockedToday: 0
  });
});

router.get("/security/antivirus", (_req, res) => {
  res.json({
    engine: "Not configured",
    lastScanAt: null,
    scannedFiles: 0,
    infectedFiles: 0
  });
});

router.get("/security/network", (_req, res) => {
  res.json(stateStore.getState().networkEvents);
});

router.get("/sharing", (_req, res) => {
  res.json(stateStore.getState().shareLinks);
});

router.post("/sharing", (req, res) => {
  const parsed = shareSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const record = {
    id: `share-${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...parsed.data
  };
  stateStore.update((draft) => {
    draft.shareLinks.push(record);
  });
  res.status(201).json(record);
});

router.get("/scripts", (_req, res) => {
  res.json(stateStore.getState().scripts);
});

router.post("/scripts/run", async (req, res) => {
  const parsed = scriptRunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { exec } = await import("node:child_process");
  exec(parsed.data.command, { cwd: config.repoRoot }, (error, stdout, stderr) => {
    appendAudit("script.run", `Executed script command ${parsed.data.command}`, "admin");
    res.json({
      ok: !error,
      stdout,
      stderr,
      error: error?.message
    });
  });
});

router.get("/games", (_req, res) => {
  res.json({
    enabled: false,
    servers: []
  });
});
