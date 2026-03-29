import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import type { VpnDashboardData, VpnPeerRecord } from "./types.js";

const execFileAsync = promisify(execFile);

type VpnState = {
  uiSettings?: { endpoint: string; dns: string; allowedIps: string; refreshSeconds: number };
  deviceNames?: Record<string, string>;
  disabledPeers?: Record<string, { rawBlock: string; blockedUntil: number; name: string }>;
  generatedConfigs?: Record<string, { name: string; address: string; publicKey: string; peerId: string; clientConfig: string }>;
  analytics?: Array<{ timestamp: number; onlinePeers: number; rxBytes: number; txBytes: number }>;
  backups?: Array<{ path: string; createdAt: string }>;
};

type RuntimePeer = {
  publicKey: string;
  endpoint: string;
  allowedIps: string;
  handshakeEpoch: number;
  rxBytes: number;
  txBytes: number;
  keepalive: string;
};

type ConfigPeer = Record<string, string> & { __raw__?: string };

function readVpnState(): VpnState {
  if (!fs.existsSync(config.vpnStateFile)) {
    const initial: VpnState = { deviceNames: {}, disabledPeers: {}, generatedConfigs: {}, analytics: [], backups: [] };
    fs.mkdirSync(path.dirname(config.vpnStateFile), { recursive: true });
    fs.writeFileSync(config.vpnStateFile, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(config.vpnStateFile, "utf8")) as VpnState;
}

function saveVpnState(state: VpnState) {
  fs.mkdirSync(path.dirname(config.vpnStateFile), { recursive: true });
  fs.writeFileSync(config.vpnStateFile, JSON.stringify(state, null, 2));
}

function uiSettings(state: VpnState) {
  return {
    endpoint: state.uiSettings?.endpoint ?? config.vpnServerEndpoint,
    dns: state.uiSettings?.dns ?? config.vpnDefaultDns,
    allowedIps: state.uiSettings?.allowedIps ?? config.vpnDefaultAllowedIps,
    refreshSeconds: state.uiSettings?.refreshSeconds ?? config.vpnRefreshSeconds
  };
}

async function runCommand(args: string[], input?: string) {
  const [firstArg, ...rest] = args;
  if (!firstArg) throw new Error("Missing command");
  const command = config.vpnUseSudo ? "sudo" : firstArg;
  const finalArgs = config.vpnUseSudo ? args : rest;
  const result = await execFileAsync(command, finalArgs, { input, encoding: "utf8" } as never);
  return String(result.stdout).trim();
}

function readConfigText() {
  return fs.existsSync(config.vpnConfigPath) ? fs.readFileSync(config.vpnConfigPath, "utf8") : "";
}

function writeConfigText(text: string) {
  fs.writeFileSync(config.vpnConfigPath, text.endsWith("\n") ? text : `${text}\n`);
}

function parseConfig() {
  const text = readConfigText();
  if (!text) return { interfaceConfig: {} as Record<string, string>, peers: [] as ConfigPeer[], text };

  const lines = text.split(/\r?\n/);
  const interfaceConfig: Record<string, string> = {};
  const peers: ConfigPeer[] = [];
  let current: ConfigPeer | Record<string, string> | null = null;
  let blockLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      if (current && "PublicKey" in current) blockLines.push(rawLine);
      continue;
    }

    if (line === "[Interface]") {
      current = interfaceConfig;
      blockLines = [rawLine];
      continue;
    }

    if (line === "[Peer]") {
      if (current && "PublicKey" in current) (current as ConfigPeer).__raw__ = blockLines.join("\n");
      current = {};
      peers.push(current as ConfigPeer);
      blockLines = [rawLine];
      continue;
    }

    const [key, ...rest] = rawLine.split("=");
    if (!key || !current) continue;
    const cleanKey = key.trim();
    const value = rest.join("=").trim();
    current[cleanKey] = value;
    blockLines.push(rawLine);
  }

  if (current && "PublicKey" in current) (current as ConfigPeer).__raw__ = blockLines.join("\n");
  return { interfaceConfig, peers, text };
}

async function interfaceIsUp() {
  try {
    await runCommand(["wg", "show", config.vpnInterface]);
    return true;
  } catch {
    return false;
  }
}

async function parseDump() {
  const dump = await runCommand(["wg", "show", config.vpnInterface, "dump"]);
  const [interfaceLine, ...peerLines] = dump.split(/\r?\n/).filter(Boolean);
  const interfaceParts = interfaceLine?.split("\t") ?? [];
  const peers: RuntimePeer[] = peerLines.map((line: string) => {
    const [publicKey, , endpoint, allowedIps, handshakeEpoch, rxBytes, txBytes, keepalive] = line.split("\t");
    return {
      publicKey: publicKey ?? "",
      endpoint: endpoint || "N/A",
      allowedIps: allowedIps ?? "",
      handshakeEpoch: Number(handshakeEpoch || 0),
      rxBytes: Number(rxBytes || 0),
      txBytes: Number(txBytes || 0),
      keepalive: keepalive || "off"
    };
  });

  return {
    interfaceData: { publicKey: interfaceParts[1] ?? "", listenPort: interfaceParts[2] ?? "" },
    peers
  };
}

function shortKey(key: string) {
  return key ? `${key.slice(0, 10)}...${key.slice(-6)}` : "Unavailable";
}

function humanBytes(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatAge(epoch: number) {
  if (!epoch) return "Never";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - epoch);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function peerIdForKey(key: string) {
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 12);
}

function inferPool(addresses: string) {
  const primary = addresses.split(",")[0]?.trim();
  if (!primary) return "";
  const [ip, prefix] = primary.split("/");
  if (!ip || !prefix) return "";
  return `${ip}/${prefix}`;
}

function nextAvailableIp(interfaceAddress: string, peers: ConfigPeer[]) {
  const [ip, prefix] = interfaceAddress.split("/"); 
  if (!ip || !prefix) return "";
  const base = ip.split(".").slice(0, 3).join(".");
  const used = new Set(
    peers
      .map((peer) => peer.AllowedIPs?.split(",")[0]?.trim())
      .filter(Boolean)
      .map((entry) => entry?.split("/")[0] ?? "")
  );
  for (let host = 2; host < 255; host += 1) {
    const candidate = `${base}.${host}`;
    if (!used.has(candidate) && candidate !== ip) return `${candidate}/32`;
  }
  return "";
}

function appendAnalytics(state: VpnState, onlinePeers: number, rxBytes: number, txBytes: number) {
  state.analytics ??= [];
  state.analytics.push({ timestamp: Date.now(), onlinePeers, rxBytes, txBytes });
  state.analytics = state.analytics.slice(-24);
}

export async function getVpnDashboard(): Promise<VpnDashboardData> {
  const state = readVpnState();
  const settings = uiSettings(state);
  const { interfaceConfig, peers: configPeers, text } = parseConfig();
  const up = await interfaceIsUp();
  const runtime = up ? await parseDump() : { interfaceData: { publicKey: "", listenPort: "" }, peers: [] };
  const configByKey = new Map(configPeers.filter((peer) => peer.PublicKey).map((peer) => [peer.PublicKey!, peer]));
  const mergedPeers: VpnPeerRecord[] = [];
  let totalRx = 0;
  let totalTx = 0;
  let latestHandshake = 0;

  for (const peer of runtime.peers) {
    const meta = configByKey.get(peer.publicKey) ?? {};
    const peerKey = peer.publicKey;
    const disabledMeta = peerKey ? state.disabledPeers?.[peerKey] : undefined;
    const online = Boolean(peer.handshakeEpoch && Date.now() / 1000 - peer.handshakeEpoch < 180);
    totalRx += peer.rxBytes;
    totalTx += peer.txBytes;
    latestHandshake = Math.max(latestHandshake, peer.handshakeEpoch);
    mergedPeers.push({
      peerId: peerIdForKey(peer.publicKey),
      name: (peerKey ? state.deviceNames?.[peerKey] : undefined) ?? meta.Name ?? `Peer ${mergedPeers.length + 1}`,
      publicKey: peer.publicKey,
      publicKeyShort: shortKey(peer.publicKey),
      endpoint: peer.endpoint,
      allowedIps: peer.allowedIps || meta.AllowedIPs || "",
      keepalive: peer.keepalive || meta.PersistentKeepalive || "off",
      rxHuman: humanBytes(peer.rxBytes),
      txHuman: humanBytes(peer.txBytes),
      handshakeAgo: formatAge(peer.handshakeEpoch),
      online,
      disabled: Boolean(disabledMeta),
      blockedUntil: disabledMeta?.blockedUntil,
      blockedUntilHuman: disabledMeta?.blockedUntil ? new Date(disabledMeta.blockedUntil * 1000).toLocaleString() : ""
    });
  }

  for (const peer of configPeers) {
    const peerKey = peer.PublicKey;
    if (!peerKey || mergedPeers.some((item) => item.publicKey === peerKey)) continue;
    mergedPeers.push({
      peerId: peerIdForKey(peerKey),
      name: state.deviceNames?.[peerKey] ?? peer.Name ?? `Peer ${mergedPeers.length + 1}`,
      publicKey: peerKey,
      publicKeyShort: shortKey(peerKey),
      endpoint: "N/A",
      allowedIps: peer.AllowedIPs ?? "",
      keepalive: peer.PersistentKeepalive ?? "off",
      rxHuman: "0 B",
      txHuman: "0 B",
      handshakeAgo: "Pending activation",
      online: false,
      disabled: Boolean(state.disabledPeers?.[peerKey])
    });
  }

  appendAnalytics(state, mergedPeers.filter((peer) => peer.online).length, totalRx, totalTx);
  saveVpnState(state);

  return {
    interface: {
      name: config.vpnInterface,
      up,
      publicKey: runtime.interfaceData.publicKey,
      publicKeyShort: shortKey(runtime.interfaceData.publicKey),
      listenPort: runtime.interfaceData.listenPort || interfaceConfig.ListenPort || "",
      addresses: interfaceConfig.Address || "",
      endpointHint: settings.endpoint,
      configAccessible: Boolean(text)
    },
    stats: {
      totalPeers: mergedPeers.length,
      onlinePeers: mergedPeers.filter((peer) => peer.online).length,
      totalRx: humanBytes(totalRx),
      totalTx: humanBytes(totalTx),
      latestHandshake: formatAge(latestHandshake),
      nextIp: nextAvailableIp(interfaceConfig.Address || "", configPeers),
      pool: inferPool(interfaceConfig.Address || ""),
      disabledPeers: mergedPeers.filter((peer) => peer.disabled).length
    },
    defaults: settings,
    peers: mergedPeers.sort((left, right) => Number(right.online) - Number(left.online) || left.name.localeCompare(right.name)),
    generatedPeer: state.generatedConfigs?.last ?? null,
    generatedConfigs: Object.entries(state.generatedConfigs ?? {})
      .filter(([key]) => key !== "last")
      .map(([, value]) => value),
    analytics: state.analytics ?? [],
    configText: text,
    configPath: config.vpnConfigPath,
    generatedAt: new Date().toLocaleString(),
    error: text ? undefined : `WireGuard config not found at ${config.vpnConfigPath}`
  };
}

export function saveVpnSettings(payload: { endpoint: string; dns: string; allowedIps: string; refreshSeconds: number }) {
  const state = readVpnState();
  state.uiSettings = payload;
  saveVpnState(state);
}

export async function performVpnInterfaceAction(action: "start" | "stop" | "restart" | "reload") {
  if (action === "start") await runCommand(["wg-quick", "up", config.vpnInterface]);
  if (action === "stop") await runCommand(["wg-quick", "down", config.vpnInterface]);
  if (action === "restart") {
    try { await runCommand(["wg-quick", "down", config.vpnInterface]); } catch {}
    await runCommand(["wg-quick", "up", config.vpnInterface]);
  }
  if (action === "reload") {
    try { await runCommand(["wg-quick", "down", config.vpnInterface]); } catch {}
    await runCommand(["wg-quick", "up", config.vpnInterface]);
  }
}

function createKeyMaterial() {
  const privateKey = crypto.randomBytes(32).toString("base64");
  const publicKey = crypto.randomBytes(32).toString("base64");
  const presharedKey = crypto.randomBytes(32).toString("base64");
  return { privateKey, publicKey, presharedKey };
}

export function createVpnPeer(payload: { name: string; address: string; dns: string; allowedIps: string; endpoint: string; keepalive: string }) {
  const state = readVpnState();
  const { interfaceConfig, peers, text } = parseConfig();
  if (!text) throw new Error(`WireGuard config not found at ${config.vpnConfigPath}`);
  const address = payload.address || nextAvailableIp(interfaceConfig.Address || "", peers);
  if (!address) throw new Error("Could not infer next available client address.");
  const { privateKey, publicKey, presharedKey } = createKeyMaterial();
  const runtimePublicKey = "";
  const block = `\n[Peer]\n# Name: ${payload.name}\nPublicKey = ${publicKey}\nPresharedKey = ${presharedKey}\nAllowedIPs = ${address}\nPersistentKeepalive = ${payload.keepalive}\n`;
  writeConfigText(`${text.trim()}\n${block}`);
  state.deviceNames ??= {};
  state.generatedConfigs ??= {};
  state.deviceNames[publicKey] = payload.name;
  const generated = {
    name: payload.name,
    address,
    publicKey,
    peerId: peerIdForKey(publicKey),
    clientConfig: `[Interface]\nPrivateKey = ${privateKey}\nAddress = ${address}\nDNS = ${payload.dns}\n\n[Peer]\nPublicKey = ${runtimePublicKey || "server-public-key"}\nPresharedKey = ${presharedKey}\nAllowedIPs = ${payload.allowedIps}\nEndpoint = ${payload.endpoint}\nPersistentKeepalive = ${payload.keepalive}\n`
  };
  state.generatedConfigs.last = generated;
  state.generatedConfigs[publicKey] = generated;
  saveVpnState(state);
  return generated;
}

export function saveVpnConfig(text: string) {
  const current = readConfigText();
  if (!current) throw new Error(`WireGuard config not found at ${config.vpnConfigPath}`);
  backupVpnConfig();
  writeConfigText(text);
}

export function getVpnBackups() {
  return readVpnState().backups ?? [];
}

export function getVpnSystemInfo() {
  return { hostname: os.hostname(), uptime: Math.floor(os.uptime() / 3600) };
}

function backupVpnConfig() {
  const current = readConfigText();
  if (!current) throw new Error(`WireGuard config not found at ${config.vpnConfigPath}`);
  const state = readVpnState();
  state.backups ??= [];
  const backupPath = `${config.vpnConfigPath}.${Date.now()}.bak`;
  fs.writeFileSync(backupPath, current);
  state.backups.push({ path: backupPath, createdAt: new Date().toLocaleString() });
  state.backups = state.backups.slice(-12);
  saveVpnState(state);
  return backupPath;
}

function findPeerKeyById(peerId: string) {
  const dashboardPromise = parseConfig();
  const state = readVpnState();
  for (const peer of dashboardPromise.peers) {
    if (peer.PublicKey && peerIdForKey(peer.PublicKey) === peerId) return peer.PublicKey;
  }
  for (const key of Object.keys(state.disabledPeers ?? {})) {
    if (peerIdForKey(key) === peerId) return key;
  }
  throw new Error("Peer not found");
}

function rewriteConfig(mutator: (lines: string[]) => string[]) {
  const current = readConfigText();
  if (!current) throw new Error(`WireGuard config not found at ${config.vpnConfigPath}`);
  backupVpnConfig();
  writeConfigText(mutator(current.split(/\r?\n/)).join("\n"));
}

export function deleteVpnPeer(peerId: string) {
  const peerKey = findPeerKeyById(peerId);
  removeVpnPeerFromConfig(peerKey);
  const state = readVpnState();
  delete state.deviceNames?.[peerKey];
  delete state.generatedConfigs?.[peerKey];
  saveVpnState(state);
}

export function renameVpnPeer(peerId: string, name: string) {
  const peerKey = findPeerKeyById(peerId);
  const state = readVpnState();
  state.deviceNames ??= {};
  state.deviceNames[peerKey] = name;
  saveVpnState(state);
  rewriteConfig((lines) => {
    const updated: string[] = [];
    let inTarget = false;
    let sawName = false;
    for (const line of lines) {
      const stripped = line.trim();
      if (stripped === "[Peer]") {
        inTarget = false;
        sawName = false;
        updated.push(line);
        continue;
      }
      if (stripped.startsWith("PublicKey") && stripped.includes("=")) {
        const currentKey = stripped.split("=", 2)[1]?.trim() ?? "";
        inTarget = currentKey === peerKey;
        if (inTarget && !sawName && updated.at(-1)?.trim() === "[Peer]") {
          updated.push(`# Name: ${name}`);
          sawName = true;
        }
        updated.push(line);
        continue;
      }
      if (inTarget && stripped.startsWith("# Name:")) {
        updated.push(`# Name: ${name}`);
        sawName = true;
        continue;
      }
      updated.push(line);
    }
    return updated;
  });
}

export function updateVpnPeer(peerId: string, allowedIps: string, keepalive: string) {
  const peerKey = findPeerKeyById(peerId);
  rewriteConfig((lines) => {
    const updated: string[] = [];
    let inTarget = false;
    let sawAllowed = false;
    let sawKeepalive = false;
    for (const line of lines) {
      const stripped = line.trim();
      if (stripped === "[Peer]") {
        if (inTarget) {
          if (!sawAllowed) updated.push(`AllowedIPs = ${allowedIps}`);
          if (keepalive && !sawKeepalive) updated.push(`PersistentKeepalive = ${keepalive}`);
        }
        inTarget = false;
        sawAllowed = false;
        sawKeepalive = false;
        updated.push(line);
        continue;
      }
      if (stripped.startsWith("PublicKey") && stripped.includes("=")) {
        const currentKey = stripped.split("=", 2)[1]?.trim() ?? "";
        inTarget = currentKey === peerKey;
        updated.push(line);
        continue;
      }
      if (inTarget && stripped.startsWith("AllowedIPs")) {
        updated.push(`AllowedIPs = ${allowedIps}`);
        sawAllowed = true;
        continue;
      }
      if (inTarget && stripped.startsWith("PersistentKeepalive")) {
        if (keepalive) updated.push(`PersistentKeepalive = ${keepalive}`);
        sawKeepalive = true;
        continue;
      }
      updated.push(line);
    }
    if (inTarget) {
      if (!sawAllowed) updated.push(`AllowedIPs = ${allowedIps}`);
      if (keepalive && !sawKeepalive) updated.push(`PersistentKeepalive = ${keepalive}`);
    }
    return updated;
  });
}

export function disableVpnPeer(peerId: string, minutes = 0) {
  const peerKey = findPeerKeyById(peerId);
  const { peers } = parseConfig();
  const configPeer = peers.find((peer) => peer.PublicKey === peerKey);
  if (!configPeer?.__raw__) throw new Error("Peer config block not found.");
  removeVpnPeerFromConfig(peerKey);
  const state = readVpnState();
  state.disabledPeers ??= {};
  state.disabledPeers[peerKey] = {
    rawBlock: configPeer.__raw__,
    blockedUntil: minutes > 0 ? Math.floor(Date.now() / 1000) + minutes * 60 : 0,
    name: state.deviceNames?.[peerKey] ?? configPeer.Name ?? "Peer"
  };
  saveVpnState(state);
}

export function enableVpnPeer(peerId: string) {
  const peerKey = findPeerKeyById(peerId);
  const state = readVpnState();
  const payload = state.disabledPeers?.[peerKey];
  if (!payload) throw new Error("Peer is not disabled.");
  const current = readConfigText();
  if (!current) throw new Error(`WireGuard config not found at ${config.vpnConfigPath}`);
  backupVpnConfig();
  writeConfigText(`${current.trim()}\n${payload.rawBlock}\n`);
  delete state.disabledPeers?.[peerKey];
  saveVpnState(state);
}

export async function reconnectVpnPeer(peerId: string) {
  const peerKey = findPeerKeyById(peerId);
  if (await interfaceIsUp()) {
    await runCommand(["wg", "set", config.vpnInterface, "peer", peerKey, "remove"]);
    await performVpnInterfaceAction("reload");
  }
}

function removeVpnPeerFromConfig(peerKey: string) {
  rewriteConfig((lines) => {
    const result: string[] = [];
    let block: string[] = [];
    let inPeer = false;

    const flush = () => {
      if (!block.length) return;
      const matches = block.some((line) => line.trim().startsWith("PublicKey") && line.includes("=") && line.split("=", 2)[1]?.trim() === peerKey);
      if (!matches) result.push(...block);
      block = [];
    };

    for (const line of lines) {
      const stripped = line.trim();
      if (stripped === "[Peer]") {
        flush();
        inPeer = true;
        block = [line];
        continue;
      }
      if (inPeer) {
        if (stripped === "[Interface]") {
          flush();
          inPeer = false;
          result.push(line);
          continue;
        }
        block.push(line);
      } else {
        result.push(line);
      }
    }
    flush();
    return result;
  });
}

export function createVpnBackup() {
  return backupVpnConfig();
}

export function restoreVpnBackup(backupPath: string) {
  if (!fs.existsSync(backupPath)) throw new Error("Backup file not found.");
  const text = fs.readFileSync(backupPath, "utf8");
  backupVpnConfig();
  writeConfigText(text);
}

export function downloadGeneratedVpnConfig(peerId: string) {
  const state = readVpnState();
  const item = Object.values(state.generatedConfigs ?? {}).find((entry) => entry.peerId === peerId);
  if (!item) throw new Error("Generated config not found");
  return item;
}
