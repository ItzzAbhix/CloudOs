import { FormEvent, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

type User = { id: string; username: string; role: "admin" | "user" };
type Overview = {
  stats: { cpuPercent: number; memoryUsedMb: number; memoryTotalMb: number; uptimeSeconds: number; host: string };
  counters: Record<string, number>;
  recentAudit: Array<{ id: string; type: string; message: string; createdAt: string }>;
};
type Service = { id: string; name: string; category: string; description: string; port?: number; actions: string[]; runtimeStatus: string };
type Device = { id: string; name: string; status: string; ipAddress: string; lastSeenAt: string; usageMb: number; killSwitchEnabled: boolean };
type FileEntry = { name: string; path: string; type: string; size: number; updatedAt: string };
type Download = { id: string; url: string; status: string; progress: number; targetPath: string; updatedAt: string };
type Media = { id: string; title: string; type: string; subtitleCount: number };
type Workflow = { id: string; name: string; trigger?: string; condition?: string; action: string };
type NotificationTarget = { id: string; name: string; type: string; endpoint: string };
type Analytics = {
  bandwidthByDevice: Array<{ name: string; usageMb: number }>;
  downloadsByStatus: Array<{ status: string; count: number }>;
  auditTimeline: Array<{ id: string; message: string; actor: string }>;
};
type VpnDashboard = {
  interface: { name: string; up: boolean; publicKeyShort: string; listenPort: string; addresses: string; endpointHint: string; configAccessible?: boolean };
  stats: { totalPeers: number; onlinePeers: number; totalRx: string; totalTx: string; latestHandshake: string; nextIp: string; pool: string; disabledPeers: number };
  defaults: { endpoint?: string; dns: string; allowedIps: string; refreshSeconds: number };
  peers: Array<{ peerId: string; name: string; publicKeyShort?: string; endpoint: string; allowedIps: string; keepalive?: string; handshakeAgo: string; rxHuman: string; txHuman: string; online: boolean; seenBefore?: boolean; disabled: boolean; blockedUntilHuman?: string }>;
  generatedPeer: null | { name: string; address: string; publicKey: string; peerId: string; clientConfig: string };
  generatedConfigs: Array<{ name: string; address: string; publicKey: string; peerId: string; clientConfig: string }>;
  analytics?: Array<{ timestamp: number; onlinePeers: number; rxBytes: number; txBytes: number }>;
  configText: string;
  configPath: string;
  generatedAt: string;
  backups?: Array<{ path: string; createdAt: string }>;
  system?: { hostname: string; uptime: string | number };
  error?: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init
  });
  if (!response.ok) throw new Error(await response.text());
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function parseHumanBytes(value: string) {
  const match = value.trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "B").toUpperCase();
  const factors: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return amount * (factors[unit] ?? 1);
}

const navItems = [
  ["overview", "Overview"],
  ["services", "Services"],
  ["vpn", "VPN"],
  ["files", "Files"],
  ["downloads", "Downloads"],
  ["media", "Media"],
  ["automation", "Automation"],
  ["notifications", "Notifications"],
  ["analytics", "Analytics"],
  ["security", "Security"],
  ["sharing", "Sharing"],
  ["scripts", "Scripts"],
  ["games", "Games"]
] as const;

function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("cloudosadmin");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api<{ user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      onLogin(result.user);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to log in");
    }
  }

  return (
    <div className="login-shell">
      <div className="login-panel">
        <section className="login-showcase">
          <p className="eyebrow">CloudOS</p>
          <h1>Private infrastructure cockpit.</h1>
          <p>One dashboard for VM health, VPN devices, automation, downloads, logs, files, and media.</p>
          <div className="showcase-grid">
            <div className="promo lilac"><span>Runtime</span><strong>Live</strong></div>
            <div className="promo blue"><span>Network</span><strong>Private</strong></div>
            <div className="promo mint"><span>Automation</span><strong>Ready</strong></div>
          </div>
        </section>
        <form className="login-card" onSubmit={handleSubmit}>
          <p className="eyebrow">Sign In</p>
          <h2>Enter Dashboard</h2>
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit">Launch CloudOS</button>
        </form>
      </div>
    </div>
  );
}

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<(typeof navItems)[number][0]>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [files, setFiles] = useState<{ currentPath: string; entries: FileEntry[] } | null>(null);
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [rules, setRules] = useState<Workflow[]>([]);
  const [notifications, setNotifications] = useState<NotificationTarget[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [vpn, setVpn] = useState<VpnDashboard | null>(null);
  const [networkEvents, setNetworkEvents] = useState<Array<{ id: string; source: string; message: string; severity: string }>>([]);
  const [shareLinks, setShareLinks] = useState<Array<{ id: string; path: string; expiresAt?: string }>>([]);
  const [scripts, setScripts] = useState<Array<{ id: string; name: string; command: string; description: string }>>([]);
  const [logs, setLogs] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [sharePath, setSharePath] = useState("");
  const [sharePassword, setSharePassword] = useState("");
  const [vpnProvision, setVpnProvision] = useState({ name: "", address: "", dns: "", allowedIps: "", endpoint: "", keepalive: "25" });
  const [vpnDefaults, setVpnDefaults] = useState({ endpoint: "", dns: "", allowedIps: "", refreshSeconds: "10" });
  const [vpnConfigText, setVpnConfigText] = useState("");
  const [vpnMessage, setVpnMessage] = useState("");
  const [vpnPeerSearch, setVpnPeerSearch] = useState("");

  async function refresh() {
    const [
      overviewResult,
      servicesResult,
      devicesResult,
      filesResult,
      downloadsResult,
      mediaResult,
      workflowsResult,
      rulesResult,
      notificationsResult,
      analyticsResult,
      vpnResult,
      networkResult,
      shareResult,
      scriptsResult
    ] = await Promise.all([
      api<Overview>("/overview"),
      api<Service[]>("/services"),
      api<Device[]>("/devices"),
      api<{ currentPath: string; entries: FileEntry[] }>("/files"),
      api<Download[]>("/downloads"),
      api<Media[]>("/media"),
      api<Workflow[]>("/automation/workflows"),
      api<Workflow[]>("/automation/rules"),
      api<NotificationTarget[]>("/notifications"),
      api<Analytics>("/analytics"),
      api<VpnDashboard>("/vpn/dashboard"),
      api<Array<{ id: string; source: string; message: string; severity: string }>>("/security/network"),
      api<Array<{ id: string; path: string; expiresAt?: string }>>("/sharing"),
      api<Array<{ id: string; name: string; command: string; description: string }>>("/scripts")
    ]);
    setOverview(overviewResult);
    setServices(servicesResult);
    setDevices(devicesResult);
    setFiles(filesResult);
    setDownloads(downloadsResult);
    setMedia(mediaResult);
    setWorkflows(workflowsResult);
    setRules(rulesResult);
    setNotifications(notificationsResult);
    setAnalytics(analyticsResult);
    setVpn(vpnResult);
    setVpnDefaults({
      endpoint: vpnResult.defaults.endpoint ?? vpnResult.interface.endpointHint ?? "",
      dns: vpnResult.defaults.dns ?? "",
      allowedIps: vpnResult.defaults.allowedIps ?? "",
      refreshSeconds: String(vpnResult.defaults.refreshSeconds ?? 10)
    } as never);
    setVpnProvision((current) => ({
      name: current.name,
      address: current.address || vpnResult.stats.nextIp || "",
      dns: current.dns || vpnResult.defaults.dns || "",
      allowedIps: current.allowedIps || vpnResult.defaults.allowedIps || "",
      endpoint: current.endpoint || vpnResult.interface.endpointHint || "",
      keepalive: current.keepalive || "25"
    }));
    setVpnConfigText(vpnResult.configText ?? "");
    setNetworkEvents(networkResult);
    setShareLinks(shareResult);
    setScripts(scriptsResult);
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const headlineCards = useMemo(
    () =>
      overview
        ? [
            ["Services Online", `${overview.counters.servicesOnline}/${overview.counters.services}`, "peach"],
            ["Connected Devices", `${overview.counters.devices}`, "blue"],
            ["Automation Flows", `${overview.counters.workflows}`, "mint"],
            ["Active Downloads", `${overview.counters.activeDownloads}`, "lilac"]
          ]
        : [],
    [overview]
  );

  const vpnAnalyticsView = useMemo(() => {
    const points = (vpn?.analytics ?? [])
      .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.rxBytes) && Number.isFinite(point.txBytes))
      .slice(-8);
    if (!points.length) return null;
    const rxMax = Math.max(...points.map((point) => point.rxBytes), 1);
    const txMax = Math.max(...points.map((point) => point.txBytes), 1);
    const latest = points[points.length - 1]!;
    const line = (source: "rxBytes" | "txBytes", max: number) =>
      points
        .map((point, index) => {
          const x = points.length === 1 ? 20 : 20 + (index * 340) / (points.length - 1);
          const y = 160 - (point[source] / max) * 120;
          return `${x},${Math.max(26, Math.min(160, y))}`;
        })
        .join(" ");
    return {
      latestRxMb: (latest.rxBytes / (1024 * 1024)).toFixed(1),
      latestTxMb: (latest.txBytes / (1024 * 1024)).toFixed(1),
      rxPoints: line("rxBytes", rxMax),
      txPoints: line("txBytes", txMax),
      labels: points.map((point, index) => ({
        x: points.length === 1 ? 20 : 20 + (index * 340) / (points.length - 1),
        label: new Date(point.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      }))
    };
  }, [vpn]);

  const vpnPeerStats = useMemo(() => {
    const peers = vpn?.peers ?? [];
    return {
      online: peers.filter((peer) => peer.online).length,
      offline: peers.filter((peer) => !peer.online && peer.seenBefore).length,
      neverConnected: peers.filter((peer) => !peer.online && !peer.seenBefore).length,
      disabled: peers.filter((peer) => peer.disabled).length,
      protection: peers.length ? Math.round((peers.filter((peer) => peer.online).length / peers.length) * 100) : 0
    };
  }, [vpn]);

  const filteredVpnPeers = useMemo(() => {
    const peers = vpn?.peers ?? [];
    const query = vpnPeerSearch.trim().toLowerCase();
    if (!query) return peers;
    return peers.filter((peer) =>
      [peer.name, peer.publicKeyShort ?? "", peer.endpoint, peer.allowedIps].join(" ").toLowerCase().includes(query)
    );
  }, [vpn, vpnPeerSearch]);

  const vpnDeviceUsage = useMemo(() => {
    const peers = (vpn?.peers ?? []).map((peer) => {
      const rxBytes = parseHumanBytes(peer.rxHuman);
      const txBytes = parseHumanBytes(peer.txHuman);
      return {
        ...peer,
        totalBytes: rxBytes + txBytes,
        totalHuman: `${peer.rxHuman} / ${peer.txHuman}`
      };
    });
    const max = Math.max(...peers.map((peer) => peer.totalBytes), 1);
    return peers
      .sort((left, right) => right.totalBytes - left.totalBytes)
      .map((peer) => ({ ...peer, usagePercent: Math.max(8, Math.round((peer.totalBytes / max) * 100)) }));
  }, [vpn]);

  function jumpVpn(sectionId: string) {
    const target = document.getElementById(sectionId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function serviceAction(id: string, action: "restart") {
    await api(`/services/${id}/action`, { method: "POST", body: JSON.stringify({ action }) });
    await refresh();
  }

  async function showLogs(id: string) {
    const result = await api<{ logs: string }>(`/services/${id}/logs`);
    setLogs(result.logs);
  }

  async function toggleDevice(id: string) {
    await api(`/devices/${id}/toggle`, { method: "PATCH" });
    await refresh();
  }

  async function createDownload(event: FormEvent) {
    event.preventDefault();
    if (!downloadUrl) return;
    await api("/downloads", { method: "POST", body: JSON.stringify({ url: downloadUrl }) });
    setDownloadUrl("");
    await refresh();
  }

  async function createFolderAction(event: FormEvent) {
    event.preventDefault();
    if (!files?.currentPath || !newFolderName) return;
    await api("/files/folders", {
      method: "POST",
      body: JSON.stringify({ parentPath: files.currentPath, name: newFolderName })
    });
    setNewFolderName("");
    await refresh();
  }

  async function deletePathAction(targetPath: string) {
    await api("/files", { method: "DELETE", body: JSON.stringify({ targetPath }) });
    await refresh();
  }

  async function createShareAction(event: FormEvent) {
    event.preventDefault();
    if (!sharePath) return;
    await api("/sharing", {
      method: "POST",
      body: JSON.stringify({ path: sharePath, password: sharePassword || undefined })
    });
    setSharePath("");
    setSharePassword("");
    await refresh();
  }

  async function retryDownloadAction(id: string) {
    await api(`/downloads/${id}/retry`, { method: "POST" });
    await refresh();
  }

  async function deleteDownloadAction(id: string) {
    await api(`/downloads/${id}`, { method: "DELETE" });
    await refresh();
  }

  async function runScript(command: string) {
    const result = await api<{ stdout: string; stderr: string; error?: string }>("/scripts/run", {
      method: "POST",
      body: JSON.stringify({ command })
    });
    setLogs([result.stdout, result.stderr, result.error].filter(Boolean).join("\n"));
  }

  async function scanMedia() {
    await api("/media/scan", { method: "POST" });
    await refresh();
  }

  async function vpnInterfaceAction(action: "start" | "stop" | "restart" | "reload" | "save") {
    await api(`/vpn/interface/${action}`, { method: "POST" });
    setVpnMessage(`VPN action executed: ${action}`);
    await refresh();
  }

  async function saveVpnDefaults(event: FormEvent) {
    event.preventDefault();
    await api("/vpn/settings", {
      method: "POST",
      body: JSON.stringify({
        endpoint: vpnDefaults.endpoint,
        dns: vpnDefaults.dns,
        allowedIps: vpnDefaults.allowedIps,
        refreshSeconds: Number(vpnDefaults.refreshSeconds || 10)
      })
    });
    setVpnMessage("VPN defaults updated.");
    await refresh();
  }

  async function provisionVpnPeer(event: FormEvent) {
    event.preventDefault();
    await api("/vpn/peers", {
      method: "POST",
      body: JSON.stringify(vpnProvision)
    });
    setVpnMessage(`Created VPN peer ${vpnProvision.name}.`);
    setActiveTab("vpn");
    await refresh();
  }

  async function persistVpnConfig(applyNow = false) {
    await api("/vpn/config", {
      method: "POST",
      body: JSON.stringify({ configText: vpnConfigText })
    });
    if (applyNow) {
      await api("/vpn/interface/reload", { method: "POST" });
      setVpnMessage("VPN config saved and applied.");
    } else {
      setVpnMessage("VPN config saved.");
    }
    await refresh();
  }

  async function saveVpnConfig(event: FormEvent) {
    event.preventDefault();
    await persistVpnConfig(false);
  }

  async function vpnPeerAction(peerId: string, action: "disable" | "enable" | "reconnect" | "delete") {
    const path = action === "delete" ? `/vpn/peers/${peerId}` : `/vpn/peers/${peerId}/${action}`;
    await api(path, { method: action === "delete" ? "DELETE" : "POST" });
    setVpnMessage(`VPN peer action executed: ${action}`);
    await refresh();
  }

  async function renameVpnPeerAction(peerId: string, currentName: string) {
    const name = window.prompt("Rename peer", currentName);
    if (!name) return;
    await api(`/vpn/peers/${peerId}/rename`, { method: "POST", body: JSON.stringify({ name }) });
    setVpnMessage(`Renamed ${currentName} to ${name}.`);
    await refresh();
  }

  async function updateVpnPeerAction(peerId: string, currentAllowedIps: string) {
    const allowedIps = window.prompt("Update AllowedIPs", currentAllowedIps);
    if (!allowedIps) return;
    const keepalive = window.prompt("PersistentKeepalive", "25") ?? "";
    await api(`/vpn/peers/${peerId}/update`, { method: "POST", body: JSON.stringify({ allowedIps, keepalive }) });
    setVpnMessage("Updated peer routing.");
    await refresh();
  }

  async function blockVpnPeerAction(peerId: string) {
    const raw = window.prompt("Block peer for how many minutes?", "30");
    if (!raw) return;
    await api(`/vpn/peers/${peerId}/block`, { method: "POST", body: JSON.stringify({ minutes: Number(raw) || 30 }) });
    setVpnMessage(`Blocked peer for ${raw} minutes.`);
    await refresh();
  }

  async function createVpnBackupAction() {
    await api("/vpn/backups", { method: "POST" });
    setVpnMessage("VPN backup created.");
    await refresh();
  }

  async function restoreVpnBackupAction(path: string) {
    await api("/vpn/backups/restore", { method: "POST", body: JSON.stringify({ path }) });
    setVpnMessage(`Restored backup ${path}.`);
    await refresh();
  }

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    onLogout();
  }

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand-box">
          <div className="brand-mark">C</div>
          <div>
            <strong>CloudOS</strong>
            <p>Master control panel</p>
          </div>
        </div>
        <div className="profile-card">
          <div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{user.username}</strong>
            <p>{user.role}</p>
          </div>
        </div>
        <nav className="side-nav">
          {navItems.map(([id, label]) => (
            <button key={id} className={activeTab === id ? "side-link active" : "side-link"} onClick={() => setActiveTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <button className="logout-button" onClick={logout}>
          Log out
        </button>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Master Layer</p>
            <h1>Private infrastructure cockpit</h1>
            <p className="subcopy">A lighter control room inspired by analytics dashboards and smart-home panels.</p>
          </div>
          {overview ? (
            <div className="chip-row">
              <div className="metric-chip">CPU {overview.stats.cpuPercent}%</div>
              <div className="metric-chip">RAM {overview.stats.memoryUsedMb}/{overview.stats.memoryTotalMb} MB</div>
              <div className="metric-chip">Host {overview.stats.host}</div>
            </div>
          ) : null}
        </header>

        <section className="headline-grid">
          {headlineCards.map(([title, value, tone]) => (
            <div key={title} className={`headline-card ${tone}`}>
              <span>{title}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>

        {activeTab === "overview" && overview ? (
          <section className="content-grid">
            <Panel title="System Health">
              <Row label="Uptime" value={`${Math.floor(overview.stats.uptimeSeconds / 3600)}h`} />
              <Row label="Services" value={`${overview.counters.servicesOnline}/${overview.counters.services}`} />
              <Row label="Devices" value={`${overview.counters.devices}`} />
              <Row label="Alerts" value={`${overview.counters.alerts}`} />
            </Panel>
            <Panel title="Quick Actions">
              <div className="button-row">
                <button onClick={() => serviceAction("nginx-proxy-manager", "restart")}>Restart Proxy</button>
                <button onClick={() => serviceAction("n8n", "restart")}>Restart n8n</button>
                <button onClick={() => showLogs("dozzle")}>Read Logs</button>
              </div>
            </Panel>
            <Panel title="Recent Activity" wide>
              <div className="card-grid">
                {overview.recentAudit.map((item) => (
                  <div key={item.id} className="mini-surface">
                    <strong>{item.type}</strong>
                    <p>{item.message}</p>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Bandwidth">
              {(analytics?.bandwidthByDevice ?? []).map((item) => (
                <Bar key={item.name} label={item.name} value={item.usageMb} />
              ))}
            </Panel>
          </section>
        ) : null}

        {activeTab === "services" ? (
          <section className="content-grid">
            <Panel title="Service Grid" wide>
              <div className="card-grid">
                {services.map((service) => (
                  <div key={service.id} className="service-card">
                    <div className="service-top">
                      <div>
                        <strong>{service.name}</strong>
                        <p>{service.description}</p>
                      </div>
                      <span className={`badge ${service.runtimeStatus === "running" ? "good" : "neutral"}`}>{service.runtimeStatus}</span>
                    </div>
                    <small>{service.category} {service.port ? `· :${service.port}` : ""}</small>
                    <div className="button-row">
                      {service.actions.includes("restart") ? <button onClick={() => serviceAction(service.id, "restart")}>Restart</button> : null}
                      <button onClick={() => showLogs(service.id)}>Logs</button>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Logs">
              <pre className="log-screen">{logs || "Select a service to inspect logs."}</pre>
            </Panel>
          </section>
        ) : null}

        {activeTab === "vpn" && vpn ? (
          <section className="vpn-room">
            <div className="vpn-room-main">
              <section className="vpn-room-navbar">
                <div className="vpn-navbar-row vpn-navbar-row-top">
                  <div className="vpn-navbar-brand">
                    <strong>WireOS</strong>
                  <p>{vpn.interface.name} · {vpn.configPath}</p>
                </div>
                </div>
                <div className="vpn-navbar-row vpn-navbar-row-bottom">
                  <nav className="vpn-navbar-links">
                  <button className="vpn-navbar-link active" onClick={() => jumpVpn("vpn-overview")}>Overview</button>
                  <button className="vpn-navbar-link" onClick={() => jumpVpn("vpn-provision")}>Provision Client</button>
                  <button className="vpn-navbar-link" onClick={() => jumpVpn("vpn-peers")}>Peers</button>
                  <button className="vpn-navbar-link" onClick={() => jumpVpn("vpn-defaults")}>Server Defaults</button>
                  <button className="vpn-navbar-link" onClick={() => jumpVpn("vpn-config")}>Config Editor</button>
                </nav>
                <div className="vpn-navbar-meta">
                  <div className="vpn-top-actions vpn-top-actions-navbar">
                    <button className="alt-button" onClick={() => vpnInterfaceAction("start")}>Start</button>
                    <button className="alt-button" onClick={() => vpnInterfaceAction("stop")}>Stop</button>
                    <button className="alt-button" onClick={() => vpnInterfaceAction("restart")}>Restart</button>
                    <button className="alt-button" onClick={() => vpnInterfaceAction("reload")}>Apply Config</button>
                    <button className="alt-button" onClick={() => vpnInterfaceAction("save")}>Save Runtime</button>
                  </div>
                  <div className="vpn-navbar-stats">
                    <div className="vpn-navbar-chip"><span>Interface</span><strong>{vpn.interface.up ? "Up" : "Down"}</strong></div>
                    <div className="vpn-navbar-chip"><span>Online Peers</span><strong>{vpnPeerStats.online}</strong></div>
                    <div className="vpn-navbar-chip"><span>Latest Sync</span><strong>{vpn.stats.latestHandshake}</strong></div>
                    <div className="vpn-navbar-chip"><span>Host</span><strong>{vpn.system?.hostname ?? "Unknown"}</strong></div>
                  </div>
                </div>
                </div>
              </section>

              <section className="vpn-room-topbar">
                <div>
                  <span className="vpn-top-label">WireGuard Command Center</span>
                  <h2>{vpn.interface.name} Dashboard</h2>
                  <p>Config: {vpn.configPath} · Updated {vpn.generatedAt}</p>
                </div>
                <div className="vpn-top-actions">
                  <button className="alt-button" onClick={() => vpnInterfaceAction("start")}>Start</button>
                  <button className="alt-button" onClick={() => vpnInterfaceAction("stop")}>Stop</button>
                  <button className="alt-button" onClick={() => vpnInterfaceAction("restart")}>Restart</button>
                  <button className="alt-button" onClick={() => vpnInterfaceAction("reload")}>Apply Config</button>
                </div>
              </section>

              {vpnMessage ? <div className="vpn-message">{vpnMessage}</div> : null}
              {vpn.error ? <div className="vpn-error-banner">{vpn.error}</div> : null}

              <div className="vpn-room-grid">
                <section id="vpn-overview" className="vpn-card vpn-card-hero vpn-anchor-card">
                  <div className="vpn-card-gradient">
                    <span>Network posture</span>
                    <h3>{vpn.stats.onlinePeers}/{vpn.stats.totalPeers} peers active</h3>
                    <p>Provision clients, apply runtime changes, edit the server config, and keep common VPN defaults inside the dashboard instead of shell commands.</p>
                    <div className="vpn-hero-stats">
                      <div><span>Rx</span><strong>{vpn.stats.totalRx}</strong></div>
                      <div><span>Tx</span><strong>{vpn.stats.totalTx}</strong></div>
                      <div><span>Pool</span><strong>{vpn.stats.pool || "Not detected"}</strong></div>
                    </div>
                  </div>
                </section>

                <section className="vpn-card vpn-card-protection">
                  <div className="vpn-ring" style={{ ["--vpn-ring" as string]: `${vpnPeerStats.protection}%` }}>
                    <div className="vpn-ring-inner">
                      <span>Protection</span>
                      <strong>{vpnPeerStats.protection}%</strong>
                    </div>
                  </div>
                  <div className="vpn-meta-list">
                    <Row label="Listen Port" value={vpn.interface.listenPort || "N/A"} />
                    <Row label="Latest Handshake" value={vpn.stats.latestHandshake} />
                    <Row label="Addresses" value={vpn.interface.addresses || "N/A"} />
                    <Row label="Server Key" value={vpn.interface.publicKeyShort} />
                  </div>
                </section>

                <section className="vpn-card vpn-card-metrics">
                  <div className="vpn-mini-strip">
                    <div className="vpn-mini-stat"><span>Interface Status</span><strong>{vpn.interface.up ? "Up" : "Down"}</strong></div>
                    <div className="vpn-mini-stat"><span>Configured Peers</span><strong>{vpn.stats.totalPeers}</strong></div>
                    <div className="vpn-mini-stat"><span>Endpoint Hint</span><strong>{vpn.interface.endpointHint || "Unset"}</strong></div>
                    <div className="vpn-mini-stat"><span>Next Client IP</span><strong>{vpn.stats.nextIp || "Manual"}</strong></div>
                  </div>
                </section>

                <section className="vpn-card vpn-card-analytics">
                  <div className="vpn-card-head">
                    <h3>Usage Analytics</h3>
                    <span>24 hour traffic samples</span>
                  </div>
                  <div className="vpn-analytics-top">
                    <div className="vpn-analytics-pill"><strong>{vpnAnalyticsView?.latestRxMb ?? "0.0"} MB</strong><span>Latest Rx sample</span></div>
                    <div className="vpn-analytics-pill"><strong>{vpnAnalyticsView?.latestTxMb ?? "0.0"} MB</strong><span>Latest Tx sample</span></div>
                  </div>
                  <div className="vpn-line-chart">
                    {vpnAnalyticsView ? (
                      <svg viewBox="0 0 380 190" preserveAspectRatio="none">
                        <line x1="20" y1="160" x2="360" y2="160" stroke="#ddd4f8" strokeWidth="2" />
                        <polyline fill="none" stroke="#6f49ff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" points={vpnAnalyticsView.rxPoints} />
                        <polyline fill="none" stroke="#39b6ff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" points={vpnAnalyticsView.txPoints} />
                        {vpnAnalyticsView.labels.map((label) => (
                          <text key={`${label.x}-${label.label}`} x={label.x} y="182" fontSize="10" textAnchor="middle" fill="#7c83a2">
                            {label.label}
                          </text>
                        ))}
                      </svg>
                    ) : (
                      <p className="subcopy">Not enough samples yet.</p>
                    )}
                  </div>
                </section>

                <section className="vpn-card vpn-card-quick">
                  <div className="vpn-card-head">
                    <h3>Quick Actions</h3>
                    <span>Reduce SSH use</span>
                  </div>
                  <div className="vpn-quick-list">
                    <div><strong>Create clients</strong><p>Generate keys, allocate IPs, write config, and get a ready client profile.</p></div>
                    <div><strong>Manage defaults</strong><p>Set endpoint, DNS, allowed routes, and auto-refresh from the UI.</p></div>
                    <div><strong>Live config apply</strong><p>Edit the raw config and apply it to the interface without opening SSH again.</p></div>
                  </div>
                </section>

                <section className="vpn-card vpn-card-device">
                  <div className="vpn-card-head">
                    <h3>Device Analytics</h3>
                    <span>Per device usage</span>
                  </div>
                  <div className="vpn-device-grid">
                    <div><span>Online</span><strong>{vpnPeerStats.online}</strong></div>
                    <div><span>Offline</span><strong>{vpnPeerStats.offline}</strong></div>
                    <div><span>Never Connected</span><strong>{vpnPeerStats.neverConnected}</strong></div>
                    <div><span>Disabled</span><strong>{vpnPeerStats.disabled}</strong></div>
                  </div>
                  <div className="vpn-device-usage-list">
                    {vpnDeviceUsage.map((peer) => (
                      <div key={peer.peerId} className="vpn-device-usage-row">
                        <div className="vpn-device-usage-head">
                          <strong>{peer.name}</strong>
                          <span>{peer.totalHuman}</span>
                        </div>
                        <div className="vpn-device-usage-split">
                          <div className="vpn-device-split-track">
                            <div
                              className="vpn-device-split-fill rx"
                              style={{ width: `${Math.max(6, Math.round((parseHumanBytes(peer.rxHuman) / Math.max(peer.totalBytes, 1)) * 100))}%` }}
                            />
                          </div>
                          <div className="vpn-device-split-track">
                            <div
                              className="vpn-device-split-fill tx"
                              style={{ width: `${Math.max(6, Math.round((parseHumanBytes(peer.txHuman) / Math.max(peer.totalBytes, 1)) * 100))}%` }}
                            />
                          </div>
                        </div>
                        <div className="vpn-device-usage-bar">
                          <div className="vpn-device-usage-fill" style={{ width: `${peer.usagePercent}%` }} />
                        </div>
                        <div className="vpn-device-usage-meta">
                          <span>Rx {peer.rxHuman}</span>
                          <span>Tx {peer.txHuman}</span>
                          <span>{peer.online ? "Online" : peer.seenBefore ? "Offline" : "Never connected"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section id="vpn-provision" className="vpn-card vpn-card-provision vpn-anchor-card">
                  <div className="vpn-card-head">
                    <h3>Provision Client</h3>
                    <span>Create and ship a new peer</span>
                  </div>
                  <form className="vpn-form-grid" onSubmit={provisionVpnPeer}>
                    <input value={vpnProvision.name} onChange={(event) => setVpnProvision((current) => ({ ...current, name: event.target.value }))} placeholder="Client name" required />
                    <input value={vpnProvision.address} onChange={(event) => setVpnProvision((current) => ({ ...current, address: event.target.value }))} placeholder="Client address, e.g. 10.0.0.2/32" />
                    <input value={vpnProvision.dns} onChange={(event) => setVpnProvision((current) => ({ ...current, dns: event.target.value }))} placeholder="DNS servers" />
                    <input value={vpnProvision.allowedIps} onChange={(event) => setVpnProvision((current) => ({ ...current, allowedIps: event.target.value }))} placeholder="Allowed IPs" />
                    <input value={vpnProvision.endpoint} onChange={(event) => setVpnProvision((current) => ({ ...current, endpoint: event.target.value }))} placeholder="Server endpoint host:port" />
                    <input value={vpnProvision.keepalive} onChange={(event) => setVpnProvision((current) => ({ ...current, keepalive: event.target.value }))} placeholder="PersistentKeepalive" />
                    <button type="submit" className="vpn-primary-button">Create Client</button>
                  </form>
                </section>

                <section className="vpn-card vpn-card-generated">
                  <div className="vpn-card-head">
                    <h3>Latest Generated Client</h3>
                    <span>Copy into WireGuard app</span>
                  </div>
                  {vpn.generatedPeer ? (
                    <div className="vpn-generated-body">
                      <Row label="Name" value={vpn.generatedPeer.name} />
                      <Row label="Address" value={vpn.generatedPeer.address} />
                      <Row label="Public Key" value={vpn.generatedPeer.publicKey} />
                      <a className="download-link" href={`/api/vpn/clients/${vpn.generatedPeer.peerId}/download`} target="_blank" rel="noreferrer">
                        Download .conf
                      </a>
                      <textarea className="config-editor compact-editor" readOnly value={vpn.generatedPeer.clientConfig} />
                    </div>
                  ) : (
                    <p className="subcopy">No generated client yet.</p>
                  )}
                </section>

                <section id="vpn-defaults" className="vpn-card vpn-card-defaults vpn-anchor-card">
                  <div className="vpn-card-head">
                    <h3>Server Defaults</h3>
                    <span>Used for new client profiles</span>
                  </div>
                  <form className="vpn-form-stack" onSubmit={saveVpnDefaults}>
                    <input value={vpnDefaults.endpoint} onChange={(event) => setVpnDefaults((current) => ({ ...current, endpoint: event.target.value }))} placeholder="Public endpoint host:port" />
                    <input value={vpnDefaults.dns} onChange={(event) => setVpnDefaults((current) => ({ ...current, dns: event.target.value }))} placeholder="DNS servers" />
                    <input value={vpnDefaults.allowedIps} onChange={(event) => setVpnDefaults((current) => ({ ...current, allowedIps: event.target.value }))} placeholder="Allowed IPs" />
                    <input value={vpnDefaults.refreshSeconds} onChange={(event) => setVpnDefaults((current) => ({ ...current, refreshSeconds: event.target.value }))} placeholder="Refresh seconds" />
                    <button type="submit" className="vpn-primary-button">Save Dashboard Defaults</button>
                  </form>
                </section>

                <section className="vpn-card vpn-card-recent">
                  <div className="vpn-card-head">
                    <h3>Recent Client Profiles</h3>
                    <span>Reopen generated configs</span>
                  </div>
                  <div className="vpn-recent-list">
                    {vpn.generatedConfigs.slice(0, 3).map((item) => (
                      <div key={item.peerId} className="vpn-recent-item">
                        <strong>{item.name}</strong>
                        <p>{item.address}</p>
                        <a className="download-link" href={`/api/vpn/clients/${item.peerId}/download`} target="_blank" rel="noreferrer">
                          Download
                        </a>
                      </div>
                    ))}
                    {!vpn.generatedConfigs.length ? <p className="subcopy">Generated config will appear here after you create clients.</p> : null}
                  </div>
                </section>

                <section className="vpn-card vpn-card-config-left">
                  <div className="vpn-card-head">
                    <h3>Config Editor</h3>
                    <span>Edit raw server config safely</span>
                  </div>
                  <div className="vpn-quick-list">
                    <div><strong>Backups on every save</strong><p>Each write creates a timestamped backup before replacing the current file.</p></div>
                    <div><strong>Apply without SSH</strong><p>Save and push the current config into the live interface from this page.</p></div>
                    <div><strong>Save runtime to disk</strong><p>Use the button below to persist live peer changes back to the config file.</p></div>
                  </div>
                  <div className="vpn-config-actions">
                    <button onClick={() => vpnInterfaceAction("save")}>Save Runtime To Config</button>
                    <button onClick={() => vpnInterfaceAction("reload")}>Apply Current Config</button>
                    <button onClick={() => vpnInterfaceAction("restart")}>Restart Interface</button>
                    <button onClick={createVpnBackupAction}>Create Backup</button>
                  </div>
                  <div className="vpn-backup-list">
                    {(vpn.backups ?? []).map((backup) => (
                      <div key={backup.path} className="vpn-backup-row">
                        <div>
                          <strong>{backup.createdAt}</strong>
                          <p>{backup.path}</p>
                        </div>
                        <button onClick={() => restoreVpnBackupAction(backup.path)}>Restore</button>
                      </div>
                    ))}
                    {!(vpn.backups ?? []).length ? <p className="subcopy">No backups created yet.</p> : null}
                  </div>
                </section>

                <section id="vpn-config" className="vpn-card vpn-card-config-right vpn-anchor-card">
                  <form className="vpn-form-stack" onSubmit={saveVpnConfig}>
                    <textarea className="config-editor vpn-editor-large" value={vpnConfigText} onChange={(event) => setVpnConfigText(event.target.value)} />
                    <div className="button-row">
                      <button type="submit">Save Config File</button>
                      <button type="button" onClick={() => void persistVpnConfig(true)}>Save And Apply</button>
                    </div>
                  </form>
                </section>

                <section id="vpn-peers" className="vpn-card vpn-card-peers vpn-anchor-card">
                  <div className="vpn-card-head">
                    <h3>Peer Inventory</h3>
                    <span>Rename, inspect, and remove peers</span>
                  </div>
                  <input value={vpnPeerSearch} onChange={(event) => setVpnPeerSearch(event.target.value)} placeholder="Search peers by name, key, endpoint, or IP" />
                  <div className="vpn-peer-grid">
                    {filteredVpnPeers.map((peer) => (
                      <div key={peer.peerId} className="vpn-peer-card">
                        <div className="vpn-peer-head">
                          <div>
                            <strong>{peer.name}</strong>
                            <span className={`badge ${peer.online ? "good" : peer.seenBefore ? "warn" : "bad"}`}>
                              {peer.online ? "Online" : peer.seenBefore ? "Seen Before" : "Never Connected"}
                            </span>
                          </div>
                          <button className="small-button" onClick={() => vpnPeerAction(peer.peerId, "delete")}>Remove</button>
                        </div>
                        <Row label="Public Key" value={peer.publicKeyShort ?? "N/A"} />
                        <Row label="Allowed IPs" value={peer.allowedIps} />
                        <Row label="Endpoint" value={peer.endpoint || "N/A"} />
                        <Row label="Handshake" value={peer.handshakeAgo} />
                        <Row label="Transfer" value={`${peer.rxHuman} down / ${peer.txHuman} up`} />
                        <Row label="Keepalive" value={peer.keepalive || "off"} />
                        {peer.blockedUntilHuman ? <Row label="Blocked Until" value={peer.blockedUntilHuman} /> : null}
                        <div className="vpn-peer-tools">
                          <button className="small-button" onClick={() => renameVpnPeerAction(peer.peerId, peer.name)}>Rename</button>
                          <button className="small-button" onClick={() => updateVpnPeerAction(peer.peerId, peer.allowedIps)}>Update Routes</button>
                        </div>
                        <div className="vpn-peer-tools">
                          {peer.disabled ? (
                            <button className="small-button" onClick={() => vpnPeerAction(peer.peerId, "enable")}>Enable</button>
                          ) : (
                            <>
                              <button className="small-button" onClick={() => vpnPeerAction(peer.peerId, "disable")}>Disable</button>
                              <button className="small-button" onClick={() => vpnPeerAction(peer.peerId, "reconnect")}>Force Reconnect</button>
                              <button className="small-button" onClick={() => blockVpnPeerAction(peer.peerId)}>Block</button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "files" ? (
          <section className="content-grid">
            <Panel title={`Files · ${files?.currentPath ?? ""}`} wide>
              <form className="stack compact-stack" onSubmit={createFolderAction}>
                <input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder="Create new folder" />
                <button type="submit">Create Folder</button>
              </form>
              <div className="list-grid">
                {files?.entries.map((entry) => (
                  <div key={entry.path} className="list-row">
                    <div><strong>{entry.name}</strong><p>{entry.path}</p></div>
                    <span>{entry.type}</span>
                    <span>{entry.size} B</span>
                    <button onClick={() => deletePathAction(entry.path)}>Delete</button>
                  </div>
                ))}
              </div>
            </Panel>
          </section>
        ) : null}

        {activeTab === "downloads" ? (
          <section className="content-grid">
            <Panel title="Queue Download">
              <form className="stack" onSubmit={createDownload}>
                <input value={downloadUrl} onChange={(event) => setDownloadUrl(event.target.value)} placeholder="https://example.com/archive.zip" />
                <button type="submit">Queue</button>
              </form>
            </Panel>
            <Panel title="Jobs" wide>
              <div className="list-grid">
                {downloads.map((download) => (
                  <div key={download.id} className="list-row">
                    <div><strong>{download.status}</strong><p>{download.url}</p></div>
                    <span>{download.progress}%</span>
                    <span>{download.targetPath}</span>
                    <div className="button-row compact-actions">
                      <button onClick={() => retryDownloadAction(download.id)}>Retry</button>
                      <button onClick={() => deleteDownloadAction(download.id)}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </section>
        ) : null}

        {activeTab === "media" ? (
          <section className="content-grid">
            <Panel title="Library">
              <div className="button-row"><button onClick={scanMedia}>Rescan</button></div>
              {media.map((item) => <Row key={item.id} label={item.title} value={`${item.type} · ${item.subtitleCount} subtitles`} />)}
            </Panel>
          </section>
        ) : null}

        {activeTab === "automation" ? (
          <section className="content-grid">
            <Panel title="Workflows">{workflows.map((item) => <Row key={item.id} label={item.name} value={item.trigger ?? item.action} />)}</Panel>
            <Panel title="Rules">{rules.map((item) => <Row key={item.id} label={item.name} value={item.condition ?? item.action} />)}</Panel>
          </section>
        ) : null}

        {activeTab === "notifications" ? (
          <section className="content-grid">
            <Panel title="Targets">{notifications.map((item) => <Row key={item.id} label={item.name} value={`${item.type} · ${item.endpoint}`} />)}</Panel>
          </section>
        ) : null}

        {activeTab === "analytics" && analytics ? (
          <section className="content-grid">
            <Panel title="Usage Chart" wide>
              <div className="chart-grid">
                {analytics.bandwidthByDevice.map((item, index) => (
                  <div key={item.name} className="chart-col">
                    <div className={`chart-bar tone-${index % 4}`} style={{ height: `${Math.max(28, Math.min(180, item.usageMb / 15))}px` }} />
                    <strong>{item.name}</strong>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Download States">{analytics.downloadsByStatus.map((item) => <Row key={item.status} label={item.status} value={`${item.count}`} />)}</Panel>
            <Panel title="Audit">{analytics.auditTimeline.map((item) => <Row key={item.id} label={item.actor} value={item.message} />)}</Panel>
          </section>
        ) : null}

        {activeTab === "security" ? (
          <section className="content-grid">
            <Panel title="Network Events" wide>
              <div className="card-grid">
                {networkEvents.map((item) => (
                  <div key={item.id} className="mini-surface">
                    <strong>{item.source}</strong>
                    <p>{item.message}</p>
                    <span className={`badge ${item.severity === "error" ? "bad" : item.severity === "warn" ? "warn" : "good"}`}>{item.severity}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </section>
        ) : null}

        {activeTab === "sharing" ? (
          <section className="content-grid">
            <Panel title="Create Share">
              <form className="stack" onSubmit={createShareAction}>
                <input value={sharePath} onChange={(event) => setSharePath(event.target.value)} placeholder="Absolute path to share" />
                <input value={sharePassword} onChange={(event) => setSharePassword(event.target.value)} placeholder="Optional password" />
                <button type="submit">Generate Link</button>
              </form>
            </Panel>
            <Panel title="Share Links" wide>
              <div className="list-grid">
                {shareLinks.map((item) => (
                  <div key={item.id} className="list-row">
                    <div>
                      <strong>{item.path}</strong>
                      <p>{item.expiresAt ?? "No expiry"}</p>
                    </div>
                    <a className="download-link" href={`/api/public/shares/${item.id}/access`} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  </div>
                ))}
              </div>
            </Panel>
          </section>
        ) : null}

        {activeTab === "scripts" ? (
          <section className="content-grid">
            <Panel title="Scripts">
              <div className="card-grid">
                {scripts.map((script) => (
                  <div key={script.id} className="service-card">
                    <strong>{script.name}</strong>
                    <p>{script.description}</p>
                    <small>{script.command}</small>
                    <div className="button-row"><button onClick={() => runScript(script.command)}>Run</button></div>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Output">
              <pre className="log-screen">{logs || "Run a command to inspect output."}</pre>
            </Panel>
          </section>
        ) : null}

        {activeTab === "games" ? (
          <section className="content-grid">
            <Panel title="Game Servers"><p className="subcopy">Optional module ready for future orchestration.</p></Panel>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function Panel({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return <section className={wide ? "panel wide" : "panel"}><div className="panel-head"><h2>{title}</h2></div><div className="panel-body">{children}</div></section>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="info-row"><span>{label}</span><strong>{value}</strong></div>;
}

function Bar({ label, value }: { label: string; value: number }) {
  const width = Math.max(10, Math.min(100, Math.round((value / 5000) * 100)));
  return (
    <div className="bar-row">
      <div className="bar-head"><span>{label}</span><strong>{value} MB</strong></div>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${width}%` }} /></div>
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api<{ user: User }>("/auth/session").then((result) => setUser(result.user)).catch(() => undefined).finally(() => setReady(true));
  }, []);

  if (!ready) return <div className="loading-state">Loading CloudOS...</div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage onLogin={setUser} />} />
      <Route path="/" element={user ? <Dashboard user={user} onLogout={() => setUser(null)} /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
