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

function useRemoteBackend() {
  return Boolean(config.vpnRemoteUrl);
}

async function remoteRequest(pathname: string, init?: RequestInit) {
  if (!config.vpnRemoteUrl) throw new Error("VPN remote URL is not configured");
  const response = await fetch(`${config.vpnRemoteUrl.replace(/\/+$/, "")}${pathname}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      "x-cloudos-vpn-token": config.vpnAgentToken,
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `VPN remote request failed (${response.status})`);
  }
  return response;
}

async function remoteJson<T>(pathname: string, init?: RequestInit) {
  const response = await remoteRequest(pathname, init);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function normalizeRemoteDashboard(payload: any): VpnDashboardData {
  return {
    interface: {
      name: payload.interface?.name ?? config.vpnInterface,
      up: Boolean(payload.interface?.up),
      publicKey: payload.interface?.public_key ?? "",
      publicKeyShort: payload.interface?.public_key_short ?? "Unavailable",
      listenPort: payload.interface?.listen_port ?? "",
      addresses: payload.interface?.addresses ?? "",
      endpointHint: payload.interface?.endpoint_hint ?? "",
      configAccessible: Boolean(payload.interface?.config_accessible)
    },
    stats: {
      totalPeers: payload.stats?.total_peers ?? 0,
      onlinePeers: payload.stats?.online_peers ?? 0,
      totalRx: payload.stats?.total_rx ?? "0 B",
      totalTx: payload.stats?.total_tx ?? "0 B",
      latestHandshake: payload.stats?.latest_handshake ?? "Never",
      nextIp: payload.stats?.next_ip ?? "",
      pool: payload.stats?.pool ?? "",
      disabledPeers: payload.stats?.disabled_peers ?? 0
    },
    defaults: {
      endpoint: payload.interface?.endpoint_hint ?? "",
      dns: payload.defaults?.dns ?? config.vpnDefaultDns,
      allowedIps: payload.defaults?.allowed_ips ?? config.vpnDefaultAllowedIps,
      refreshSeconds: payload.defaults?.refresh_seconds ?? config.vpnRefreshSeconds
    },
    peers: (payload.peers ?? []).map((peer: any) => ({
      peerId: peer.peer_id,
      name: peer.name,
      publicKey: peer.public_key ?? "",
      publicKeyShort: peer.public_key_short ?? "",
      endpoint: peer.endpoint ?? "N/A",
      allowedIps: peer.allowed_ips ?? "",
      keepalive: peer.keepalive ?? "off",
      rxHuman: peer.rx_human ?? "0 B",
      txHuman: peer.tx_human ?? "0 B",
      handshakeAgo: peer.handshake_ago ?? "Never",
      online: Boolean(peer.online),
      seenBefore: Boolean(peer.seen_before),
      disabled: Boolean(peer.disabled),
      blockedUntil: peer.blocked_until,
      blockedUntilHuman: peer.blocked_until_human ?? ""
    })),
    generatedPeer: payload.generated_peer
      ? {
          name: payload.generated_peer.name,
          address: payload.generated_peer.address,
          publicKey: payload.generated_peer.public_key,
          peerId: payload.generated_peer.peer_id,
          clientConfig: payload.generated_peer.client_config
        }
      : null,
    generatedConfigs: (payload.generated_configs ?? []).map((item: any) => ({
      name: item.name,
      address: item.address,
      publicKey: item.public_key,
      peerId: item.peer_id,
      clientConfig: item.client_config
    })),
    analytics: payload.analytics ?? [],
    configText: payload.config_text ?? "",
    configPath: payload.config_path ?? config.vpnConfigPath,
    generatedAt: payload.generated_at ?? new Date().toLocaleString(),
    backups: (payload.backups ?? []).map((item: any) => ({ path: item.path, createdAt: item.created_at ?? item.createdAt ?? "" })),
    system: payload.system ? { hostname: payload.system.hostname ?? "Unknown", uptime: payload.system.uptime ?? "unknown" } : undefined,
    error: payload.error ?? undefined
  };
}

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

async function generateKeyMaterial() {
  const privateKey = await runCommand(["wg", "genkey"]);
  const publicKey = await runCommand(["wg", "pubkey"], `${privateKey}\n`);
  const presharedKey = await runCommand(["wg", "genpsk"]);
  return { privateKey, publicKey, presharedKey };
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
  if (useRemoteBackend()) {
    return normalizeRemoteDashboard(await remoteJson<any>("/api/agent/dashboard"));
  }
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
    const seenBefore = peer.handshakeEpoch > 0;
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
      seenBefore,
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
      seenBefore: false,
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

export async function saveVpnSettings(payload: { endpoint: string; dns: string; allowedIps: string; refreshSeconds: number }) {
  if (useRemoteBackend()) {
    await remoteRequest("/api/agent/settings", { method: "POST", body: JSON.stringify(payload) });
    return;
  }
  const state = readVpnState();
  state.uiSettings = payload;
  saveVpnState(state);
}

export async function performVpnInterfaceAction(action: "start" | "stop" | "restart" | "reload" | "save") {
  if (useRemoteBackend()) {
    await remoteRequest(`/api/agent/interface/${action}`, { method: "POST" });
    return;
  }
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
  if (action === "save") await runCommand(["wg-quick", "save", config.vpnInterface]);
}

export async function createVpnPeer(payload: { name: string; address: string; dns: string; allowedIps: string; endpoint: string; keepalive: string }) {
  if (useRemoteBackend()) {
    return remoteJson<{ name: string; address: string; publicKey: string; peerId: string; clientConfig: string }>("/api/agent/peers", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
  const state = readVpnState();
  const { interfaceConfig, peers, text } = parseConfig();
  if (!text) throw new Error(`WireGuard config not found at ${config.vpnConfigPath}`);
  const address = payload.address || nextAvailableIp(interfaceConfig.Address || "", peers);
  if (!address) throw new Error("Could not infer next available client address.");
  const { privateKey, publicKey, presharedKey } = await generateKeyMaterial();
  const runtimePublicKey = (await interfaceIsUp()) ? (await parseDump()).interfaceData.publicKey : "";
  const block = `\n[Peer]\n# Name: ${payload.name}\nPublicKey = ${publicKey}\nPresharedKey = ${presharedKey}\nAllowedIPs = ${address}\nPersistentKeepalive = ${payload.keepalive}\n`;
  writeConfigText(`${text.trim()}\n${block}`);
  if (await interfaceIsUp()) {
    await runCommand(["wg", "set", config.vpnInterface, "peer", publicKey, "preshared-key", "/dev/stdin", "allowed-ips", address], `${presharedKey}\n`);
  }
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

export async function saveVpnConfig(text: string) {
  if (useRemoteBackend()) {
    await remoteRequest("/api/agent/config", { method: "POST", body: JSON.stringify({ configText: text }) });
    return;
  }
  const current = readConfigText();
  if (!current) throw new Error(`WireGuard config not found at ${config.vpnConfigPath}`);
  backupVpnConfig();
  writeConfigText(text);
}

export async function getVpnBackups() {
  if (useRemoteBackend()) {
    return remoteJson<Array<{ path: string; createdAt: string }>>("/api/agent/backups");
  }
  return readVpnState().backups ?? [];
}

export async function getVpnSystemInfo() {
  if (useRemoteBackend()) {
    return remoteJson<{ hostname: string; uptime: number }>("/api/agent/system");
  }
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

export async function deleteVpnPeer(peerId: string) {
  if (useRemoteBackend()) {
    await remoteRequest(`/api/agent/peers/${peerId}`, { method: "DELETE" });
    return;
  }
  const peerKey = findPeerKeyById(peerId);
  removeVpnPeerFromConfig(peerKey);
  const state = readVpnState();
  delete state.deviceNames?.[peerKey];
  delete state.generatedConfigs?.[peerKey];
  saveVpnState(state);
}

export async function renameVpnPeer(peerId: string, name: string) {
  if (useRemoteBackend()) {
    await remoteRequest(`/api/agent/peers/${peerId}/rename`, { method: "POST", body: JSON.stringify({ name }) });
    return;
  }
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

export async function updateVpnPeer(peerId: string, allowedIps: string, keepalive: string) {
  if (useRemoteBackend()) {
    await remoteRequest(`/api/agent/peers/${peerId}/update`, { method: "POST", body: JSON.stringify({ allowedIps, keepalive }) });
    return;
  }
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

export async function disableVpnPeer(peerId: string, minutes = 0) {
  if (useRemoteBackend()) {
    const suffix = minutes > 0 ? "/block" : "/disable";
    const body = minutes > 0 ? JSON.stringify({ minutes }) : undefined;
    await remoteRequest(`/api/agent/peers/${peerId}${suffix}`, { method: "POST", body });
    return;
  }
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

export async function enableVpnPeer(peerId: string) {
  if (useRemoteBackend()) {
    await remoteRequest(`/api/agent/peers/${peerId}/enable`, { method: "POST" });
    return;
  }
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
  if (useRemoteBackend()) {
    await remoteRequest(`/api/agent/peers/${peerId}/reconnect`, { method: "POST" });
    return;
  }
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

export async function createVpnBackup() {
  if (useRemoteBackend()) {
    return remoteJson<{ path: string }>("/api/agent/backups", { method: "POST" });
  }
  return backupVpnConfig();
}

export async function restoreVpnBackup(backupPath: string) {
  if (useRemoteBackend()) {
    await remoteRequest("/api/agent/backups/restore", { method: "POST", body: JSON.stringify({ path: backupPath }) });
    return;
  }
  if (!fs.existsSync(backupPath)) throw new Error("Backup file not found.");
  const text = fs.readFileSync(backupPath, "utf8");
  backupVpnConfig();
  writeConfigText(text);
}

export async function downloadGeneratedVpnConfig(peerId: string) {
  if (useRemoteBackend()) {
    const response = await remoteRequest(`/api/agent/clients/${peerId}/download`);
    const clientConfig = await response.text();
    const contentDisposition = response.headers.get("content-disposition") ?? "";
    const match = contentDisposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] ?? `${peerId}.conf`;
    return { name: filename.replace(/\.conf$/i, ""), clientConfig };
  }
  const state = readVpnState();
  const item = Object.values(state.generatedConfigs ?? {}).find((entry) => entry.peerId === peerId);
  if (!item) throw new Error("Generated config not found");
  return item;
}
