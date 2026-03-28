import { FormEvent, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

type User = {
  id: string;
  username: string;
  role: "admin" | "user";
};

type Overview = {
  appName: string;
  stats: {
    cpuPercent: number;
    memoryUsedMb: number;
    memoryTotalMb: number;
    loadAverage: number[];
    uptimeSeconds: number;
    host: string;
    platform: string;
  };
  counters: Record<string, number>;
  recentAudit: Array<{ id: string; type: string; message: string; actor: string; createdAt: string }>;
};

type Service = {
  id: string;
  name: string;
  category: string;
  description: string;
  port?: number;
  actions: string[];
  runtimeStatus: string;
};

type Device = {
  id: string;
  name: string;
  status: string;
  ipAddress: string;
  lastSeenAt: string;
  usageMb: number;
  killSwitchEnabled: boolean;
};

type FileEntry = { name: string; path: string; type: string; size: number; updatedAt: string };
type Download = { id: string; url: string; status: string; progress: number; targetPath: string; updatedAt: string; error?: string };
type Media = { id: string; title: string; type: string; path: string; subtitleCount: number };
type Workflow = { id: string; name: string; trigger?: string; action: string; enabled: boolean; condition?: string };
type NotificationTarget = { id: string; name: string; type: string; endpoint: string; enabled: boolean };
type Analytics = {
  bandwidthByDevice: Array<{ name: string; usageMb: number }>;
  downloadsByStatus: Array<{ status: string; count: number }>;
  auditTimeline: Array<{ id: string; message: string; createdAt: string; actor: string }>;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

const navItems = [
  { id: "overview", label: "Overview" },
  { id: "services", label: "Services" },
  { id: "vpn", label: "VPN" },
  { id: "files", label: "Files" },
  { id: "downloads", label: "Downloads" },
  { id: "media", label: "Media" },
  { id: "automation", label: "Automation" },
  { id: "notifications", label: "Notifications" },
  { id: "analytics", label: "Analytics" },
  { id: "security", label: "Security" },
  { id: "sharing", label: "Sharing" },
  { id: "scripts", label: "Scripts" },
  { id: "games", label: "Games" }
] as const;

function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("cloudosadmin");
  const [error, setError] = useState<string | null>(null);

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
      <div className="login-card">
        <p className="eyebrow">CloudOS</p>
        <h1>Master Control Panel</h1>
        <p className="muted">Secure access to your VM services, files, downloads, automation, and network controls.</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit">Enter Panel</button>
        </form>
      </div>
    </div>
  );
}

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<(typeof navItems)[number]["id"]>("overview");
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
  const [networkEvents, setNetworkEvents] = useState<Array<{ id: string; source: string; message: string; severity: string; createdAt: string }>>([]);
  const [shareLinks, setShareLinks] = useState<Array<{ id: string; path: string; expiresAt?: string }>>([]);
  const [scripts, setScripts] = useState<Array<{ id: string; name: string; command: string; description: string }>>([]);
  const [logs, setLogs] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");
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
      sharingResult,
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
      api<Array<{ id: string; source: string; message: string; severity: string; createdAt: string }>>("/security/network"),
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
    setShareLinks(sharingResult);
    setScripts(scriptsResult);
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  async function serviceAction(id: string, action: "start" | "stop" | "restart") {
    await api<Service[]>(`/services/${id}/action`, {
      method: "POST",
      body: JSON.stringify({ action })
    });
    setStatusMessage(`${action} triggered for ${id}`);
    await refresh();
  }

  async function showLogs(id: string) {
    const result = await api<{ logs: string }>(`/services/${id}/logs`);
    setLogs(result.logs);
    setActiveTab("services");
  }

  async function toggleDevice(id: string) {
    await api(`/devices/${id}/toggle`, { method: "PATCH" });
    await refresh();
  }

  async function createDownload(event: FormEvent) {
    event.preventDefault();
    if (!downloadUrl) {
      return;
    }
    await api("/downloads", {
      method: "POST",
      body: JSON.stringify({ url: downloadUrl })
    });
    setDownloadUrl("");
    await refresh();
  }

  async function scanMedia() {
    await api("/media/scan", { method: "POST" });
    await refresh();
  }

  async function runScript(command: string) {
    const result = await api<{ ok: boolean; stdout: string; stderr: string; error?: string }>("/scripts/run", {
      method: "POST",
      body: JSON.stringify({ command })
    });
    setLogs([result.stdout, result.stderr, result.error].filter(Boolean).join("\n"));
    setActiveTab("scripts");
  }

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    onLogout();
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">CloudOS</p>
          <h1>Control Panel</h1>
          <p className="muted">Signed in as {user.username}</p>
        </div>
        <nav>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={item.id === activeTab ? "nav-item active" : "nav-item"}
              onClick={() => setActiveTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <button className="logout" onClick={logout}>
          Sign out
        </button>
      </aside>
      <main className="content">
        <header className="hero">
          <div>
            <p className="eyebrow">Master Layer</p>
            <h2>Private infrastructure cockpit for your VM, VPN, files, automation, and media stack.</h2>
          </div>
          <div className="hero-stats">
            <div className="pill">CPU {overview?.stats.cpuPercent ?? 0}%</div>
            <div className="pill">RAM {overview ? `${overview.stats.memoryUsedMb}/${overview.stats.memoryTotalMb} MB` : "..."}</div>
            <div className="pill">Host {overview?.stats.host ?? "..."}</div>
          </div>
        </header>

        {statusMessage ? <section className="message">{statusMessage}</section> : null}

        {activeTab === "overview" && overview ? (
          <section className="grid two">
            <Card title="System Stats">
              <Metric label="CPU Usage" value={`${overview.stats.cpuPercent}%`} />
              <Metric label="Memory" value={`${overview.stats.memoryUsedMb} / ${overview.stats.memoryTotalMb} MB`} />
              <Metric label="Load Avg" value={overview.stats.loadAverage.map((value) => value.toFixed(2)).join(" / ")} />
              <Metric label="Uptime" value={`${Math.floor(overview.stats.uptimeSeconds / 3600)}h`} />
            </Card>
            <Card title="Platform">
              <Metric label="Host" value={overview.stats.host} />
              <Metric label="Platform" value={overview.stats.platform} />
              <Metric label="Services" value={`${overview.counters.servicesOnline}/${overview.counters.services}`} />
              <Metric label="Alerts" value={String(overview.counters.alerts)} />
            </Card>
            <Card title="Quick Actions">
              <div className="button-row">
                <button onClick={() => serviceAction("n8n", "restart")}>Restart n8n</button>
                <button onClick={() => serviceAction("nginx-proxy-manager", "restart")}>Restart Proxy</button>
                <button onClick={() => runScript("bash scripts/post-install-check.sh")}>Run Health Check</button>
              </div>
            </Card>
            <Card title="Recent Activity">
              <Timeline items={overview.recentAudit.map((event) => `${event.type}: ${event.message}`)} />
            </Card>
          </section>
        ) : null}

        {activeTab === "services" ? (
          <section className="grid two">
            <Card title="Service Status">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Port</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((service) => (
                    <tr key={service.id}>
                      <td>
                        <strong>{service.name}</strong>
                        <div className="muted">{service.description}</div>
                      </td>
                      <td>{service.runtimeStatus}</td>
                      <td>{service.port ?? "-"}</td>
                      <td className="button-row">
                        {service.actions.includes("restart") ? <button onClick={() => serviceAction(service.id, "restart")}>Restart</button> : null}
                        <button onClick={() => showLogs(service.id)}>Logs</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Logs Viewer">
              <pre className="log-viewer">{logs || "Select a service to load its logs."}</pre>
            </Card>
          </section>
        ) : null}

        {activeTab === "vpn" ? (
          <section className="grid two">
            <Card title="Device Management">
              {devices.map((device) => (
                <div key={device.id} className="list-row">
                  <div>
                    <strong>{device.name}</strong>
                    <div className="muted">
                      {device.ipAddress} • {device.status}
                    </div>
                  </div>
                  <div className="button-row">
                    <span>{device.usageMb} MB</span>
                    <span>{device.killSwitchEnabled ? "Kill switch on" : "Kill switch off"}</span>
                    <button onClick={() => toggleDevice(device.id)}>{device.status === "blocked" ? "Enable" : "Disable"}</button>
                  </div>
                </div>
              ))}
            </Card>
            <Card title="VPN Notes">
              <p className="muted">This panel tracks devices and policy state. WireGuard networking remains on your separate VPN VM.</p>
              <Timeline items={devices.map((device) => `${device.name} last seen ${new Date(device.lastSeenAt).toLocaleString()}`)} />
            </Card>
          </section>
        ) : null}

        {activeTab === "files" ? (
          <section className="grid two">
            <Card title={`File Browser: ${files?.currentPath ?? ""}`}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Size</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {files?.entries.map((entry) => (
                    <tr key={entry.path}>
                      <td>{entry.name}</td>
                      <td>{entry.type}</td>
                      <td>{entry.size}</td>
                      <td>{new Date(entry.updatedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Smart File System">
              <p className="muted">Upload endpoints, file tags, auto-organization folders, and share-link support are already exposed by the API.</p>
              <p className="muted">Next operational step on the VM is mounting real storage under the configured files, downloads, and media directories.</p>
            </Card>
          </section>
        ) : null}

        {activeTab === "downloads" ? (
          <section className="grid two">
            <Card title="Auto Download Engine">
              <form className="stack" onSubmit={createDownload}>
                <input value={downloadUrl} onChange={(event) => setDownloadUrl(event.target.value)} placeholder="https://example.com/file.iso" />
                <button type="submit">Queue Download</button>
              </form>
              <table className="table">
                <thead>
                  <tr>
                    <th>URL</th>
                    <th>Status</th>
                    <th>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {downloads.map((download) => (
                    <tr key={download.id}>
                      <td className="truncate">{download.url}</td>
                      <td>{download.status}</td>
                      <td>{download.progress}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Download Diagnostics">
              <Timeline items={downloads.map((download) => `${download.status}: ${download.targetPath}`)} />
            </Card>
          </section>
        ) : null}

        {activeTab === "media" ? (
          <section className="grid two">
            <Card title="Media Server">
              <div className="button-row">
                <button onClick={scanMedia}>Rescan Library</button>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Subtitles</th>
                  </tr>
                </thead>
                <tbody>
                  {media.map((item) => (
                    <tr key={item.id}>
                      <td>{item.title}</td>
                      <td>{item.type}</td>
                      <td>{item.subtitleCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Streaming Notes">
              <p className="muted">This codebase scans, catalogs, and exposes media metadata. Plug in Jellyfin or another streamer later and route it through the same panel.</p>
            </Card>
          </section>
        ) : null}

        {activeTab === "automation" ? (
          <section className="grid two">
            <Card title="Automation Engine">
              <Timeline items={workflows.map((workflow) => `${workflow.name}: ${workflow.action}`)} />
            </Card>
            <Card title="Smart Rules">
              <Timeline items={rules.map((rule) => `${rule.name}: ${rule.action}`)} />
            </Card>
          </section>
        ) : null}

        {activeTab === "notifications" ? (
          <section className="grid two">
            <Card title="Notification Targets">
              <Timeline items={notifications.map((target) => `${target.name} (${target.type}) -> ${target.endpoint}`)} />
            </Card>
            <Card title="Events">
              <p className="muted">Telegram and webhook targets are supported by the API. Test-send is available through the backend endpoint.</p>
            </Card>
          </section>
        ) : null}

        {activeTab === "analytics" && analytics ? (
          <section className="grid two">
            <Card title="Bandwidth Tracking">
              {analytics.bandwidthByDevice.map((item) => (
                <Bar key={item.name} label={item.name} value={item.usageMb} unit="MB" />
              ))}
            </Card>
            <Card title="Download Stats">
              {analytics.downloadsByStatus.map((item) => (
                <Metric key={item.status} label={item.status} value={String(item.count)} />
              ))}
            </Card>
            <Card title="Activity Logs">
              <Timeline items={analytics.auditTimeline.map((item) => `${item.actor}: ${item.message}`)} />
            </Card>
          </section>
        ) : null}

        {activeTab === "security" ? (
          <section className="grid two">
            <Card title="Network Monitor">
              <Timeline items={networkEvents.map((event) => `${event.severity.toUpperCase()} ${event.source}: ${event.message}`)} />
            </Card>
            <Card title="Security Systems">
              <Metric label="Ad Blocker" value="Adapter ready" />
              <Metric label="Antivirus" value="Adapter ready" />
              <Metric label="DNS Filtering" value="Adapter ready" />
              <p className="muted">The backend exposes these panels now and leaves the actual engine hookup open for Pi-hole, AdGuard, ClamAV, or your preferred tools.</p>
            </Card>
          </section>
        ) : null}

        {activeTab === "sharing" ? (
          <section className="grid two">
            <Card title="File Sharing">
              <Timeline items={shareLinks.map((item) => `${item.path} ${item.expiresAt ? `expires ${item.expiresAt}` : "no expiry"}`)} />
            </Card>
            <Card title="Access Controls">
              <p className="muted">Share-link creation, password protection, and expiry timestamps are supported in the API state model.</p>
            </Card>
          </section>
        ) : null}

        {activeTab === "scripts" ? (
          <section className="grid two">
            <Card title="Script & Tool Runner">
              {scripts.map((script) => (
                <div key={script.id} className="list-row">
                  <div>
                    <strong>{script.name}</strong>
                    <div className="muted">{script.description}</div>
                  </div>
                  <button onClick={() => runScript(script.command)}>Run</button>
                </div>
              ))}
            </Card>
            <Card title="Runner Output">
              <pre className="log-viewer">{logs || "Run a script to inspect output."}</pre>
            </Card>
          </section>
        ) : null}

        {activeTab === "games" ? (
          <section className="grid two">
            <Card title="Game Server Manager">
              <p className="muted">Optional module stubbed into the control panel so game servers can be added as managed services later.</p>
            </Card>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="card-header">
        <h3>{title}</h3>
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Timeline({ items }: { items: string[] }) {
  if (!items.length) {
    return <p className="muted">No entries yet.</p>;
  }

  return (
    <div className="timeline">
      {items.map((item) => (
        <div key={item} className="timeline-item">
          {item}
        </div>
      ))}
    </div>
  );
}

function Bar({ label, value, unit }: { label: string; value: number; unit: string }) {
  const width = Math.max(8, Math.min(100, Math.round((value / 5000) * 100)));
  return (
    <div className="bar-row">
      <div className="bar-label">
        <span>{label}</span>
        <strong>
          {value} {unit}
        </strong>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api<{ user: User }>("/auth/session")
      .then((result) => setUser(result.user))
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return <div className="loading">Loading CloudOS...</div>;
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage onLogin={setUser} />} />
      <Route path="/" element={user ? <Dashboard user={user} onLogout={() => setUser(null)} /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
