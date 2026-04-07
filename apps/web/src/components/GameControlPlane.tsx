import { FormEvent, useEffect, useRef, useState } from "react";

type Server = {
  id: string;
  identifier: string;
  name: string;
  description: string;
  node: string;
  allocation: string;
  suspended: boolean;
  installing: boolean;
  powerState: string;
  limits: { memoryMb: number; diskMb: number; cpuPercent: number };
  usage: null | { memoryMb: number; diskMb: number; cpuPercent: number; networkRxMb: number; networkTxMb: number; uptimeSeconds: number };
};

type Dashboard = {
  configured: boolean;
  powerActionsEnabled: boolean;
  panel: { url: string; reachable: boolean };
  summary: { totalServers: number; runningServers: number; suspendedServers: number; nodes: number };
  servers: Server[];
  error: string | null;
};

type Detail = {
  identifier: string;
  uuid: string;
  name: string;
  description: string;
  node: string;
  allocation: string;
  allocations: Array<{ id: string; label: string; ip: string; alias: string; port: number; notes: string; isDefault: boolean }>;
  suspended: boolean;
  installing: boolean;
  powerState: string;
  dockerImage: string;
  invocation: string;
  owner: boolean;
  limits: { memoryMb: number; diskMb: number; cpuPercent: number };
  featureLimits: { databases: number; allocations: number; backups: number };
  usage: Server["usage"];
  startupVariables: Array<{ name: string; env: string; value: string; defaultValue: string; editable: boolean; rules: string; description: string }>;
  databases: Array<{ id: string; name: string; username: string; address: string; maxConnections: number }>;
  schedules: Array<{ id: string; name: string; active: boolean; processing: boolean; onlyWhenOnline: boolean; cron: string; nextRunAt: string; lastRunAt: string; tasks: Array<{ id: string; sequenceId: number; action: string; payload: string; timeOffset: number; continueOnFailure: boolean }> }>;
  backups: Array<{ id: string; name: string; sizeMb: number; checksum: string; completedAt: string; createdAt: string; isLocked: boolean; isSuccessful: boolean }>;
  users: Array<{ id: string; username: string; email: string; permissions: string[]; twoFactorEnabled: boolean }>;
  activity: Array<{ id: string; event: string; description: string; source: string; createdAt: string }>;
};

type Files = {
  currentPath: string;
  entries: Array<{ name: string; path: string; type: "file" | "directory"; size: number; mode: string; mimeType: string; createdAt: string; updatedAt: string }>;
};

type Catalog = {
  users: Array<{ id: string; username: string; email: string; name: string }>;
  nodes: Array<{ id: string; name: string; fqdn: string; allocations: Array<{ id: string; label: string; assigned: boolean }> }>;
  nests: Array<{ id: string; name: string; eggs: Array<{ id: string; name: string; description: string }> }>;
};
type Egg = { dockerImage: string; startup: string; variables: Array<{ name: string; env: string; defaultValue: string; rules: string; description: string }> };
type Tab = "overview" | "console" | "files" | "startup" | "network" | "backups" | "schedules" | "databases" | "users" | "activity";
type ConsoleLine = { id: number; kind: "output" | "input" | "status"; text: string };

const tabs: Array<{ id: Tab; label: string }> = [
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

const defaultCreate = { name: "", description: "", userId: "", nestId: "", eggId: "", nodeId: "", allocationId: "", memory: "2048", disk: "10000", cpu: "0", dockerImage: "", startup: "" };
const defaultSchedule = { name: "", minute: "0", hour: "*", dayOfMonth: "*", month: "*", dayOfWeek: "*", onlyWhenOnline: true, isActive: true };
const permissionStarter = ["control.console", "control.start", "control.stop", "control.restart", "control.command", "file.read", "file.create", "file.update", "backup.read"].join(", ");

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: "include", headers: init?.body ? { "content-type": "application/json", ...(init?.headers ?? {}) } : init?.headers, ...init });
  if (!response.ok) {
    const raw = await response.text();
    try {
      const parsed = JSON.parse(raw) as { error?: string };
      throw new Error(parsed.error || raw || "Request failed");
    } catch {
      throw new Error(raw || "Request failed");
    }
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function statusTone(input: { suspended: boolean; powerState: string }) {
  if (input.suspended) return "warn";
  if (input.powerState === "running") return "good";
  if (input.powerState === "starting") return "warn";
  return "neutral";
}

function parentPath(value: string) {
  const parts = (value.startsWith("/") ? value : `/${value}`).split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

function formatUptime(seconds: number | undefined) {
  if (!seconds) return "N/A";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function isArchive(name: string) {
  return /\.(zip|tar|gz|tgz|7z|rar)$/i.test(name);
}

function parseAllocationLabel(label: string) {
  const index = label.lastIndexOf(":");
  if (index < 0) return { ip: label, port: 0 };
  return { ip: label.slice(0, index), port: Number(label.slice(index + 1)) || 0 };
}

export function GameControlPlane({ games, refresh }: { games: Dashboard | null; refresh: () => Promise<void> }) {
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [files, setFiles] = useState<Files | null>(null);
  const [directory, setDirectory] = useState("/");
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [selectedFileMode, setSelectedFileMode] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [command, setCommand] = useState("");
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [egg, setEgg] = useState<Egg | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [rename, setRename] = useState({ name: "", description: "" });
  const [dockerImage, setDockerImage] = useState("");
  const [startupValues, setStartupValues] = useState<Record<string, string>>({});
  const [allocationNotes, setAllocationNotes] = useState<Record<string, string>>({});
  const [folderName, setFolderName] = useState("");
  const [newFileName, setNewFileName] = useState("");
  const [renameTarget, setRenameTarget] = useState("");
  const [pullUrl, setPullUrl] = useState("");
  const [pullFileName, setPullFileName] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [databaseForm, setDatabaseForm] = useState({ database: "", remote: "%" });
  const [subuserForm, setSubuserForm] = useState({ email: "", permissions: permissionStarter });
  const [userPermissions, setUserPermissions] = useState<Record<string, string>>({});
  const [scheduleForm, setScheduleForm] = useState(defaultSchedule);
  const [taskForms, setTaskForms] = useState<Record<string, { action: string; payload: string; timeOffset: string; continueOnFailure: boolean }>>({});
  const [assignAllocationId, setAssignAllocationId] = useState("");
  const [create, setCreate] = useState(defaultCreate);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const streamRef = useRef<EventSource | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const consoleLineIdRef = useRef(0);

  const servers = games?.servers ?? [];
  const currentServer = servers.find((server) => server.identifier === selected) ?? null;
  const currentCatalogNode = catalog?.nodes.find((node) => node.name === detail?.node) ?? null;
  const currentNest = catalog?.nests.find((nest) => nest.id === create.nestId) ?? null;

  function appendConsoleLines(kind: ConsoleLine["kind"], lines: string[]) {
    const nextLines = lines
      .flatMap((line) => line.split("\n"))
      .map((line) => line.replace(/\r/g, ""))
      .filter((line) => line.trim().length > 0);
    if (!nextLines.length) return;
    setConsoleLines((currentValue) => [
      ...currentValue,
      ...nextLines.map((text) => ({ id: ++consoleLineIdRef.current, kind, text }))
    ].slice(-600));
  }

  async function loadCatalog() {
    const result = await api<Catalog>("/games/catalog");
    setCatalog(result);
  }

  async function loadServer(identifier: string, keepTab = false) {
    const result = await api<Detail>(`/games/servers/${identifier}`);
    setSelected(identifier);
    if (!keepTab) setTab("overview");
    setDetail(result);
    setRename({ name: result.name, description: result.description || "" });
    setDockerImage(result.dockerImage || "");
    setStartupValues(Object.fromEntries(result.startupVariables.map((variable) => [variable.env, variable.value || variable.defaultValue || ""])));
    setAllocationNotes(Object.fromEntries(result.allocations.map((allocation) => [allocation.id, allocation.notes])));
    setUserPermissions(Object.fromEntries(result.users.map((user) => [user.id, user.permissions.join(", ")])));
  }

  async function loadFiles(identifier: string, nextDirectory: string) {
    const result = await api<Files>(`/games/servers/${identifier}/files?directory=${encodeURIComponent(nextDirectory)}`);
    setFiles(result);
  }

  async function refreshSelection(options?: { keepTab?: boolean; refreshFiles?: boolean; refreshCatalog?: boolean }) {
    if (!selected) return;
    await Promise.all([
      refresh(),
      loadServer(selected, options?.keepTab ?? true),
      options?.refreshFiles ? loadFiles(selected, directory) : Promise.resolve(),
      options?.refreshCatalog ? loadCatalog() : Promise.resolve()
    ]);
  }

  async function runAction(task: () => Promise<unknown>, successMessage: string, options?: { keepTab?: boolean; refreshFiles?: boolean; refreshCatalog?: boolean }) {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await task();
      setMessage(successMessage);
      if (selected) await refreshSelection(options);
      else if (options?.refreshCatalog) await loadCatalog();
      else await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed");
    } finally {
      setLoading(false);
    }
  }

  function leaveWorkspace() {
    streamRef.current?.close();
    setSelected("");
    setDetail(null);
    setFiles(null);
    setSelectedFilePath("");
    setSelectedFileName("");
    setSelectedFileMode("");
    setFileContent("");
    setConsoleLines([]);
    setDirectory("/");
    setMessage("");
    setError("");
    setTab("overview");
  }

  useEffect(() => {
    void loadCatalog().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load game catalog"));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [consoleLines]);

  useEffect(() => {
    if (!showCreate || !catalog) return;
    setCreate((currentValue) => ({
      ...currentValue,
      userId: currentValue.userId || catalog.users[0]?.id || "",
      nestId: currentValue.nestId || catalog.nests[0]?.id || "",
      eggId: currentValue.eggId || catalog.nests[0]?.eggs[0]?.id || "",
      nodeId: currentValue.nodeId || catalog.nodes[0]?.id || "",
      allocationId: currentValue.allocationId || catalog.nodes[0]?.allocations.find((entry) => !entry.assigned)?.id || ""
    }));
  }, [catalog, showCreate]);

  useEffect(() => {
    if (!showCreate || !create.nestId || !create.eggId) return;
    void api<Egg>(`/games/nests/${create.nestId}/eggs/${create.eggId}`)
      .then((result) => {
        setEgg(result);
        setCreate((currentValue) => ({ ...currentValue, dockerImage: result.dockerImage, startup: result.startup }));
        setEnvValues(Object.fromEntries(result.variables.map((variable) => [variable.env, variable.defaultValue || ""])));
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load egg template"));
  }, [create.eggId, create.nestId, showCreate]);

  useEffect(() => {
    if (!selected || tab !== "console") return;
    setConsoleLines([]);
    const stream = new EventSource(`/api/games/servers/${selected}/console/stream`, { withCredentials: true });
    streamRef.current = stream;
    stream.addEventListener("line", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { lines?: string[] };
      appendConsoleLines("output", payload.lines ?? []);
    });
    stream.addEventListener("status", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { message?: string };
      if (payload.message) appendConsoleLines("status", [payload.message]);
    });
    stream.addEventListener("error", (event) => {
      const payload = JSON.parse((event as MessageEvent).data || "{\"message\":\"Console stream closed\"}") as { message?: string };
      if (payload.message) setError(payload.message);
    });
    return () => stream.close();
  }, [selected, tab]);

  useEffect(() => {
    if (!selected || tab !== "files") return;
    void loadFiles(selected, directory).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load files"));
  }, [directory, selected, tab]);

  async function openServerWorkspace(identifier: string) {
    setLoading(true);
    setError("");
    setMessage("");
    setSelectedFilePath("");
    setSelectedFileName("");
    setSelectedFileMode("");
    setFileContent("");
    setDirectory("/");
    try {
      await loadServer(identifier);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load server");
    } finally {
      setLoading(false);
    }
  }

  async function sendCommand(event: FormEvent) {
    event.preventDefault();
    if (!selected || !command.trim()) return;
    await runAction(async () => {
      await api(`/games/servers/${selected}/command`, { method: "POST", body: JSON.stringify({ command: command.trim() }) });
      appendConsoleLines("input", [`> ${command.trim()}`]);
      setCommand("");
    }, "Command sent", { keepTab: true });
  }

  async function saveIdentity(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    await runAction(() => api(`/games/servers/${selected}/settings/rename`, { method: "POST", body: JSON.stringify(rename) }), "Server settings updated", { keepTab: true });
  }

  async function saveImage(event: FormEvent) {
    event.preventDefault();
    if (!selected || !dockerImage.trim()) return;
    await runAction(() => api(`/games/servers/${selected}/settings/docker-image`, { method: "PUT", body: JSON.stringify({ dockerImage: dockerImage.trim() }) }), "Docker image updated", { keepTab: true });
  }

  async function saveStartupVariable(key: string) {
    if (!selected) return;
    await runAction(() => api(`/games/servers/${selected}/startup/variable`, { method: "PUT", body: JSON.stringify({ key, value: startupValues[key] ?? "" }) }), `Updated ${key}`, { keepTab: true });
  }

  async function triggerReinstall() {
    if (!selected) return;
    await runAction(() => api(`/games/servers/${selected}/settings/reinstall`, { method: "POST", body: JSON.stringify({}) }), "Reinstall requested", { keepTab: true });
  }

  async function power(signal: "start" | "stop" | "restart" | "kill") {
    if (!selected) return;
    await runAction(() => api(`/games/servers/${selected}/power`, { method: "POST", body: JSON.stringify({ signal }) }), `Power action sent: ${signal}`, { keepTab: true });
  }

  async function openFile(path: string, name: string, mode: string) {
    if (!selected) return;
    setSelectedFilePath(path);
    setSelectedFileName(name);
    setSelectedFileMode(mode);
    const result = await api<{ path: string; content: string }>(`/games/servers/${selected}/file?path=${encodeURIComponent(path)}`);
    setFileContent(result.content);
    setRenameTarget(name);
  }

  async function createFolder(event: FormEvent) {
    event.preventDefault();
    if (!selected || !folderName.trim()) return;
    const nextName = folderName.trim();
    await runAction(async () => {
      await api(`/games/servers/${selected}/files/folders`, { method: "POST", body: JSON.stringify({ directory, name: nextName }) });
      setFolderName("");
    }, `Folder created: ${nextName}`, { keepTab: true, refreshFiles: true });
  }

  async function uploadSelectedFile(event: FormEvent) {
    event.preventDefault();
    if (!selected || !uploadFiles.length) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const body = new FormData();
      body.append("directory", directory);
      for (const file of uploadFiles) {
        body.append("files", file);
      }
      const response = await fetch(`/api/games/servers/${selected}/files/upload`, { method: "POST", credentials: "include", body });
      if (!response.ok) throw new Error(await response.text());
      setUploadFiles([]);
      setMessage(`Uploaded ${uploadFiles.length} file(s)`);
      await refreshSelection({ keepTab: true, refreshFiles: true });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload file");
    } finally {
      setLoading(false);
    }
  }

  async function createFile(event: FormEvent) {
    event.preventDefault();
    if (!selected || !newFileName.trim()) return;
    const nextName = newFileName.trim();
    const filePath = `${directory === "/" ? "" : directory}/${nextName}` || "/";
    await runAction(async () => {
      await api(`/games/servers/${selected}/file`, { method: "POST", body: JSON.stringify({ path: filePath, content: "" }) });
      setNewFileName("");
      setSelectedFilePath(filePath);
      setSelectedFileName(nextName);
      setSelectedFileMode("644");
      setFileContent("");
    }, `Created ${nextName}`, { keepTab: true, refreshFiles: true });
  }

  async function saveFile() {
    if (!selected || !selectedFilePath) return;
    await runAction(() => api(`/games/servers/${selected}/file`, { method: "POST", body: JSON.stringify({ path: selectedFilePath, content: fileContent }) }), `Saved ${selectedFileName || selectedFilePath}`, { keepTab: true, refreshFiles: true });
  }

  async function deleteFile(name: string) {
    if (!selected || !window.confirm(`Delete ${name}?`)) return;
    await runAction(() => api(`/games/servers/${selected}/files`, { method: "DELETE", body: JSON.stringify({ directory, files: [name] }) }), `Deleted ${name}`, { keepTab: true, refreshFiles: true });
    if (selectedFileName === name) {
      setSelectedFilePath("");
      setSelectedFileName("");
      setSelectedFileMode("");
      setFileContent("");
    }
  }

  async function renameSelectedFile(event: FormEvent) {
    event.preventDefault();
    if (!selected || !selectedFileName || !renameTarget.trim()) return;
    const nextName = renameTarget.trim();
    await runAction(() => api(`/games/servers/${selected}/files/rename`, { method: "PUT", body: JSON.stringify({ directory, from: selectedFileName, to: nextName }) }), `Renamed to ${nextName}`, { keepTab: true, refreshFiles: true });
    setSelectedFilePath(`${directory === "/" ? "" : directory}/${nextName}`);
    setSelectedFileName(nextName);
  }

  async function compressSelectedFile() {
    if (!selected || !selectedFileName) return;
    await runAction(() => api(`/games/servers/${selected}/files/compress`, { method: "POST", body: JSON.stringify({ directory, files: [selectedFileName] }) }), `Compressed ${selectedFileName}`, { keepTab: true, refreshFiles: true });
  }

  async function decompressSelectedFile() {
    if (!selected || !selectedFileName) return;
    await runAction(() => api(`/games/servers/${selected}/files/decompress`, { method: "POST", body: JSON.stringify({ directory, file: selectedFileName }) }), `Extracted ${selectedFileName}`, { keepTab: true, refreshFiles: true });
  }

  async function chmodSelectedFile() {
    if (!selected || !selectedFileName || !selectedFileMode.trim()) return;
    await runAction(() => api(`/games/servers/${selected}/files/chmod`, { method: "POST", body: JSON.stringify({ directory, file: selectedFileName, mode: selectedFileMode.trim() }) }), `Updated mode for ${selectedFileName}`, { keepTab: true, refreshFiles: true });
  }

  async function pullRemoteFile(event: FormEvent) {
    event.preventDefault();
    if (!selected || !pullUrl.trim() || !pullFileName.trim()) return;
    const nextName = pullFileName.trim();
    await runAction(async () => {
      await api(`/games/servers/${selected}/files/pull`, { method: "POST", body: JSON.stringify({ directory, url: pullUrl.trim(), filename: nextName }) });
      setPullUrl("");
      setPullFileName("");
    }, `Pulled ${nextName}`, { keepTab: true, refreshFiles: true });
  }

  function downloadSelectedFile() {
    if (!selected || !selectedFilePath) return;
    window.open(`/api/games/servers/${selected}/files/download?path=${encodeURIComponent(selectedFilePath)}`, "_blank", "noopener");
  }

  async function createBackup() {
    if (!selected) return;
    await runAction(() => api(`/games/servers/${selected}/backups`, { method: "POST", body: JSON.stringify({}) }), "Backup requested", { keepTab: true });
  }

  async function openBackupDownload(backupId: string) {
    if (!selected) return;
    try {
      const result = await api<{ url: string }>(`/games/servers/${selected}/backups/${backupId}/download`);
      if (result.url) window.open(result.url, "_blank", "noopener");
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Unable to download backup");
    }
  }

  async function restoreBackup(backupId: string) {
    if (!selected || !window.confirm("Restore this backup and overwrite current files?")) return;
    await runAction(() => api(`/games/servers/${selected}/backups/${backupId}/restore`, { method: "POST", body: JSON.stringify({ truncate: true }) }), "Backup restore requested", { keepTab: true });
  }

  async function toggleBackupLock(backupId: string) {
    if (!selected) return;
    await runAction(() => api(`/games/servers/${selected}/backups/${backupId}/lock`, { method: "POST", body: JSON.stringify({}) }), "Backup lock updated", { keepTab: true });
  }

  async function deleteBackup(backupId: string) {
    if (!selected || !window.confirm("Delete this backup?")) return;
    await runAction(() => api(`/games/servers/${selected}/backups/${backupId}`, { method: "DELETE", body: JSON.stringify({}) }), "Backup deleted", { keepTab: true });
  }

  async function createDatabase(event: FormEvent) {
    event.preventDefault();
    if (!selected || !databaseForm.database.trim()) return;
    const nextName = databaseForm.database.trim();
    await runAction(async () => {
      const result = await api<{ attributes?: { password?: string } }>(`/games/servers/${selected}/databases`, { method: "POST", body: JSON.stringify({ database: nextName, remote: databaseForm.remote.trim() || "%" }) });
      setDatabaseForm({ database: "", remote: "%" });
      if (result?.attributes?.password) setMessage(`Database created. Generated password: ${result.attributes.password}`);
    }, "Database created", { keepTab: true });
  }

  async function rotateDatabasePassword(databaseId: string) {
    if (!selected) return;
    await runAction(async () => {
      const result = await api<{ attributes?: { password?: string } }>(`/games/servers/${selected}/databases/${databaseId}/rotate-password`, { method: "POST", body: JSON.stringify({}) });
      if (result?.attributes?.password) setMessage(`Database password rotated: ${result.attributes.password}`);
    }, "Database password rotated", { keepTab: true });
  }

  async function deleteDatabase(databaseId: string) {
    if (!selected || !window.confirm("Delete this database?")) return;
    await runAction(() => api(`/games/servers/${selected}/databases/${databaseId}`, { method: "DELETE", body: JSON.stringify({}) }), "Database deleted", { keepTab: true });
  }

  async function createSubuser(event: FormEvent) {
    event.preventDefault();
    if (!selected || !subuserForm.email.trim()) return;
    const permissions = subuserForm.permissions.split(",").map((entry) => entry.trim()).filter(Boolean);
    if (!permissions.length) {
      setError("Enter at least one subuser permission.");
      return;
    }
    await runAction(async () => {
      await api(`/games/servers/${selected}/users`, { method: "POST", body: JSON.stringify({ email: subuserForm.email.trim(), permissions }) });
      setSubuserForm({ email: "", permissions: permissionStarter });
    }, "Subuser created", { keepTab: true });
  }

  async function updateSubuser(userId: string) {
    if (!selected) return;
    const permissions = (userPermissions[userId] ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
    await runAction(() => api(`/games/servers/${selected}/users/${userId}`, { method: "PUT", body: JSON.stringify({ permissions }) }), "Subuser updated", { keepTab: true });
  }

  async function deleteSubuser(userId: string) {
    if (!selected || !window.confirm("Delete this subuser?")) return;
    await runAction(() => api(`/games/servers/${selected}/users/${userId}`, { method: "DELETE", body: JSON.stringify({}) }), "Subuser deleted", { keepTab: true });
  }

  async function createSchedule(event: FormEvent) {
    event.preventDefault();
    if (!selected || !scheduleForm.name.trim()) return;
    await runAction(async () => {
      await api(`/games/servers/${selected}/schedules`, { method: "POST", body: JSON.stringify(scheduleForm) });
      setScheduleForm(defaultSchedule);
    }, "Schedule created", { keepTab: true });
  }

  async function executeSchedule(scheduleId: string) {
    if (!selected) return;
    await runAction(() => api(`/games/servers/${selected}/schedules/${scheduleId}/execute`, { method: "POST", body: JSON.stringify({}) }), "Schedule triggered", { keepTab: true });
  }

  async function deleteSchedule(scheduleId: string) {
    if (!selected || !window.confirm("Delete this schedule?")) return;
    await runAction(() => api(`/games/servers/${selected}/schedules/${scheduleId}`, { method: "DELETE", body: JSON.stringify({}) }), "Schedule deleted", { keepTab: true });
  }

  async function createScheduleTask(event: FormEvent, scheduleId: string) {
    event.preventDefault();
    if (!selected) return;
    const task = taskForms[scheduleId] ?? { action: "", payload: "", timeOffset: "0", continueOnFailure: false };
    if (!task.action.trim()) {
      setError("Schedule task action is required.");
      return;
    }
    await runAction(async () => {
      await api(`/games/servers/${selected}/schedules/${scheduleId}/tasks`, { method: "POST", body: JSON.stringify({ action: task.action.trim(), payload: task.payload, timeOffset: Number(task.timeOffset || "0"), continueOnFailure: task.continueOnFailure }) });
      setTaskForms((currentValue) => ({ ...currentValue, [scheduleId]: { action: "", payload: "", timeOffset: "0", continueOnFailure: false } }));
    }, "Schedule task created", { keepTab: true });
  }

  async function deleteScheduleTask(scheduleId: string, taskId: string) {
    if (!selected) return;
    await runAction(() => api(`/games/servers/${selected}/schedules/${scheduleId}/tasks/${taskId}`, { method: "DELETE", body: JSON.stringify({}) }), "Schedule task deleted", { keepTab: true });
  }

  async function assignAllocation(event: FormEvent) {
    event.preventDefault();
    if (!selected || !assignAllocationId) return;
    const label = currentCatalogNode?.allocations.find((allocation) => allocation.id === assignAllocationId)?.label;
    if (!label) return;
    const parsed = parseAllocationLabel(label);
    await runAction(() => api(`/games/servers/${selected}/network/allocations`, { method: "POST", body: JSON.stringify({ ip: parsed.ip, port: parsed.port }) }), "Allocation assigned", { keepTab: true, refreshCatalog: true });
    setAssignAllocationId("");
  }

  async function saveAllocationNotes(allocationId: string) {
    if (!selected) return;
    await runAction(() => api(`/games/servers/${selected}/network/allocations/${allocationId}`, { method: "POST", body: JSON.stringify({ notes: allocationNotes[allocationId] ?? "" }) }), "Allocation notes updated", { keepTab: true });
  }

  async function makePrimaryAllocation(allocationId: string) {
    if (!selected) return;
    await runAction(() => api(`/games/servers/${selected}/network/allocations/${allocationId}/primary`, { method: "POST", body: JSON.stringify({}) }), "Primary allocation updated", { keepTab: true });
  }

  async function removeAllocation(allocationId: string) {
    if (!selected || !window.confirm("Remove this allocation from the server?")) return;
    await runAction(() => api(`/games/servers/${selected}/network/allocations/${allocationId}`, { method: "DELETE", body: JSON.stringify({}) }), "Allocation removed", { keepTab: true, refreshCatalog: true });
  }

  async function createServer(event: FormEvent) {
    event.preventDefault();
    await runAction(async () => {
      await api("/games/servers", { method: "POST", body: JSON.stringify({ name: create.name, description: create.description, userId: Number(create.userId), eggId: Number(create.eggId), dockerImage: create.dockerImage || undefined, startup: create.startup || undefined, environment: envValues, limits: { memory: Number(create.memory), disk: Number(create.disk), cpu: Number(create.cpu), swap: 0, io: 500 }, featureLimits: { databases: 0, allocations: 0, backups: 0 }, allocation: { default: Number(create.allocationId), additional: [] } }) });
      setShowCreate(false);
      setCreate(defaultCreate);
      setEnvValues({});
      setEgg(null);
    }, "Server created", { refreshCatalog: true });
  }

  return (
    <section className="content-grid">
      <section className="panel wide">
        <div className="panel-head">
          <h2>Game Control Plane</h2>
        </div>
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

          {!selected ? (
            <>
              <div className="game-list-toolbar">
                <div>
                  <h3>Servers</h3>
                  <p className="subcopy">Open one server to enter its management workspace. Server creation stays in this tab too.</p>
                </div>
                <button type="button" onClick={() => setShowCreate((currentValue) => !currentValue)}>{showCreate ? "Close Builder" : "Create Server"}</button>
              </div>

              {showCreate ? (
                <div className="panel wide game-create-panel">
                  <div className="panel-head"><h2>Create Server</h2></div>
                  <div className="panel-body">
                    <form className="game-create-form" onSubmit={(event) => void createServer(event)}>
                      <div className="game-form-grid">
                        <label className="game-variable-input"><span>Server Name</span><input value={create.name} onChange={(event) => setCreate((currentValue) => ({ ...currentValue, name: event.target.value }))} /></label>
                        <label className="game-variable-input"><span>Description</span><input value={create.description} onChange={(event) => setCreate((currentValue) => ({ ...currentValue, description: event.target.value }))} /></label>
                        <label className="game-variable-input"><span>User</span><select value={create.userId} onChange={(event) => setCreate((currentValue) => ({ ...currentValue, userId: event.target.value }))}><option value="">Select user</option>{(catalog?.users ?? []).map((user) => <option key={user.id} value={user.id}>{user.name} ({user.username})</option>)}</select></label>
                        <label className="game-variable-input"><span>Nest</span><select value={create.nestId} onChange={(event) => setCreate((currentValue) => ({ ...currentValue, nestId: event.target.value, eggId: "" }))}><option value="">Select nest</option>{(catalog?.nests ?? []).map((nest) => <option key={nest.id} value={nest.id}>{nest.name}</option>)}</select></label>
                        <label className="game-variable-input"><span>Egg</span><select value={create.eggId} onChange={(event) => setCreate((currentValue) => ({ ...currentValue, eggId: event.target.value }))}><option value="">Select egg</option>{(currentNest?.eggs ?? []).map((eggEntry) => <option key={eggEntry.id} value={eggEntry.id}>{eggEntry.name}</option>)}</select></label>
                        <label className="game-variable-input"><span>Node</span><select value={create.nodeId} onChange={(event) => setCreate((currentValue) => ({ ...currentValue, nodeId: event.target.value, allocationId: "" }))}><option value="">Select node</option>{(catalog?.nodes ?? []).map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
                        <label className="game-variable-input"><span>Allocation</span><select value={create.allocationId} onChange={(event) => setCreate((currentValue) => ({ ...currentValue, allocationId: event.target.value }))}><option value="">Select allocation</option>{(catalog?.nodes.find((node) => node.id === create.nodeId)?.allocations ?? []).filter((allocation) => !allocation.assigned).map((allocation) => <option key={allocation.id} value={allocation.id}>{allocation.label}</option>)}</select></label>
                        <label className="game-variable-input"><span>Memory (MB)</span><input value={create.memory} onChange={(event) => setCreate((currentValue) => ({ ...currentValue, memory: event.target.value }))} /></label>
                        <label className="game-variable-input"><span>Disk (MB)</span><input value={create.disk} onChange={(event) => setCreate((currentValue) => ({ ...currentValue, disk: event.target.value }))} /></label>
                        <label className="game-variable-input"><span>CPU Limit</span><input value={create.cpu} onChange={(event) => setCreate((currentValue) => ({ ...currentValue, cpu: event.target.value }))} /></label>
                        <label className="game-variable-input"><span>Docker Image</span><input value={create.dockerImage} onChange={(event) => setCreate((currentValue) => ({ ...currentValue, dockerImage: event.target.value }))} /></label>
                      </div>
                      <label className="game-variable-input"><span>Startup Command</span><textarea className="config-editor compact-editor" value={create.startup} onChange={(event) => setCreate((currentValue) => ({ ...currentValue, startup: event.target.value }))} /></label>
                      {egg?.variables.length ? <div className="game-create-variable-grid">{egg.variables.map((variable) => <label key={variable.env} className="game-variable-input"><span>{variable.name}</span><input value={envValues[variable.env] ?? ""} onChange={(event) => setEnvValues((currentValue) => ({ ...currentValue, [variable.env]: event.target.value }))} /></label>)}</div> : null}
                      <div className="button-row"><button type="submit" disabled={loading}>Create Server</button></div>
                    </form>
                  </div>
                </div>
              ) : null}

              <div className="game-server-card-grid">
                {servers.map((server) => (
                  <button key={server.identifier} type="button" className="game-server-card-button" onClick={() => void openServerWorkspace(server.identifier)}>
                    <div className="service-top">
                      <div><strong>{server.name}</strong><p>{server.description || "No description"}</p></div>
                      <span className={`badge ${statusTone(server)}`}>{server.suspended ? "Suspended" : server.powerState}</span>
                    </div>
                    <div className="game-server-card-meta">
                      <div><span>Allocation</span><strong>{server.allocation}</strong></div>
                      <div><span>Node</span><strong>{server.node}</strong></div>
                      <div><span>Memory</span><strong>{server.limits.memoryMb} MB</strong></div>
                      <div><span>Disk</span><strong>{server.limits.diskMb} MB</strong></div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="game-manager-shell">
              <aside className="game-sidebar">
                <div className="mini-surface">
                  <div className="service-top">
                    <div><strong>Server Workspace</strong><p>Switch servers without leaving the Games tab.</p></div>
                    <button type="button" className="game-back-button" onClick={leaveWorkspace}>Close</button>
                  </div>
                </div>
                {servers.map((server) => (
                  <button key={server.identifier} type="button" className={`game-server-list-item ${server.identifier === selected ? "active" : ""}`} onClick={() => void openServerWorkspace(server.identifier)}>
                    <div><strong>{server.name}</strong><p>{server.allocation}</p></div>
                    <span className={`badge ${statusTone(server)}`}>{server.powerState}</span>
                  </button>
                ))}
              </aside>

              <div className="game-manager-main">
                <div className="game-detail-hero">
                  <div>
                    <span className="eyebrow">Selected Server</span>
                    <h3>{detail?.name ?? currentServer?.name}</h3>
                    <p>{detail?.description || currentServer?.description || "No description"}</p>
                    <p>{detail?.allocation ?? currentServer?.allocation} on {detail?.node ?? currentServer?.node}</p>
                  </div>
                  <div className="game-detail-actions">
                    <button type="button" disabled={!games?.powerActionsEnabled || loading} onClick={() => void power("start")}>Start</button>
                    <button type="button" disabled={!games?.powerActionsEnabled || loading} onClick={() => void power("restart")}>Restart</button>
                    <button type="button" disabled={!games?.powerActionsEnabled || loading} onClick={() => void power("stop")}>Stop</button>
                    <button type="button" disabled={!games?.powerActionsEnabled || loading} onClick={() => void power("kill")}>Kill</button>
                  </div>
                </div>

                <div className="game-detail-grid">
                  <div className="mini-surface"><span className="eyebrow">Status</span><strong>{detail?.powerState ?? currentServer?.powerState ?? "unknown"}</strong><p>{detail?.installing ? "Install in progress" : detail?.owner ? "Owner access" : "Connected through API"}</p></div>
                  <div className="mini-surface"><span className="eyebrow">Memory</span><strong>{Math.round(detail?.usage?.memoryMb ?? currentServer?.usage?.memoryMb ?? 0)} MB</strong><p>Limit {detail?.limits.memoryMb ?? currentServer?.limits.memoryMb ?? 0} MB</p></div>
                  <div className="mini-surface"><span className="eyebrow">Disk</span><strong>{Math.round(detail?.usage?.diskMb ?? currentServer?.usage?.diskMb ?? 0)} MB</strong><p>Limit {detail?.limits.diskMb ?? currentServer?.limits.diskMb ?? 0} MB</p></div>
                  <div className="mini-surface"><span className="eyebrow">Uptime</span><strong>{formatUptime(detail?.usage?.uptimeSeconds ?? currentServer?.usage?.uptimeSeconds)}</strong><p>{detail?.uuid || currentServer?.id || "Unknown server"}</p></div>
                </div>

                <div className="game-tab-row">
                  {tabs.map((entry) => <button key={entry.id} type="button" className={`game-tab-button ${tab === entry.id ? "active" : ""}`} onClick={() => setTab(entry.id)}>{entry.label}</button>)}
                </div>

                {!detail ? <p className="subcopy">Loading server details...</p> : (
                  <>
                    {tab === "overview" ? (
                      <div className="game-section-grid">
                        <div className="panel"><div className="panel-head"><h2>Identity</h2></div><div className="panel-body"><form className="game-stack-form" onSubmit={(event) => void saveIdentity(event)}><label className="game-variable-input"><span>Server Name</span><input value={rename.name} onChange={(event) => setRename((currentValue) => ({ ...currentValue, name: event.target.value }))} /></label><label className="game-variable-input"><span>Description</span><textarea className="config-editor compact-editor" value={rename.description} onChange={(event) => setRename((currentValue) => ({ ...currentValue, description: event.target.value }))} /></label><button type="submit" disabled={loading}>Save Identity</button></form></div></div>
                        <div className="panel"><div className="panel-head"><h2>Runtime</h2></div><div className="panel-body"><form className="game-stack-form" onSubmit={(event) => void saveImage(event)}><label className="game-variable-input"><span>Docker Image</span><input value={dockerImage} onChange={(event) => setDockerImage(event.target.value)} /></label><label className="game-variable-input"><span>Startup Command</span><textarea className="config-editor compact-editor" value={detail.invocation} readOnly /></label><div className="button-row"><button type="submit" disabled={loading}>Save Image</button><button type="button" onClick={() => void triggerReinstall()} disabled={loading}>Reinstall Server</button></div></form></div></div>
                      </div>
                    ) : null}

                    {tab === "console" ? (
                      <div className="game-console-shell">
                        <div className="log-screen game-console-screen">
                          {consoleLines.length ? consoleLines.map((line) => <div key={line.id} className={`game-console-line game-console-line-${line.kind}`}>{line.text}</div>) : <div className="game-console-empty">Waiting for console output...</div>}
                          <div ref={endRef} />
                        </div>
                        <form className="game-command-row" onSubmit={(event) => void sendCommand(event)}><input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="say hello from CloudOS" /><button type="submit" disabled={loading}>Send Command</button></form>
                      </div>
                    ) : null}

                    {tab === "files" ? (
                      <div className="game-files-shell">
                        <div className="game-files-toolbar">
                          <div className="game-breadcrumbs">{[{ label: "/", path: "/" }, ...directory.split("/").filter(Boolean).map((entry, index, parts) => ({ label: entry, path: `/${parts.slice(0, index + 1).join("/")}` }))].map((crumb) => <button key={crumb.path} type="button" className="game-crumb" onClick={() => setDirectory(crumb.path)}>{crumb.label}</button>)}</div>
                          <div className="button-row"><button type="button" onClick={() => setDirectory(parentPath(directory))}>Up</button><button type="button" onClick={() => void loadFiles(selected, directory)}>Refresh</button></div>
                        </div>
                        <div className="game-files-grid">
                          <div className="mini-surface">
                            <div className="game-toolbar-inline">
                              <form className="game-inline-form" onSubmit={(event) => void createFolder(event)}><input value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="New folder" /><button type="submit" disabled={loading}>Create Folder</button></form>
                              <form className="game-inline-form" onSubmit={(event) => void createFile(event)}><input value={newFileName} onChange={(event) => setNewFileName(event.target.value)} placeholder="New file" /><button type="submit" disabled={loading}>Create File</button></form>
                              <form className="game-inline-form" onSubmit={(event) => void pullRemoteFile(event)}><input value={pullUrl} onChange={(event) => setPullUrl(event.target.value)} placeholder="https://example.com/file.jar" /><input value={pullFileName} onChange={(event) => setPullFileName(event.target.value)} placeholder="filename.jar" /><button type="submit" disabled={loading}>Pull Remote</button></form>
                              <form className="game-inline-form" onSubmit={(event) => void uploadSelectedFile(event)}><input type="file" multiple onChange={(event) => setUploadFiles(Array.from(event.target.files ?? []))} /><button type="submit" disabled={loading || !uploadFiles.length}>Upload Files</button></form>
                            </div>
                            <div className="game-file-list game-scroll-pane">{(files?.entries ?? []).map((entry) => <div key={entry.path} className={`game-file-row ${entry.path === selectedFilePath ? "game-file-row-active" : ""}`}><button type="button" className="game-file-open" onClick={() => { setSelectedFileName(entry.name); setRenameTarget(entry.name); setSelectedFileMode(entry.mode || "644"); if (entry.type === "directory") setDirectory(entry.path); else void openFile(entry.path, entry.name, entry.mode); }}><strong>{entry.name}</strong><span>{entry.type === "directory" ? "Directory" : `${entry.size} bytes`}</span></button><div className="game-row-actions">{entry.type === "file" ? <button type="button" className="small-button" onClick={() => window.open(`/api/games/servers/${selected}/files/download?path=${encodeURIComponent(entry.path)}`, "_blank", "noopener")}>Download</button> : null}<button type="button" className="small-button" onClick={() => void deleteFile(entry.name)}>Delete</button></div></div>)}</div>
                          </div>
                          <div className="mini-surface">
                            <div className="info-row"><span>Selected Entry</span><strong>{selectedFileName || "None"}</strong></div>
                            {selectedFileName ? <>
                              <form className="game-inline-form" onSubmit={(event) => void renameSelectedFile(event)}><input value={renameTarget} onChange={(event) => setRenameTarget(event.target.value)} placeholder="Rename entry" /><button type="submit" disabled={loading}>Rename</button></form>
                              <form className="game-inline-form" onSubmit={(event) => { event.preventDefault(); void chmodSelectedFile(); }}><input value={selectedFileMode} onChange={(event) => setSelectedFileMode(event.target.value)} placeholder="644" /><button type="submit" disabled={loading}>Chmod</button><button type="button" onClick={downloadSelectedFile}>Download</button><button type="button" onClick={() => void compressSelectedFile()} disabled={loading}>Compress</button>{isArchive(selectedFileName) ? <button type="button" onClick={() => void decompressSelectedFile()} disabled={loading}>Extract</button> : null}</form>
                            </> : null}
                            <textarea className="config-editor game-file-textarea" value={fileContent} onChange={(event) => setFileContent(event.target.value)} placeholder="Select a text file to edit it here." />
                            <div className="button-row"><button type="button" disabled={!selectedFilePath || loading} onClick={() => void saveFile()}>Save File</button></div>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {tab === "startup" ? (
                      <div className="panel wide"><div className="panel-head"><h2>Startup And Runtime</h2></div><div className="panel-body"><div className="info-row"><span>Docker Image</span><strong>{detail.dockerImage || "Unknown"}</strong></div><div className="info-row"><span>Invocation</span><strong>{detail.invocation || "Unavailable"}</strong></div>{detail.startupVariables.map((variable) => <div key={variable.env} className="info-row stacked-row"><div><strong>{variable.name}</strong><p>{variable.description || variable.env}</p></div><div className="game-variable-values editable"><span>{variable.env}</span><input value={startupValues[variable.env] ?? ""} onChange={(event) => setStartupValues((currentValue) => ({ ...currentValue, [variable.env]: event.target.value }))} disabled={!variable.editable} /><button type="button" disabled={!variable.editable || loading} onClick={() => void saveStartupVariable(variable.env)}>Save</button></div></div>)}</div></div>
                    ) : null}

                    {tab === "network" ? (
                      <div className="game-section-grid">
                        <div className="panel"><div className="panel-head"><h2>Allocations</h2></div><div className="panel-body game-scroll-pane">{detail.allocations.map((allocation) => <div key={allocation.id} className="game-schedule-card"><div className="service-top"><div><strong>{allocation.label}</strong><p>{allocation.isDefault ? "Primary allocation" : "Secondary allocation"}</p></div><div className="button-row">{!allocation.isDefault ? <button type="button" className="small-button" onClick={() => void makePrimaryAllocation(allocation.id)}>Make Primary</button> : null}{!allocation.isDefault ? <button type="button" className="small-button" onClick={() => void removeAllocation(allocation.id)}>Remove</button> : null}</div></div><div className="game-inline-form"><input value={allocationNotes[allocation.id] ?? ""} onChange={(event) => setAllocationNotes((currentValue) => ({ ...currentValue, [allocation.id]: event.target.value }))} placeholder="Notes" /><button type="button" onClick={() => void saveAllocationNotes(allocation.id)}>Save Notes</button></div></div>)}</div></div>
                        <div className="panel"><div className="panel-head"><h2>Assign Allocation</h2></div><div className="panel-body"><form className="game-stack-form" onSubmit={(event) => void assignAllocation(event)}><label className="game-variable-input"><span>Available Node Allocation</span><select value={assignAllocationId} onChange={(event) => setAssignAllocationId(event.target.value)}><option value="">Select allocation</option>{(currentCatalogNode?.allocations ?? []).filter((allocation) => !allocation.assigned).map((allocation) => <option key={allocation.id} value={allocation.id}>{allocation.label}</option>)}</select></label><button type="submit" disabled={loading}>Assign Allocation</button></form><div className="game-detail-grid"><div className="mini-surface"><span className="eyebrow">Current Primary</span><strong>{detail.allocation}</strong><p>{detail.featureLimits.allocations} allocation slots available</p></div><div className="mini-surface"><span className="eyebrow">Traffic</span><strong>{(detail.usage?.networkRxMb ?? 0).toFixed(1)} / {(detail.usage?.networkTxMb ?? 0).toFixed(1)} MB</strong><p>Rx / Tx</p></div></div></div></div>
                      </div>
                    ) : null}

                    {tab === "backups" ? (
                      <div className="panel wide"><div className="panel-head"><h2>Backups</h2></div><div className="panel-body"><div className="button-row"><button type="button" onClick={() => void createBackup()} disabled={loading}>Create Backup</button></div>{detail.backups.length ? detail.backups.map((backup) => <div key={backup.id} className="game-schedule-card"><div className="service-top"><div><strong>{backup.name}</strong><p>{backup.createdAt} · {backup.sizeMb.toFixed(1)} MB</p></div><span className={`badge ${backup.isSuccessful ? "good" : "warn"}`}>{backup.isLocked ? "Locked" : backup.isSuccessful ? "Ready" : "Pending"}</span></div><div className="game-schedule-meta"><span>Checksum: {backup.checksum}</span><span>Completed: {backup.completedAt}</span></div><div className="button-row"><button type="button" className="small-button" onClick={() => void openBackupDownload(backup.id)}>Download</button><button type="button" className="small-button" onClick={() => void restoreBackup(backup.id)}>Restore</button><button type="button" className="small-button" onClick={() => void toggleBackupLock(backup.id)}>{backup.isLocked ? "Unlock" : "Lock"}</button><button type="button" className="small-button" onClick={() => void deleteBackup(backup.id)}>Delete</button></div></div>) : <p className="subcopy">No backups found.</p>}</div></div>
                    ) : null}

                    {tab === "schedules" ? (
                      <div className="game-section-grid">
                        <div className="panel"><div className="panel-head"><h2>Create Schedule</h2></div><div className="panel-body"><form className="game-stack-form" onSubmit={(event) => void createSchedule(event)}><div className="game-form-grid"><label className="game-variable-input"><span>Name</span><input value={scheduleForm.name} onChange={(event) => setScheduleForm((currentValue) => ({ ...currentValue, name: event.target.value }))} /></label><label className="game-variable-input"><span>Minute</span><input value={scheduleForm.minute} onChange={(event) => setScheduleForm((currentValue) => ({ ...currentValue, minute: event.target.value }))} /></label><label className="game-variable-input"><span>Hour</span><input value={scheduleForm.hour} onChange={(event) => setScheduleForm((currentValue) => ({ ...currentValue, hour: event.target.value }))} /></label><label className="game-variable-input"><span>Day Of Month</span><input value={scheduleForm.dayOfMonth} onChange={(event) => setScheduleForm((currentValue) => ({ ...currentValue, dayOfMonth: event.target.value }))} /></label><label className="game-variable-input"><span>Month</span><input value={scheduleForm.month} onChange={(event) => setScheduleForm((currentValue) => ({ ...currentValue, month: event.target.value }))} /></label><label className="game-variable-input"><span>Day Of Week</span><input value={scheduleForm.dayOfWeek} onChange={(event) => setScheduleForm((currentValue) => ({ ...currentValue, dayOfWeek: event.target.value }))} /></label></div><button type="submit" disabled={loading}>Create Schedule</button></form></div></div>
                        <div className="panel"><div className="panel-head"><h2>Existing Schedules</h2></div><div className="panel-body">{detail.schedules.length ? detail.schedules.map((schedule) => { const taskForm = taskForms[schedule.id] ?? { action: "", payload: "", timeOffset: "0", continueOnFailure: false }; return <div key={schedule.id} className="game-schedule-card"><div className="service-top"><div><strong>{schedule.name}</strong><p>{schedule.cron} · next {schedule.nextRunAt}</p></div><span className={`badge ${schedule.active ? "good" : "neutral"}`}>{schedule.active ? "Active" : "Paused"}</span></div><div className="button-row"><button type="button" className="small-button" onClick={() => void executeSchedule(schedule.id)}>Run Now</button><button type="button" className="small-button" onClick={() => void deleteSchedule(schedule.id)}>Delete</button></div>{schedule.tasks.map((task) => <div key={task.id} className="info-row"><span>{task.sequenceId}. {task.action}</span><div className="button-row"><strong>{task.payload || "No payload"}</strong><button type="button" className="small-button" onClick={() => void deleteScheduleTask(schedule.id, task.id)}>Remove Task</button></div></div>)}<form className="game-stack-form" onSubmit={(event) => void createScheduleTask(event, schedule.id)}><div className="game-form-grid"><label className="game-variable-input"><span>Action</span><input value={taskForm.action} onChange={(event) => setTaskForms((currentValue) => ({ ...currentValue, [schedule.id]: { ...taskForm, action: event.target.value } }))} /></label><label className="game-variable-input"><span>Payload</span><input value={taskForm.payload} onChange={(event) => setTaskForms((currentValue) => ({ ...currentValue, [schedule.id]: { ...taskForm, payload: event.target.value } }))} /></label><label className="game-variable-input"><span>Time Offset (seconds)</span><input value={taskForm.timeOffset} onChange={(event) => setTaskForms((currentValue) => ({ ...currentValue, [schedule.id]: { ...taskForm, timeOffset: event.target.value } }))} /></label></div><button type="submit" disabled={loading}>Add Task</button></form></div>; }) : <p className="subcopy">No schedules configured.</p>}</div></div>
                      </div>
                    ) : null}

                    {tab === "databases" ? (
                      <div className="game-section-grid">
                        <div className="panel"><div className="panel-head"><h2>Create Database</h2></div><div className="panel-body"><form className="game-stack-form" onSubmit={(event) => void createDatabase(event)}><label className="game-variable-input"><span>Database Name</span><input value={databaseForm.database} onChange={(event) => setDatabaseForm((currentValue) => ({ ...currentValue, database: event.target.value }))} /></label><label className="game-variable-input"><span>Connections From</span><input value={databaseForm.remote} onChange={(event) => setDatabaseForm((currentValue) => ({ ...currentValue, remote: event.target.value }))} /></label><button type="submit" disabled={loading}>Create Database</button></form></div></div>
                        <div className="panel"><div className="panel-head"><h2>Databases</h2></div><div className="panel-body">{detail.databases.length ? detail.databases.map((database) => <div key={database.id} className="game-schedule-card"><div className="service-top"><div><strong>{database.name}</strong><p>{database.username} · {database.address}</p></div><strong>{database.maxConnections} max</strong></div><div className="button-row"><button type="button" className="small-button" onClick={() => void rotateDatabasePassword(database.id)}>Rotate Password</button><button type="button" className="small-button" onClick={() => void deleteDatabase(database.id)}>Delete</button></div></div>) : <p className="subcopy">No databases attached.</p>}</div></div>
                      </div>
                    ) : null}

                    {tab === "users" ? (
                      <div className="game-section-grid">
                        <div className="panel"><div className="panel-head"><h2>Create Subuser</h2></div><div className="panel-body"><form className="game-stack-form" onSubmit={(event) => void createSubuser(event)}><label className="game-variable-input"><span>Email</span><input value={subuserForm.email} onChange={(event) => setSubuserForm((currentValue) => ({ ...currentValue, email: event.target.value }))} /></label><label className="game-variable-input"><span>Permissions</span><textarea className="config-editor compact-editor" value={subuserForm.permissions} onChange={(event) => setSubuserForm((currentValue) => ({ ...currentValue, permissions: event.target.value }))} /></label><div className="button-row"><button type="button" className="small-button" onClick={() => setSubuserForm((currentValue) => ({ ...currentValue, permissions: permissionStarter }))}>Load Starter Permissions</button><button type="submit" disabled={loading}>Create Subuser</button></div></form></div></div>
                        <div className="panel"><div className="panel-head"><h2>Subusers</h2></div><div className="panel-body">{detail.users.length ? detail.users.map((user) => <div key={user.id} className="game-schedule-card"><div className="service-top"><div><strong>{user.username}</strong><p>{user.email}</p></div><span className={`badge ${user.twoFactorEnabled ? "good" : "neutral"}`}>{user.twoFactorEnabled ? "2FA on" : "2FA off"}</span></div><label className="game-variable-input"><span>Permissions</span><textarea className="config-editor compact-editor" value={userPermissions[user.id] ?? ""} onChange={(event) => setUserPermissions((currentValue) => ({ ...currentValue, [user.id]: event.target.value }))} /></label><div className="button-row"><button type="button" className="small-button" onClick={() => void updateSubuser(user.id)}>Save Permissions</button><button type="button" className="small-button" onClick={() => void deleteSubuser(user.id)}>Delete User</button></div></div>) : <p className="subcopy">No subusers configured.</p>}</div></div>
                      </div>
                    ) : null}

                    {tab === "activity" ? (
                      <div className="panel wide"><div className="panel-head"><h2>Activity</h2></div><div className="panel-body">{detail.activity.length ? detail.activity.map((entry) => <div key={entry.id} className="info-row stacked-row"><div><strong>{entry.event}</strong><p>{entry.description || "No description provided."}</p></div><div className="game-variable-values"><span>{entry.source}</span><strong>{entry.createdAt}</strong></div></div>) : <p className="subcopy">No activity events returned by Pterodactyl.</p>}</div></div>
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
