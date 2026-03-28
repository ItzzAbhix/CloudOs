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
  const [networkEvents, setNetworkEvents] = useState<Array<{ id: string; source: string; message: string; severity: string }>>([]);
  const [shareLinks, setShareLinks] = useState<Array<{ id: string; path: string; expiresAt?: string }>>([]);
  const [scripts, setScripts] = useState<Array<{ id: string; name: string; command: string; description: string }>>([]);
  const [logs, setLogs] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");

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

        {activeTab === "vpn" ? (
          <section className="content-grid">
            <Panel title="Devices" wide>
              <div className="list-grid">
                {devices.map((device) => (
                  <div key={device.id} className="list-row">
                    <div>
                      <strong>{device.name}</strong>
                      <p>{device.ipAddress}</p>
                    </div>
                    <span className={`badge ${device.status === "blocked" ? "bad" : "good"}`}>{device.status}</span>
                    <span>{device.usageMb} MB</span>
                    <button onClick={() => toggleDevice(device.id)}>{device.status === "blocked" ? "Enable" : "Disable"}</button>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Policy">
              {devices.map((device) => (
                <Row key={device.id} label={device.name} value={device.killSwitchEnabled ? "Kill switch on" : "Kill switch off"} />
              ))}
            </Panel>
          </section>
        ) : null}

        {activeTab === "files" ? (
          <section className="content-grid">
            <Panel title={`Files · ${files?.currentPath ?? ""}`} wide>
              <div className="list-grid">
                {files?.entries.map((entry) => (
                  <div key={entry.path} className="list-row">
                    <div><strong>{entry.name}</strong><p>{entry.path}</p></div>
                    <span>{entry.type}</span>
                    <span>{entry.size} B</span>
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
            <Panel title="Share Links">{shareLinks.map((item) => <Row key={item.id} label={item.path} value={item.expiresAt ?? "No expiry"} />)}</Panel>
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
