import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { authMiddleware, createSessionToken, login } from "./auth.js";
import { config } from "./config.js";
import {
  createGameServerBackup,
  createGameServer,
  createGameServerFolder,
  deleteGameServerFiles,
  getGamesDashboard,
  getGameCreateCatalog,
  getGameEggTemplate,
  getGameServerConsoleWebsocket,
  getGameServerDetail,
  getGameServerFileContents,
  getGameServerFiles,
  performGamePowerAction,
  reinstallGameServer,
  renameGameServer,
  saveGameServerFileContents,
  sendGameServerCommand,
  updateGameServerDockerImage,
  updateGameServerStartupVariable
} from "./games.js";
import { appendAudit, createFolder, deletePath, enqueueDownload, getOverview, getServiceLogs, getServices, listFiles, movePath, runServiceAction, scanMediaLibrary } from "./system.js";
import { stateStore } from "./store.js";
import {
  createVpnBackup,
  createVpnPeer,
  deleteVpnPeer,
  disableVpnPeer,
  downloadGeneratedVpnConfig,
  enableVpnPeer,
  getVpnBackups,
  getVpnDashboard,
  getVpnSystemInfo,
  performVpnInterfaceAction,
  reconnectVpnPeer,
  renameVpnPeer,
  restoreVpnBackup,
  saveVpnConfig,
  saveVpnSettings,
  updateVpnPeer
} from "./vpn.js";
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
const shareAccessSchema = z.object({ password: z.string().optional() });
const folderSchema = z.object({ parentPath: z.string().min(1), name: z.string().min(1) });
const moveSchema = z.object({ sourcePath: z.string().min(1), destinationDir: z.string().min(1) });
const deleteSchema = z.object({ targetPath: z.string().min(1) });

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
  address: z.string().optional().default(""),
  dns: z.string().min(1),
  allowedIps: z.string().min(1),
  endpoint: z.string().min(1),
  keepalive: z.string().min(1)
});

const vpnConfigSchema = z.object({
  configText: z.string().min(1)
});

const vpnRenameSchema = z.object({ name: z.string().min(1) });
const vpnUpdatePeerSchema = z.object({ allowedIps: z.string().min(1), keepalive: z.string().optional().default("") });
const vpnBlockSchema = z.object({ minutes: z.number().int().min(1).default(30) });
const vpnRestoreSchema = z.object({ path: z.string().min(1) });
const gamePowerSchema = z.object({ signal: z.enum(["start", "stop", "restart", "kill"]) });
const gameCommandSchema = z.object({ command: z.string().min(1) });
const gameFileWriteSchema = z.object({ path: z.string().min(1), content: z.string() });
const gameFolderSchema = z.object({ directory: z.string().min(1), name: z.string().min(1) });
const gameDeleteFilesSchema = z.object({ directory: z.string().min(1), files: z.array(z.string().min(1)).min(1) });
const gameBackupSchema = z.object({ name: z.string().optional() });
const gameStartupVariableSchema = z.object({ key: z.string().min(1), value: z.string() });
const gameRenameSchema = z.object({ name: z.string().min(1), description: z.string().optional().default("") });
const gameDockerImageSchema = z.object({ dockerImage: z.string().min(1) });
const gameCreateServerSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  userId: z.number().int().positive(),
  eggId: z.number().int().positive(),
  dockerImage: z.string().optional(),
  startup: z.string().optional(),
  environment: z.record(z.string()),
  limits: z.object({
    memory: z.number().int().nonnegative(),
    disk: z.number().int().nonnegative(),
    cpu: z.number().int().nonnegative(),
    swap: z.number().int().optional(),
    io: z.number().int().optional()
  }),
  featureLimits: z.object({
    databases: z.number().int().nonnegative().optional(),
    allocations: z.number().int().nonnegative().optional(),
    backups: z.number().int().nonnegative().optional()
  }).optional(),
  allocation: z.object({
    default: z.number().int().positive(),
    additional: z.array(z.number().int().positive()).optional()
  })
});

const upload = multer({ dest: config.filesRoot });

export const router = Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

router.post("/public/shares/:id/access", (req, res) => {
  const share = stateStore.getState().shareLinks.find((entry) => entry.id === req.params.id);
  if (!share) {
    res.status(404).json({ error: "Share not found" });
    return;
  }
  if (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now()) {
    res.status(410).json({ error: "Share expired" });
    return;
  }
  const parsed = shareAccessSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (share.password && share.password !== parsed.data.password) {
    res.status(403).json({ error: "Invalid share password" });
    return;
  }
  if (!fs.existsSync(share.path)) {
    res.status(404).json({ error: "Shared file missing" });
    return;
  }
  res.download(share.path);
});

router.get("/public/shares/:id/access", (req, res) => {
  const share = stateStore.getState().shareLinks.find((entry) => entry.id === req.params.id);
  if (!share) {
    res.status(404).json({ error: "Share not found" });
    return;
  }
  if (share.password) {
    res.status(403).json({ error: "Password required" });
    return;
  }
  if (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now()) {
    res.status(410).json({ error: "Share expired" });
    return;
  }
  if (!fs.existsSync(share.path)) {
    res.status(404).json({ error: "Shared file missing" });
    return;
  }
  res.download(share.path);
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
    system: await getVpnSystemInfo(),
    backups: await getVpnBackups()
  });
});

router.post("/vpn/interface/:action", async (req, res) => {
  const action = req.params.action;
  if (action !== "start" && action !== "stop" && action !== "restart" && action !== "reload" && action !== "save") {
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

router.post("/vpn/settings", async (req, res) => {
  const parsed = vpnSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  await saveVpnSettings(parsed.data);
  appendAudit("vpn.settings", "Updated VPN dashboard defaults", "admin");
  res.status(204).end();
});

router.post("/vpn/peers", async (req, res) => {
  const parsed = vpnPeerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const generated = await createVpnPeer(parsed.data);
    appendAudit("vpn.peer.create", `Created VPN peer ${generated.name}`, "admin");
    res.status(201).json(generated);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create VPN peer" });
  }
});

router.post("/vpn/config", async (req, res) => {
  const parsed = vpnConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    await saveVpnConfig(parsed.data.configText);
    appendAudit("vpn.config.save", "Saved VPN config", "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to save VPN config" });
  }
});

router.post("/vpn/backups", async (_req, res) => {
  try {
    const backupResult = await createVpnBackup();
    const backupPath = typeof backupResult === "string" ? backupResult : backupResult.path;
    appendAudit("vpn.backup.create", `Created VPN backup ${backupPath}`, "admin");
    res.status(201).json({ path: backupPath });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create backup" });
  }
});

router.post("/vpn/backups/restore", async (req, res) => {
  const parsed = vpnRestoreSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    await restoreVpnBackup(parsed.data.path);
    appendAudit("vpn.backup.restore", `Restored VPN backup ${parsed.data.path}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to restore backup" });
  }
});

router.get("/vpn/clients/:peerId/download", async (req, res) => {
  try {
    const generated = await downloadGeneratedVpnConfig(req.params.peerId);
    res.setHeader("content-disposition", `attachment; filename="${generated.name.replace(/\s+/g, "_")}.conf"`);
    res.type("text/plain").send(generated.clientConfig);
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "Generated config not found" });
  }
});

router.post("/vpn/peers/:peerId/rename", async (req, res) => {
  const parsed = vpnRenameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    await renameVpnPeer(req.params.peerId, parsed.data.name);
    appendAudit("vpn.peer.rename", `Renamed VPN peer ${req.params.peerId}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to rename peer" });
  }
});

router.post("/vpn/peers/:peerId/update", async (req, res) => {
  const parsed = vpnUpdatePeerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    await updateVpnPeer(req.params.peerId, parsed.data.allowedIps, parsed.data.keepalive);
    appendAudit("vpn.peer.update", `Updated VPN peer ${req.params.peerId}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to update peer" });
  }
});

router.post("/vpn/peers/:peerId/disable", async (req, res) => {
  try {
    await disableVpnPeer(req.params.peerId);
    appendAudit("vpn.peer.disable", `Disabled VPN peer ${req.params.peerId}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to disable peer" });
  }
});

router.post("/vpn/peers/:peerId/enable", async (req, res) => {
  try {
    await enableVpnPeer(req.params.peerId);
    appendAudit("vpn.peer.enable", `Enabled VPN peer ${req.params.peerId}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to enable peer" });
  }
});

router.post("/vpn/peers/:peerId/block", async (req, res) => {
  const parsed = vpnBlockSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    await disableVpnPeer(req.params.peerId, parsed.data.minutes);
    appendAudit("vpn.peer.block", `Blocked VPN peer ${req.params.peerId} for ${parsed.data.minutes} minutes`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to block peer" });
  }
});

router.post("/vpn/peers/:peerId/reconnect", async (req, res) => {
  try {
    await reconnectVpnPeer(req.params.peerId);
    appendAudit("vpn.peer.reconnect", `Reconnected VPN peer ${req.params.peerId}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to reconnect peer" });
  }
});

router.delete("/vpn/peers/:peerId", async (req, res) => {
  try {
    await deleteVpnPeer(req.params.peerId);
    appendAudit("vpn.peer.delete", `Deleted VPN peer ${req.params.peerId}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to delete peer" });
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

router.post("/files/folders", (req, res) => {
  const parsed = folderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    appendAudit("file.folder.create", `Created folder ${parsed.data.name}`, "admin");
    res.status(201).json(createFolder(parsed.data.parentPath, parsed.data.name));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create folder" });
  }
});

router.post("/files/move", (req, res) => {
  const parsed = moveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const target = movePath(parsed.data.sourcePath, parsed.data.destinationDir);
    appendAudit("file.move", `Moved ${parsed.data.sourcePath} to ${target}`, "admin");
    res.json({ target });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to move path" });
  }
});

router.delete("/files", (req, res) => {
  const parsed = deleteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    deletePath(parsed.data.targetPath);
    appendAudit("file.delete", `Deleted ${parsed.data.targetPath}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to delete path" });
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

router.post("/downloads/:id/retry", async (req, res) => {
  const existing = stateStore.getState().downloads.find((item) => item.id === req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Download not found" });
    return;
  }
  res.status(201).json(await enqueueDownload(existing.url, path.basename(existing.targetPath)));
});

router.delete("/downloads/:id", (req, res) => {
  stateStore.update((draft) => {
    draft.downloads = draft.downloads.filter((item) => item.id !== req.params.id);
  });
  appendAudit("download.delete", `Deleted download record ${req.params.id}`, "admin");
  res.status(204).end();
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

router.get("/games", async (_req, res) => {
  res.json(await getGamesDashboard());
});

router.get("/games/catalog", async (_req, res) => {
  try {
    res.json(await getGameCreateCatalog());
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to load game catalog" });
  }
});

router.get("/games/nests/:nestId/eggs/:eggId", async (req, res) => {
  try {
    res.json(await getGameEggTemplate(req.params.nestId, req.params.eggId));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to load egg template" });
  }
});

router.post("/games/servers", async (req, res) => {
  const parsed = gameCreateServerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    await createGameServer(parsed.data);
    appendAudit("games.server.create", `Created game server ${parsed.data.name}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create game server" });
  }
});

router.get("/games/servers/:identifier", async (req, res) => {
  try {
    res.json(await getGameServerDetail(req.params.identifier));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to load game server details" });
  }
});

router.get("/games/servers/:identifier/console/websocket", async (req, res) => {
  try {
    res.json(await getGameServerConsoleWebsocket(req.params.identifier));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create console session" });
  }
});

router.put("/games/servers/:identifier/startup/variable", async (req, res) => {
  const parsed = gameStartupVariableSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    await updateGameServerStartupVariable(req.params.identifier, parsed.data.key, parsed.data.value);
    appendAudit("games.startup.update", `Updated ${parsed.data.key} on ${req.params.identifier}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to update startup variable" });
  }
});

router.post("/games/servers/:identifier/settings/rename", async (req, res) => {
  const parsed = gameRenameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    await renameGameServer(req.params.identifier, parsed.data.name, parsed.data.description);
    appendAudit("games.settings.rename", `Renamed game server ${req.params.identifier}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to rename server" });
  }
});

router.post("/games/servers/:identifier/settings/reinstall", async (req, res) => {
  try {
    await reinstallGameServer(req.params.identifier);
    appendAudit("games.settings.reinstall", `Triggered reinstall for ${req.params.identifier}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to reinstall server" });
  }
});

router.put("/games/servers/:identifier/settings/docker-image", async (req, res) => {
  const parsed = gameDockerImageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    await updateGameServerDockerImage(req.params.identifier, parsed.data.dockerImage);
    appendAudit("games.settings.image", `Updated docker image for ${req.params.identifier}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to update docker image" });
  }
});

router.post("/games/servers/:identifier/command", async (req, res) => {
  const parsed = gameCommandSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    await sendGameServerCommand(req.params.identifier, parsed.data.command);
    appendAudit("games.command", `Sent command to game server ${req.params.identifier}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to send command" });
  }
});

router.get("/games/servers/:identifier/files", async (req, res) => {
  const directory = typeof req.query.directory === "string" ? req.query.directory : "/";
  try {
    res.json(await getGameServerFiles(req.params.identifier, directory));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to load server files" });
  }
});

router.get("/games/servers/:identifier/file", async (req, res) => {
  const filePath = typeof req.query.path === "string" ? req.query.path : "";
  if (!filePath) {
    res.status(400).json({ error: "File path is required" });
    return;
  }

  try {
    res.json({ path: filePath, content: await getGameServerFileContents(req.params.identifier, filePath) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to read server file" });
  }
});

router.post("/games/servers/:identifier/file", async (req, res) => {
  const parsed = gameFileWriteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    await saveGameServerFileContents(req.params.identifier, parsed.data.path, parsed.data.content);
    appendAudit("games.file.save", `Saved ${parsed.data.path} on game server ${req.params.identifier}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to save server file" });
  }
});

router.post("/games/servers/:identifier/files/folders", async (req, res) => {
  const parsed = gameFolderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    await createGameServerFolder(req.params.identifier, parsed.data.directory, parsed.data.name);
    appendAudit("games.file.folder", `Created folder ${parsed.data.name} on ${req.params.identifier}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create folder" });
  }
});

router.delete("/games/servers/:identifier/files", async (req, res) => {
  const parsed = gameDeleteFilesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    await deleteGameServerFiles(req.params.identifier, parsed.data.directory, parsed.data.files);
    appendAudit("games.file.delete", `Deleted ${parsed.data.files.join(", ")} on ${req.params.identifier}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to delete files" });
  }
});

router.post("/games/servers/:identifier/power", async (req, res) => {
  const parsed = gamePowerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    await performGamePowerAction(req.params.identifier, parsed.data.signal);
    appendAudit("games.power", `Sent ${parsed.data.signal} to game server ${req.params.identifier}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to control game server" });
  }
});

router.post("/games/servers/:identifier/backups", async (req, res) => {
  const parsed = gameBackupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    await createGameServerBackup(req.params.identifier, parsed.data.name);
    appendAudit("games.backup.create", `Created backup for ${req.params.identifier}`, "admin");
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create backup" });
  }
});
