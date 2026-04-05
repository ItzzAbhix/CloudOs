import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type GameServer = {
  id: string;
  identifier: string;
  name: string;
  description: string;
  node: string;
  allocation: string;
  suspended: boolean;
  powerState: string;
  limits: { memoryMb: number; diskMb: number; cpuPercent: number };
  usage: null | { memoryMb: number; diskMb: number; cpuPercent: number; networkRxMb: number; networkTxMb: number; uptimeSeconds: number };
};

type GamesDashboard = {
  configured: boolean;
  powerActionsEnabled: boolean;
  panel: { url: string; reachable: boolean };
  summary: { totalServers: number; runningServers: number; suspendedServers: number; nodes: number };
  servers: GameServer[];
  error: string | null;
};

type GameServerDetail = {
  identifier: string;
  uuid: string;
  name: string;
  description: string;
  node: string;
  allocation: string;
  allocations: string[];
  suspended: boolean;
  installing: boolean;
  powerState: string;
  dockerImage: string;
  invocation: string;
  owner: boolean;
  limits: { memoryMb: number; diskMb: number; cpuPercent: number };
  featureLimits: { databases: number; allocations: number; backups: number };
  usage: GameServer["usage"];
  startupVariables: Array<{ name: string; env: string; value: string; defaultValue: string; editable: boolean; rules: string; description: string }>;
  databases: Array<{ id: string; name: string; username: string; address: string; maxConnections: number }>;
  schedules: Array<{ id: string; name: string; active: boolean; cron: string; nextRunAt: string; lastRunAt: string; tasks: Array<{ id: string; sequenceId: number; action: string; payload: string }> }>;
  backups: Array<{ id: string; name: string; sizeMb: number; checksum: string; completedAt: string; createdAt: string }>;
  users: Array<{ id: string; username: string; email: string; permissions: string[]; twoFactorEnabled: boolean }>;
  activity: Array<{ id: string; event: string; description: string; source: string; createdAt: string }>;
};

type GameServerFiles = {
  currentPath: string;
  entries: Array<{ name: string; path: string; type: "file" | "directory"; size: number; updatedAt: string }>;
};

type GameConsoleWebsocket = { socket: string; token: string };
type GameCreateCatalog = {
  users: Array<{ id: string; username: string; email: string; name: string }>;
  nodes: Array<{ id: string; name: string; fqdn: string; allocations: Array<{ id: string; label: string; assigned: boolean }> }>;
  nests: Array<{ id: string; name: string; eggs: Array<{ id: string; name: string; description: string }> }>;
};
type GameEggTemplate = {
  id: string;
  nestId: string;
  name: string;
  description: string;
  dockerImage: string;
  dockerImages: Array<{ label: string; image: string }>;
  startup: string;
  variables: Array<{ name: string; env: string; defaultValue: string; rules: string; description: string; userEditable: boolean }>;
};
type GameTab = "overview" | "console" | "files" | "startup" | "network" | "backups" | "schedules" | "databases" | "users" | "activity";

const tabs: Array<{ id: GameTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "console", label: "Console" },
  { id: "files", label: "Files" },
  { id: "startup", label: "Startup" },
  { id: "network", label: "Network" },
  { id: "backups", label: "Backups" },
  { id: "schedules", label: "Schedules" },
  { id: "databases", label: "Databases" },
  { id: "users", label: "Users" },
  { id: "activity", label: "Activity" }
];

async function gameApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: init?.body ? { "content-type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
    ...init
  });
  if (!response.ok) throw new Error(await response.text());
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function normalizePath(pathname: string) {
  if (!pathname || pathname === ".") return "/";
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function parentPath(pathname: string) {
  const parts = normalizePath(pathname).split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

export function GameControlPlane({ games, refresh }: { games: GamesDashboard | null; refresh: () => Promise<void> }) {
  const [selectedIdentifier, setSelectedIdentifier] = useState("");
  const [tab, setTab] = useState<GameTab>("overview");
  const [detail, setDetail] = useState<GameServerDetail | null>(null);
  const [files, setFiles] = useState<GameServerFiles | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [selectedFileContent, setSelectedFileContent] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [command, setCommand] = useState("");
  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [socketSession, setSocketSession] = useState<GameConsoleWebsocket | null>(null);
  const [catalog, setCatalog] = useState<GameCreateCatalog | null>(null);
  const [eggTemplate, setEggTemplate] = useState<GameEggTemplate | null>(null);
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [renameDraft, setRenameDraft] = useState({ name: "", description: "" });
  const [dockerImageDraft, setDockerImageDraft] = useState("");
  const [startupDrafts, setStartupDrafts] = useState<Record<string, string>>({});
  const [createForm, setCreateForm] = useState({
    name: "",
    description: "",
    userId: "",
    nestId: "",
    eggId: "",
    nodeId: "",
    allocationId: "",
    memory: "2048",
    disk: "10000",
    cpu: "0",
    dockerImage: "",
    startup: ""
  });
  const [createEnvironment, setCreateEnvironment] = useState<Record<string, string>>({});
  const socketRef = useRef<WebSocket | null>(null);
  const consoleEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const first = games?.servers[0]?.identifier ?? "";
    if (!selectedIdentifier && first) setSelectedIdentifier(first);
    if (selectedIdentifier && !(games?.servers ?? []).some((server) => server.identifier === selectedIdentifier)) setSelectedIdentifier(first);
  }, [games, selectedIdentifier]);

  useEffect(() => {
    void gameApi<GameCreateCatalog>("/games/catalog")
      .then(setCatalog)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Unable to load game catalog"));
  }, []);

  useEffect(() => {
    setFiles(null);
    setSelectedFilePath("");
    setSelectedFileContent("");
    setSocketSession(null);
    setConsoleLines([]);
  }, [selectedIdentifier]);

  async function loadDetail(identifier: string) {
    if (!identifier) return;
    setError("");
    setDetail(await gameApi<GameServerDetail>(`/games/servers/${identifier}`));
  }

  async function loadFiles(identifier: string, directory: string) {
    setFiles(await gameApi<GameServerFiles>(`/games/servers/${identifier}/files?directory=${encodeURIComponent(directory)}`));
  }

  useEffect(() => {
    if (!selectedIdentifier) return;
    void loadDetail(selectedIdentifier).catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Unable to load server"));
  }, [selectedIdentifier]);

  useEffect(() => {
    if (!detail) return;
    setRenameDraft({ name: detail.name, description: detail.description || "" });
    setDockerImageDraft(detail.dockerImage || "");
    setStartupDrafts(Object.fromEntries(detail.startupVariables.map((variable) => [variable.env, variable.value || variable.defaultValue || ""])));
  }, [detail]);

  useEffect(() => {
    if (!showCreateServer) return;
    const firstUser = catalog?.users[0]?.id ?? "";
    const firstNest = catalog?.nests[0]?.id ?? "";
    const firstEgg = catalog?.nests[0]?.eggs[0]?.id ?? "";
    const firstNode = catalog?.nodes[0]?.id ?? "";
    const firstAllocation = catalog?.nodes[0]?.allocations.find((allocation) => !allocation.assigned)?.id ?? "";
    setCreateForm((current) => ({
      ...current,
      userId: current.userId || firstUser,
      nestId: current.nestId || firstNest,
      eggId: current.eggId || firstEgg,
      nodeId: current.nodeId || firstNode,
      allocationId: current.allocationId || firstAllocation
    }));
  }, [catalog, showCreateServer]);

  useEffect(() => {
    if (!showCreateServer || !createForm.nestId || !createForm.eggId) return;
    void gameApi<GameEggTemplate>(`/games/nests/${createForm.nestId}/eggs/${createForm.eggId}`)
      .then((template) => {
        setEggTemplate(template);
        setCreateForm((current) => ({
          ...current,
          dockerImage: current.dockerImage || template.dockerImage,
          startup: current.startup || template.startup
        }));
        setCreateEnvironment(Object.fromEntries(template.variables.map((variable) => [variable.env, variable.defaultValue || ""])));
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Unable to load egg template"));
  }, [createForm.eggId, createForm.nestId, showCreateServer]);

  useEffect(() => {
    if (tab !== "files" || !selectedIdentifier) return;
    void loadFiles(selectedIdentifier, files?.currentPath ?? "/").catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Unable to load files"));
  }, [tab, selectedIdentifier]);

  useEffect(() => {
    if (tab !== "console" || !selectedIdentifier) return;
    setConsoleLines([]);
    void gameApi<GameConsoleWebsocket>(`/games/servers/${selectedIdentifier}/console/websocket`)
      .then(setSocketSession)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Unable to open console"));
  }, [tab, selectedIdentifier]);

  useEffect(() => {
    if (!socketSession || tab !== "console") return;
    const socket = new WebSocket(socketSession.socket);
    socketRef.current = socket;
    socket.addEventListener("open", () => socket.send(JSON.stringify({ event: "auth", args: [socketSession.token] })));
    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as { event?: string; args?: string[] };
        if (payload.event === "console output" || payload.event === "daemon message" || payload.event === "install output") {
          setConsoleLines((current) => [...current, ...(payload.args ?? []).join("\n").split("\n").filter(Boolean)].slice(-400));
        }
      } catch {
        setConsoleLines((current) => [...current, String(event.data)].slice(-400));
      }
    });
    return () => socket.close();
  }, [socketSession, tab]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [consoleLines]);

  const selectedServer = useMemo(
    () => (games?.servers ?? []).find((server) => server.identifier === selectedIdentifier) ?? null,
    [games, selectedIdentifier]
  );

  const selectedNest = useMemo(
    () => (catalog?.nests ?? []).find((nest) => nest.id === createForm.nestId) ?? null,
    [catalog, createForm.nestId]
  );

  const selectedNode = useMemo(
    () => (catalog?.nodes ?? []).find((node) => node.id === createForm.nodeId) ?? null,
    [catalog, createForm.nodeId]
  );

  const breadcrumbs = useMemo(() => {
    const current = normalizePath(files?.currentPath ?? "/");
    const parts = current.split("/").filter(Boolean);
    const items = [{ label: "/", path: "/" }];
    let running = "";
    for (const part of parts) {
      running += `/${part}`;
      items.push({ label: part, path: running });
    }
    return items;
  }, [files]);

  async function power(signal: "start" | "stop" | "restart" | "kill") {
    if (!selectedIdentifier) return;
    await gameApi(`/games/servers/${selectedIdentifier}/power`, { method: "POST", body: JSON.stringify({ signal }) });
    await Promise.all([refresh(), loadDetail(selectedIdentifier)]);
  }

  async function sendCommand(event: FormEvent) {
    event.preventDefault();
    if (!selectedIdentifier || !command.trim()) return;
    await gameApi(`/games/servers/${selectedIdentifier}/command`, { method: "POST", body: JSON.stringify({ command }) });
    setMessage(`Sent: ${command}`);
    setCommand("");
  }

  async function openFile(pathname: string) {
    const result = await gameApi<{ path: string; content: string }>(`/games/servers/${selectedIdentifier}/file?path=${encodeURIComponent(pathname)}`);
    setSelectedFilePath(result.path);
    setSelectedFileContent(result.content);
  }

  async function saveFile() {
    await gameApi(`/games/servers/${selectedIdentifier}/file`, { method: "POST", body: JSON.stringify({ path: selectedFilePath, content: selectedFileContent }) });
    setMessage(`Saved ${selectedFilePath}`);
  }

  async function createFolder(event: FormEvent) {
    event.preventDefault();
    if (!selectedIdentifier || !files?.currentPath || !newFolderName.trim()) return;
    await gameApi(`/games/servers/${selectedIdentifier}/files/folders`, {
      method: "POST",
      body: JSON.stringify({ directory: files.currentPath, name: newFolderName.trim() })
    });
    setNewFolderName("");
    await loadFiles(selectedIdentifier, files.currentPath);
  }

  async function deleteEntry(entryName: string) {
    if (!selectedIdentifier || !files?.currentPath) return;
    await gameApi(`/games/servers/${selectedIdentifier}/files`, {
      method: "DELETE",
      body: JSON.stringify({ directory: files.currentPath, files: [entryName] })
    });
    await loadFiles(selectedIdentifier, files.currentPath);
  }

  async function createBackup() {
    if (!selectedIdentifier) return;
    await gameApi(`/games/servers/${selectedIdentifier}/backups`, { method: "POST", body: JSON.stringify({}) });
    await loadDetail(selectedIdentifier);
  }

  async function saveServerIdentity(event: FormEvent) {
    event.preventDefault();
    if (!selectedIdentifier) return;
    await gameApi(`/games/servers/${selectedIdentifier}/settings/rename`, {
      method: "POST",
      body: JSON.stringify(renameDraft)
    });
    setMessage(`Updated ${renameDraft.name}`);
    await Promise.all([refresh(), loadDetail(selectedIdentifier)]);
  }

  async function saveDockerImage(event: FormEvent) {
    event.preventDefault();
    if (!selectedIdentifier || !dockerImageDraft.trim()) return;
    await gameApi(`/games/servers/${selectedIdentifier}/settings/docker-image`, {
      method: "PUT",
      body: JSON.stringify({ dockerImage: dockerImageDraft.trim() })
    });
    setMessage("Updated docker image");
    await loadDetail(selectedIdentifier);
  }

  async function reinstallServer() {
    if (!selectedIdentifier) return;
    await gameApi(`/games/servers/${selectedIdentifier}/settings/reinstall`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setMessage("Triggered reinstall");
  }

  async function saveStartupVariable(key: string) {
    if (!selectedIdentifier) return;
    await gameApi(`/games/servers/${selectedIdentifier}/startup/variable`, {
      method: "PUT",
      body: JSON.stringify({ key, value: startupDrafts[key] ?? "" })
    });
    setMessage(`Updated ${key}`);
    await loadDetail(selectedIdentifier);
  }

  async function createServer(event: FormEvent) {
    event.preventDefault();
    await gameApi("/games/servers", {
      method: "POST",
      body: JSON.stringify({
        name: createForm.name,
        description: createForm.description,
        userId: Number(createForm.userId),
        eggId: Number(createForm.eggId),
        dockerImage: createForm.dockerImage || undefined,
        startup: createForm.startup || undefined,
        environment: createEnvironment,
        limits: {
          memory: Number(createForm.memory),
          disk: Number(createForm.disk),
          cpu: Number(createForm.cpu),
          swap: 0,
          io: 500
        },
        featureLimits: { databases: 0, allocations: 0, backups: 0 },
        allocation: { default: Number(createForm.allocationId), additional: [] }
      })
    });
    setShowCreateServer(false);
    setMessage(`Created ${createForm.name}`);
    setCreateForm({
      name: "",
      description: "",
      userId: "",
      nestId: "",
      eggId: "",
      nodeId: "",
      allocationId: "",
      memory: "2048",
      disk: "10000",
      cpu: "0",
      dockerImage: "",
      startup: ""
    });
    setCreateEnvironment({});
    await refresh();
  }

  return (
    <section className="content-grid">
      <section className="panel wide">
        <div className="panel-head"><h2>Game Control Plane</h2></div>
        <div className="panel-body">
          {games?.error ? <div className="vpn-error-banner">{games.error}</div> : null}
          {error ? <div className="vpn-error-banner">{error}</div> : null}
          {message ? <div className="vpn-message">{message}</div> : null}
          <div className="game-summary-grid">
            <div className="mini-surface"><span className="eyebrow">Provider</span><strong>Pterodactyl</strong><p>{games?.configured ? (games.panel.reachable ? "Panel connected" : "Panel unreachable") : "Configuration missing"}</p></div>
            <div className="mini-surface"><span className="eyebrow">Servers</span><strong>{games?.summary.totalServers ?? 0}</strong><p>{games?.summary.runningServers ?? 0} running</p></div>
            <div className="mini-surface"><span className="eyebrow">Nodes</span><strong>{games?.summary.nodes ?? 0}</strong><p>{games?.summary.suspendedServers ?? 0} suspended</p></div>
            <div className="mini-surface"><span className="eyebrow">Panel</span><strong>{games?.panel.reachable ? "Reachable" : "Offline"}</strong><p>{games?.panel.url || "Missing panel URL"}</p></div>
          </div>
          <div className="button-row">
            <button onClick={() => setShowCreateServer((current) => !current)}>{showCreateServer ? "Close Server Builder" : "Create Server"}</button>
          </div>
          {showCreateServer ? (
            <div className="panel wide game-create-panel">
              <div className="panel-head"><h2>Create Server</h2></div>
              <div className="panel-body">
                <form className="game-create-form" onSubmit={(event) => void createServer(event)}>
                  <input value={createForm.name} onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} placeholder="Server name" />
                  <input value={createForm.description} onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))} placeholder="Description" />
                  <select value={createForm.userId} onChange={(event) => setCreateForm((current) => ({ ...current, userId: event.target.value }))}>
                    <option value="">Select user</option>
                    {(catalog?.users ?? []).map((user) => <option key={user.id} value={user.id}>{user.name} ({user.username})</option>)}
                  </select>
                  <select value={createForm.nestId} onChange={(event) => setCreateForm((current) => ({ ...current, nestId: event.target.value, eggId: "", dockerImage: "", startup: "" }))}>
                    <option value="">Select nest</option>
                    {(catalog?.nests ?? []).map((nest) => <option key={nest.id} value={nest.id}>{nest.name}</option>)}
                  </select>
                  <select value={createForm.eggId} onChange={(event) => setCreateForm((current) => ({ ...current, eggId: event.target.value, dockerImage: "", startup: "" }))}>
                    <option value="">Select egg</option>
                    {(selectedNest?.eggs ?? []).map((egg) => <option key={egg.id} value={egg.id}>{egg.name}</option>)}
                  </select>
                  <select value={createForm.nodeId} onChange={(event) => setCreateForm((current) => ({ ...current, nodeId: event.target.value, allocationId: "" }))}>
                    <option value="">Select node</option>
                    {(catalog?.nodes ?? []).map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
                  </select>
                  <select value={createForm.allocationId} onChange={(event) => setCreateForm((current) => ({ ...current, allocationId: event.target.value }))}>
                    <option value="">Select allocation</option>
                    {(selectedNode?.allocations ?? []).filter((allocation) => !allocation.assigned).map((allocation) => <option key={allocation.id} value={allocation.id}>{allocation.label}</option>)}
                  </select>
                  <input value={createForm.memory} onChange={(event) => setCreateForm((current) => ({ ...current, memory: event.target.value }))} placeholder="Memory MB" />
                  <input value={createForm.disk} onChange={(event) => setCreateForm((current) => ({ ...current, disk: event.target.value }))} placeholder="Disk MB" />
                  <input value={createForm.cpu} onChange={(event) => setCreateForm((current) => ({ ...current, cpu: event.target.value }))} placeholder="CPU limit (0 unlimited)" />
                  <input value={createForm.dockerImage} onChange={(event) => setCreateForm((current) => ({ ...current, dockerImage: event.target.value }))} placeholder="Docker image" />
                  <textarea className="config-editor" value={createForm.startup} onChange={(event) => setCreateForm((current) => ({ ...current, startup: event.target.value }))} placeholder="Startup command" />
                  {eggTemplate?.variables.length ? (
                    <div className="game-create-variable-grid">
                      {eggTemplate.variables.map((variable) => (
                        <label key={variable.env} className="game-variable-input">
                          <span>{variable.name}</span>
                          <input value={createEnvironment[variable.env] ?? ""} onChange={(event) => setCreateEnvironment((current) => ({ ...current, [variable.env]: event.target.value }))} />
                        </label>
                      ))}
                    </div>
                  ) : null}
                  <div className="button-row"><button type="submit">Create Server</button></div>
                </form>
              </div>
            </div>
          ) : null}
          {!games?.servers.length ? (
            <p className="subcopy">No game servers discovered yet.</p>
          ) : (
            <div className="game-manager-shell">
              <aside className="game-sidebar">
                {games.servers.map((server) => (
                  <button
                    key={server.identifier}
                    className={`game-server-list-item ${selectedIdentifier === server.identifier ? "active" : ""}`}
                    onClick={() => setSelectedIdentifier(server.identifier)}
                  >
                    <div>
                      <strong>{server.name}</strong>
                      <p>{server.allocation}</p>
                    </div>
                    <span className={`badge ${server.suspended ? "warn" : server.powerState === "running" ? "good" : "neutral"}`}>
                      {server.suspended ? "Suspended" : server.powerState}
                    </span>
                  </button>
                ))}
              </aside>
              <div className="game-manager-main">
                {!selectedServer || !detail ? (
                  <p className="subcopy">Select a server to load its management view.</p>
                ) : (
                  <>
                    <div className="game-detail-hero">
                      <div>
                        <p className="eyebrow">Native Server Manager</p>
                        <h3>{detail.name}</h3>
                        <p>{detail.description || "No description"}</p>
                      </div>
                      <div className="game-detail-actions">
                        <button disabled={!games.powerActionsEnabled} onClick={() => void power("start")}>Start</button>
                        <button disabled={!games.powerActionsEnabled} onClick={() => void power("restart")}>Restart</button>
                        <button disabled={!games.powerActionsEnabled} onClick={() => void power("stop")}>Stop</button>
                        <button disabled={!games.powerActionsEnabled} onClick={() => void power("kill")}>Kill</button>
                      </div>
                    </div>
                    <div className="game-tab-row">
                      {tabs.map((item) => (
                        <button key={item.id} className={`game-tab-button ${tab === item.id ? "active" : ""}`} onClick={() => setTab(item.id)}>
                          {item.label}
                        </button>
                      ))}
                    </div>
                    {tab === "overview" ? (
                      <div className="game-detail-grid">
                        <div className="mini-surface"><span className="eyebrow">Status</span><strong>{detail.powerState}</strong><p>{detail.installing ? "Install running" : detail.owner ? "Owner access" : "Subuser access"}</p></div>
                        <div className="mini-surface"><span className="eyebrow">Memory</span><strong>{Math.round(detail.usage?.memoryMb ?? 0)} MB</strong><p>Limit {detail.limits.memoryMb} MB</p></div>
                        <div className="mini-surface"><span className="eyebrow">Disk</span><strong>{Math.round(detail.usage?.diskMb ?? 0)} MB</strong><p>Limit {detail.limits.diskMb} MB</p></div>
                        <div className="mini-surface"><span className="eyebrow">CPU</span><strong>{Math.round(detail.usage?.cpuPercent ?? 0)}%</strong><p>Limit {detail.limits.cpuPercent || 0}%</p></div>
                        <div className="mini-surface"><span className="eyebrow">Allocation</span><strong>{detail.allocation}</strong><p>{detail.node}</p></div>
                        <div className="mini-surface"><span className="eyebrow">Uptime</span><strong>{detail.usage ? `${Math.round(detail.usage.uptimeSeconds / 60)} min` : "N/A"}</strong><p>{detail.uuid}</p></div>
                        <div className="panel wide">
                          <div className="panel-head"><h2>Settings</h2></div>
                          <div className="panel-body">
                            <form className="game-command-row" onSubmit={(event) => void saveServerIdentity(event)}>
                              <input value={renameDraft.name} onChange={(event) => setRenameDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Server name" />
                              <button type="submit">Save Name</button>
                            </form>
                            <textarea className="config-editor compact-editor" value={renameDraft.description} onChange={(event) => setRenameDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Description" />
                            <form className="game-command-row" onSubmit={(event) => void saveDockerImage(event)}>
                              <input value={dockerImageDraft} onChange={(event) => setDockerImageDraft(event.target.value)} placeholder="Docker image" />
                              <button type="submit">Save Image</button>
                            </form>
                            <div className="button-row"><button onClick={() => void reinstallServer()}>Reinstall Server</button></div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {tab === "console" ? (
                      <div className="game-console-shell">
                        <div className="log-screen game-console-screen">
                          {consoleLines.length ? consoleLines.join("\n") : "Waiting for console output..."}
                          <div ref={consoleEndRef} />
                        </div>
                        <form className="game-command-row" onSubmit={(event) => void sendCommand(event)}>
                          <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="say hello from CloudOS" />
                          <button type="submit">Send Command</button>
                        </form>
                      </div>
                    ) : null}
                    {tab === "files" ? (
                      <div className="game-files-shell">
                        <div className="game-files-toolbar">
                          <div className="game-breadcrumbs">
                            {breadcrumbs.map((crumb) => (
                              <button key={crumb.path} className="game-crumb" onClick={() => void loadFiles(selectedIdentifier, crumb.path)}>{crumb.label}</button>
                            ))}
                          </div>
                          <button onClick={() => void loadFiles(selectedIdentifier, parentPath(files?.currentPath ?? "/"))}>Up</button>
                        </div>
                        <div className="game-files-grid">
                          <div className="mini-surface game-file-browser">
                            <form className="game-command-row" onSubmit={(event) => void createFolder(event)}>
                              <input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder="new-folder" />
                              <button type="submit">Create Folder</button>
                            </form>
                            <div className="game-file-list">
                              {(files?.entries ?? []).map((entry) => (
                                <div key={entry.path} className="game-file-row">
                                  <button className="game-file-open" onClick={() => entry.type === "directory" ? void loadFiles(selectedIdentifier, entry.path) : void openFile(entry.path)}>
                                    <strong>{entry.name}</strong>
                                    <span>{entry.type === "directory" ? "Directory" : `${entry.size} B`}</span>
                                  </button>
                                  <button className="small-button" onClick={() => void deleteEntry(entry.name)}>Delete</button>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="mini-surface game-file-editor">
                            <div className="info-row"><span>Selected File</span><strong>{selectedFilePath || "None"}</strong></div>
                            <textarea className="config-editor game-file-textarea" value={selectedFileContent} onChange={(event) => setSelectedFileContent(event.target.value)} placeholder="Select a text file to edit it here." />
                            <div className="button-row"><button disabled={!selectedFilePath} onClick={() => void saveFile()}>Save File</button></div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {tab === "startup" ? (
                      <div className="panel wide">
                        <div className="panel-head"><h2>Startup Variables</h2></div>
                        <div className="panel-body">
                          <div className="info-row"><span>Docker Image</span><strong>{detail.dockerImage || "Unknown"}</strong></div>
                          <div className="info-row"><span>Invocation</span><strong>{detail.invocation || "Unavailable"}</strong></div>
                          {detail.startupVariables.map((variable) => (
                            <div key={variable.env} className="info-row stacked-row">
                              <div><strong>{variable.name}</strong><p>{variable.description || variable.env}</p></div>
                              <div className="game-variable-values editable">
                                <span>{variable.env}</span>
                                <input value={startupDrafts[variable.env] ?? ""} onChange={(event) => setStartupDrafts((current) => ({ ...current, [variable.env]: event.target.value }))} disabled={!variable.editable} />
                                <button disabled={!variable.editable} onClick={() => void saveStartupVariable(variable.env)}>Save</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {tab === "network" ? (
                      <div className="game-detail-grid">
                        <div className="mini-surface"><span className="eyebrow">Primary Allocation</span><strong>{detail.allocation}</strong><p>{detail.allocations.join(", ") || "No extra allocations"}</p></div>
                        <div className="mini-surface"><span className="eyebrow">Feature Limits</span><strong>{detail.featureLimits.allocations} allocations</strong><p>{detail.featureLimits.databases} DBs, {detail.featureLimits.backups} backups</p></div>
                        <div className="mini-surface"><span className="eyebrow">Traffic</span><strong>{detail.usage ? `${detail.usage.networkRxMb.toFixed(1)} / ${detail.usage.networkTxMb.toFixed(1)} MB` : "N/A"}</strong><p>Rx / Tx</p></div>
                      </div>
                    ) : null}
                    {tab === "backups" ? (
                      <div className="panel wide">
                        <div className="panel-head"><h2>Backups</h2></div>
                        <div className="panel-body">
                          <div className="button-row"><button onClick={() => void createBackup()}>Create Backup</button></div>
                          {detail.backups.length ? detail.backups.map((backup) => (
                            <div key={backup.id} className="info-row stacked-row">
                              <div><strong>{backup.name}</strong><p>{backup.createdAt}</p></div>
                              <div className="game-variable-values"><span>{backup.checksum}</span><strong>{backup.sizeMb.toFixed(1)} MB</strong></div>
                            </div>
                          )) : <p className="subcopy">No backups found.</p>}
                        </div>
                      </div>
                    ) : null}
                    {tab === "schedules" ? (
                      <div className="panel wide">
                        <div className="panel-head"><h2>Schedules</h2></div>
                        <div className="panel-body">
                          {detail.schedules.length ? detail.schedules.map((schedule) => (
                            <div key={schedule.id} className="game-schedule-card">
                              <div className="service-top"><div><strong>{schedule.name}</strong><p>Cron {schedule.cron}</p></div><span className={`badge ${schedule.active ? "good" : "neutral"}`}>{schedule.active ? "Active" : "Paused"}</span></div>
                              <div className="game-schedule-meta"><span>Next: {schedule.nextRunAt}</span><span>Last: {schedule.lastRunAt}</span></div>
                              {schedule.tasks.map((task) => <div key={task.id} className="info-row"><span>{task.sequenceId}. {task.action}</span><strong>{task.payload || "No payload"}</strong></div>)}
                            </div>
                          )) : <p className="subcopy">No schedules configured.</p>}
                        </div>
                      </div>
                    ) : null}
                    {tab === "databases" ? (
                      <div className="panel wide">
                        <div className="panel-head"><h2>Databases</h2></div>
                        <div className="panel-body">
                          {detail.databases.length ? detail.databases.map((database) => (
                            <div key={database.id} className="info-row stacked-row">
                              <div><strong>{database.name}</strong><p>{database.address}</p></div>
                              <div className="game-variable-values"><span>{database.username}</span><strong>{database.maxConnections} max connections</strong></div>
                            </div>
                          )) : <p className="subcopy">No databases attached.</p>}
                        </div>
                      </div>
                    ) : null}
                    {tab === "users" ? (
                      <div className="panel wide">
                        <div className="panel-head"><h2>Users</h2></div>
                        <div className="panel-body">
                          {detail.users.length ? detail.users.map((user) => (
                            <div key={user.id} className="info-row stacked-row">
                              <div><strong>{user.username}</strong><p>{user.email}</p></div>
                              <div className="game-variable-values"><span>{user.twoFactorEnabled ? "2FA enabled" : "2FA off"}</span><strong>{user.permissions.length} permissions</strong></div>
                            </div>
                          )) : <p className="subcopy">No subusers configured.</p>}
                        </div>
                      </div>
                    ) : null}
                    {tab === "activity" ? (
                      <div className="panel wide">
                        <div className="panel-head"><h2>Activity</h2></div>
                        <div className="panel-body">
                          {detail.activity.length ? detail.activity.map((entry) => (
                            <div key={entry.id} className="info-row stacked-row">
                              <div><strong>{entry.event}</strong><p>{entry.description || "No description provided."}</p></div>
                              <div className="game-variable-values"><span>{entry.source}</span><strong>{entry.createdAt}</strong></div>
                            </div>
                          )) : <p className="subcopy">No activity events returned by Pterodactyl.</p>}
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
