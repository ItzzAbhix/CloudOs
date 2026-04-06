import crypto from "node:crypto";
import path from "node:path";
import { config } from "./config.js";
import type { ServerResponse } from "node:http";

type PterodactylCollection<T> = {
  data?: Array<{ attributes?: T }>;
  meta?: { pagination?: { current_page?: number; total_pages?: number } };
};

type ApplicationServer = {
  id?: number;
  uuid?: string;
  identifier?: string;
  external_id?: string | null;
  name?: string;
  description?: string | null;
  status?: string | null;
  suspended?: boolean;
  limits?: { memory?: number; disk?: number; cpu?: number };
  feature_limits?: { databases?: number; allocations?: number; backups?: number };
  node?: number | string | null;
  allocation?: { ip?: string; alias?: string | null; port?: number | string | null };
  allocations?: Array<{ ip?: string; alias?: string | null; port?: number | string | null }>;
};

type ApplicationNode = {
  id?: number;
  name?: string;
  fqdn?: string;
  scheme?: string;
  behind_proxy?: boolean;
  maintenance_mode?: boolean;
};

type ApplicationAllocation = {
  id?: number;
  ip?: string;
  ip_alias?: string | null;
  port?: number | string;
  assigned?: boolean;
  notes?: string | null;
};

type ApplicationUser = {
  id?: number;
  username?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  root_admin?: boolean;
};

type ApplicationNest = {
  id?: number;
  name?: string;
  description?: string;
  relationships?: {
    eggs?: { data?: Array<{ attributes?: ApplicationEgg }> };
  };
};

type ApplicationEgg = {
  id?: number;
  nest?: number;
  name?: string;
  description?: string;
  docker_image?: string;
  docker_images?: Record<string, string>;
  startup?: string;
  relationships?: {
    variables?: { data?: Array<{ attributes?: ApplicationEggVariable }> };
  };
};

type ApplicationEggVariable = {
  id?: number;
  name?: string;
  description?: string;
  env_variable?: string;
  default_value?: string;
  rules?: string;
  user_viewable?: boolean;
  user_editable?: boolean;
};

type ClientServer = {
  identifier?: string;
  uuid?: string;
  internal_id?: number;
  name?: string;
  description?: string | null;
  node?: string | null;
  status?: string | null;
  is_suspended?: boolean;
  is_installing?: boolean;
  server_owner?: boolean;
  invocation?: string;
  docker_image?: string;
  limits?: { memory?: number; disk?: number; cpu?: number };
  feature_limits?: { databases?: number; allocations?: number; backups?: number };
  relationships?: {
    allocations?: { data?: Array<{ attributes?: { ip?: string; alias?: string | null; port?: number | string | null; is_default?: boolean } }> };
  };
};

type ClientResource = {
  current_state?: string;
  is_suspended?: boolean;
  resources?: {
    memory_bytes?: number;
    cpu_absolute?: number;
    disk_bytes?: number;
    network_rx_bytes?: number;
    network_tx_bytes?: number;
    uptime?: number;
  };
};

type ClientStartupVariable = {
  name?: string;
  description?: string;
  env_variable?: string;
  default_value?: string;
  server_value?: string;
  is_editable?: boolean;
  rules?: string;
};

type ClientDatabase = {
  id?: string | number;
  host?: { address?: string; port?: number | string };
  name?: string;
  username?: string;
  connections_from?: string;
  max_connections?: number;
};

type ClientScheduleTask = {
  id?: number;
  sequence_id?: number;
  action?: string;
  payload?: string;
  time_offset?: number;
  continue_on_failure?: boolean;
};

type ClientSchedule = {
  id?: number;
  name?: string;
  cron?: { minute?: string; hour?: string; day_of_month?: string; month?: string; day_of_week?: string };
  is_active?: boolean;
  is_processing?: boolean;
  only_when_online?: boolean;
  last_run_at?: string | null;
  next_run_at?: string | null;
  relationships?: { tasks?: { data?: Array<{ attributes?: ClientScheduleTask }> } };
};

type ClientBackup = {
  uuid?: string;
  name?: string;
  ignored_files?: string;
  checksum?: string | null;
  bytes?: number;
  created_at?: string;
  completed_at?: string | null;
};

type ClientSubuser = {
  uuid?: string;
  username?: string;
  email?: string;
  image?: string | null;
  permissions?: string[];
  "2fa_enabled"?: boolean;
};

type ClientActivity = {
  id?: string;
  event?: string;
  is_api?: boolean;
  description?: string | null;
  created_at?: string;
};

type ClientWebsocket = {
  socket?: string;
  token?: string;
};

type ClientFileEntry = {
  name?: string;
  mode?: string;
  size?: number;
  is_file?: boolean;
  is_symlink?: boolean;
  mime?: string;
  created_at?: string | null;
  modified_at?: string | null;
};

type ClientAllocation = {
  id?: number;
  ip?: string;
  ip_alias?: string | null;
  alias?: string | null;
  port?: number | string;
  notes?: string | null;
  is_default?: boolean;
};

export type GameServerSummary = {
  id: string;
  identifier: string;
  uuid: string;
  name: string;
  description: string;
  node: string;
  allocation: string;
  suspended: boolean;
  installing: boolean;
  powerState: string;
  limits: {
    memoryMb: number;
    diskMb: number;
    cpuPercent: number;
  };
  usage: {
    memoryMb: number;
    diskMb: number;
    cpuPercent: number;
    networkRxMb: number;
    networkTxMb: number;
    uptimeSeconds: number;
  } | null;
};

export type GamesDashboard = {
  enabled: boolean;
  provider: "pterodactyl";
  configured: boolean;
  powerActionsEnabled: boolean;
  panel: {
    url: string;
    reachable: boolean;
  };
  summary: {
    totalServers: number;
    runningServers: number;
    suspendedServers: number;
    nodes: number;
  };
  nodes: Array<{
    id: string;
    name: string;
    fqdn: string;
    scheme: string;
    maintenanceMode: boolean;
  }>;
  servers: GameServerSummary[];
  error: string | null;
};

export type GameServerDetail = {
  id: string;
  identifier: string;
  uuid: string;
  internalId: number;
  name: string;
  description: string;
  node: string;
  allocation: string;
  allocations: Array<{
    id: string;
    label: string;
    ip: string;
    alias: string;
    port: number;
    notes: string;
    isDefault: boolean;
  }>;
  suspended: boolean;
  installing: boolean;
  powerState: string;
  dockerImage: string;
  invocation: string;
  owner: boolean;
  limits: {
    memoryMb: number;
    diskMb: number;
    cpuPercent: number;
  };
  featureLimits: {
    databases: number;
    allocations: number;
    backups: number;
  };
  usage: GameServerSummary["usage"];
  startupVariables: Array<{
    name: string;
    env: string;
    value: string;
    defaultValue: string;
    editable: boolean;
    rules: string;
    description: string;
  }>;
  databases: Array<{
    id: string;
    name: string;
    username: string;
    address: string;
    maxConnections: number;
  }>;
  schedules: Array<{
    id: string;
    name: string;
    active: boolean;
    processing: boolean;
    onlyWhenOnline: boolean;
    cron: string;
    nextRunAt: string;
    lastRunAt: string;
    tasks: Array<{
      id: string;
      sequenceId: number;
      action: string;
      payload: string;
      timeOffset: number;
      continueOnFailure: boolean;
    }>;
  }>;
  backups: Array<{
    id: string;
    name: string;
    sizeMb: number;
    checksum: string;
    completedAt: string;
    createdAt: string;
    isLocked: boolean;
    isSuccessful: boolean;
  }>;
  users: Array<{
    id: string;
    username: string;
    email: string;
    permissions: string[];
    twoFactorEnabled: boolean;
  }>;
  activity: Array<{
    id: string;
    event: string;
    description: string;
    source: string;
    createdAt: string;
  }>;
};

export type GameServerConsoleWebsocket = {
  socket: string;
  token: string;
};

export type GameServerFiles = {
  currentPath: string;
  entries: Array<{
    name: string;
    path: string;
    type: "file" | "directory";
    size: number;
    mode: string;
    mimeType: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

export type GameServerDownload = {
  url: string;
};

export type GameCreateCatalog = {
  users: Array<{ id: string; username: string; email: string; name: string }>;
  nodes: Array<{ id: string; name: string; fqdn: string; allocations: Array<{ id: string; label: string; assigned: boolean }> }>;
  nests: Array<{ id: string; name: string; eggs: Array<{ id: string; name: string; description: string }> }>;
};

export type GameEggTemplate = {
  id: string;
  nestId: string;
  name: string;
  description: string;
  dockerImage: string;
  dockerImages: Array<{ label: string; image: string }>;
  startup: string;
  variables: Array<{
    name: string;
    env: string;
    defaultValue: string;
    rules: string;
    description: string;
    userEditable: boolean;
  }>;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function coerceNumber(value: unknown, fallback = 0) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function toRoundedMb(bytes: number) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function toHumanDate(value?: string | null) {
  return value ?? "Never";
}

function toAllocationHost(allocation?: { ip?: string; alias?: string | null; port?: number | string | null }) {
  const host = allocation?.alias || allocation?.ip;
  const port = allocation?.port;
  if (!host && !port) return "Unassigned";
  if (!host) return `${port ?? "unknown"}`;
  if (!port) return host;
  return `${host}:${port}`;
}

function toAllocationString(server?: ApplicationServer) {
  return toAllocationHost(server?.allocation);
}

function toFeatureLimits(server?: ApplicationServer | ClientServer) {
  return {
    databases: coerceNumber(server?.feature_limits?.databases),
    allocations: coerceNumber(server?.feature_limits?.allocations),
    backups: coerceNumber(server?.feature_limits?.backups)
  };
}

function toUsage(resource: ClientResource | null) {
  const values = resource?.resources;
  if (!values) return null;
  return {
    memoryMb: toRoundedMb(coerceNumber(values.memory_bytes)),
    diskMb: toRoundedMb(coerceNumber(values.disk_bytes)),
    cpuPercent: Math.round(coerceNumber(values.cpu_absolute) * 10) / 10,
    networkRxMb: toRoundedMb(coerceNumber(values.network_rx_bytes)),
    networkTxMb: toRoundedMb(coerceNumber(values.network_tx_bytes)),
    uptimeSeconds: coerceNumber(values.uptime)
  };
}

function parsePterodactylError(raw: string, status: number) {
  try {
    const payload = JSON.parse(raw) as {
      errors?: Array<{ detail?: string; code?: string }>;
      error?: string;
    };
    const detail = payload.errors?.[0]?.detail || payload.error;
    return detail ? `${detail} (${status})` : `Pterodactyl request failed (${status})`;
  } catch {
    return raw || `Pterodactyl request failed (${status})`;
  }
}

async function pterodactylRequest<T>(scope: "application" | "client", pathname: string, init?: RequestInit) {
  const token = scope === "application" ? config.pterodactylApplicationApiKey : config.pterodactylClientApiKey;
  if (!config.pterodactylUrl) {
    throw new Error("CLOUDOS_PTERODACTYL_URL is not configured.");
  }
  if (!token) {
    throw new Error(
      scope === "application"
        ? "CLOUDOS_PTERODACTYL_APPLICATION_API_KEY is not configured."
        : "CLOUDOS_PTERODACTYL_CLIENT_API_KEY is not configured."
    );
  }

  const response = await fetch(`${trimTrailingSlash(config.pterodactylUrl)}${pathname}`, {
    ...init,
    headers: {
      Accept: "Application/vnd.pterodactyl.v1+json",
      Authorization: `Bearer ${token}`,
      ...(init?.body && !(init.body instanceof Buffer) ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(parsePterodactylError(text, response.status));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function pterodactylResponse(scope: "application" | "client", pathname: string, init?: RequestInit) {
  const token = scope === "application" ? config.pterodactylApplicationApiKey : config.pterodactylClientApiKey;
  if (!config.pterodactylUrl) {
    throw new Error("CLOUDOS_PTERODACTYL_URL is not configured.");
  }
  if (!token) {
    throw new Error(
      scope === "application"
        ? "CLOUDOS_PTERODACTYL_APPLICATION_API_KEY is not configured."
        : "CLOUDOS_PTERODACTYL_CLIENT_API_KEY is not configured."
    );
  }

  const response = await fetch(`${trimTrailingSlash(config.pterodactylUrl)}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "Application/vnd.pterodactyl.v1+json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(parsePterodactylError(text, response.status));
  }

  return response;
}

async function pterodactylTextRequest(scope: "application" | "client", pathname: string, init?: RequestInit) {
  const token = scope === "application" ? config.pterodactylApplicationApiKey : config.pterodactylClientApiKey;
  if (!config.pterodactylUrl) {
    throw new Error("CLOUDOS_PTERODACTYL_URL is not configured.");
  }
  if (!token) {
    throw new Error(
      scope === "application"
        ? "CLOUDOS_PTERODACTYL_APPLICATION_API_KEY is not configured."
        : "CLOUDOS_PTERODACTYL_CLIENT_API_KEY is not configured."
    );
  }

  const response = await fetch(`${trimTrailingSlash(config.pterodactylUrl)}${pathname}`, {
    ...init,
    headers: {
      Accept: "text/plain, Application/vnd.pterodactyl.v1+json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(parsePterodactylError(text, response.status));
  }

  return response.text();
}

async function listAllApplicationPages<T>(pathname: string) {
  const combined: Array<{ attributes?: T }> = [];
  let currentPage = 1;
  let totalPages = 1;

  do {
    const joiner = pathname.includes("?") ? "&" : "?";
    const payload = await pterodactylRequest<PterodactylCollection<T>>(
      "application",
      `${pathname}${joiner}page=${currentPage}&per_page=100`
    );
    combined.push(...(payload.data ?? []));
    totalPages = payload.meta?.pagination?.total_pages ?? currentPage;
    currentPage += 1;
  } while (currentPage <= totalPages);

  return combined;
}

async function listApplicationServers() {
  if (!config.pterodactylApplicationApiKey) return [];
  return listAllApplicationPages<ApplicationServer>("/api/application/servers");
}

async function listApplicationNodes() {
  if (!config.pterodactylApplicationApiKey) return [];
  return listAllApplicationPages<ApplicationNode>("/api/application/nodes");
}

async function listApplicationNodeAllocations(nodeId: string | number) {
  if (!config.pterodactylApplicationApiKey) return [];
  return listAllApplicationPages<ApplicationAllocation>(`/api/application/nodes/${nodeId}/allocations`);
}

async function listApplicationUsers() {
  if (!config.pterodactylApplicationApiKey) return [];
  return listAllApplicationPages<ApplicationUser>("/api/application/users");
}

async function listApplicationNests() {
  if (!config.pterodactylApplicationApiKey) return [];
  const payload = await pterodactylRequest<PterodactylCollection<ApplicationNest>>(
    "application",
    "/api/application/nests?include=eggs"
  );
  return payload.data ?? [];
}

async function getApplicationEgg(nestId: string | number, eggId: string | number) {
  const payload = await pterodactylRequest<{ attributes?: ApplicationEgg }>(
    "application",
    `/api/application/nests/${nestId}/eggs/${eggId}?include=variables`
  );
  return payload.attributes ?? {};
}

async function listClientServers() {
  if (!config.pterodactylClientApiKey) return [];
  const payload = await pterodactylRequest<PterodactylCollection<ClientServer>>("client", "/api/client");
  return payload.data ?? [];
}

async function getClientServer(identifier: string) {
  const payload = await pterodactylRequest<{ attributes?: ClientServer }>("client", `/api/client/servers/${identifier}`);
  return payload.attributes ?? {};
}

async function getClientResources(identifier: string) {
  if (!config.pterodactylClientApiKey) return null;
  const payload = await pterodactylRequest<{ attributes?: ClientResource }>(
    "client",
    `/api/client/servers/${identifier}/resources`
  );
  return payload.attributes ?? null;
}

async function getClientStartup(identifier: string) {
  const payload = await pterodactylRequest<{
    data?: Array<{ attributes?: ClientStartupVariable }>;
    meta?: { startup_command?: string; docker_image?: string };
  }>("client", `/api/client/servers/${identifier}/startup`);

  return {
    variables: payload.data ?? [],
    startupCommand: payload.meta?.startup_command ?? "",
    dockerImage: payload.meta?.docker_image ?? ""
  };
}

async function getClientDatabases(identifier: string) {
  const payload = await pterodactylRequest<PterodactylCollection<ClientDatabase>>(
    "client",
    `/api/client/servers/${identifier}/databases`
  );
  return payload.data ?? [];
}

async function getClientSchedules(identifier: string) {
  const payload = await pterodactylRequest<PterodactylCollection<ClientSchedule>>(
    "client",
    `/api/client/servers/${identifier}/schedules`
  );
  return payload.data ?? [];
}

async function getClientBackups(identifier: string) {
  const payload = await pterodactylRequest<PterodactylCollection<ClientBackup>>(
    "client",
    `/api/client/servers/${identifier}/backups`
  );
  return payload.data ?? [];
}

async function getClientUsers(identifier: string) {
  const payload = await pterodactylRequest<PterodactylCollection<ClientSubuser>>(
    "client",
    `/api/client/servers/${identifier}/users`
  );
  return payload.data ?? [];
}

async function getClientNetworkAllocations(identifier: string) {
  const payload = await pterodactylRequest<PterodactylCollection<ClientAllocation>>(
    "client",
    `/api/client/servers/${identifier}/network/allocations`
  );
  return payload.data ?? [];
}

async function getClientActivity(identifier: string) {
  const payload = await pterodactylRequest<PterodactylCollection<ClientActivity>>(
    "client",
    `/api/client/servers/${identifier}/activity?page=1&per_page=100`
  );
  return payload.data ?? [];
}

async function getClientWebsocket(identifier: string) {
  const payload = await pterodactylRequest<{ data?: { socket?: string; token?: string } }>(
    "client",
    `/api/client/servers/${identifier}/websocket`
  );
  return payload.data ?? {};
}

function mergeServers(
  applicationServers: Array<{ attributes?: ApplicationServer }>,
  clientServers: Array<{ attributes?: ClientServer }>,
  nodes: Array<{ attributes?: ApplicationNode }>,
  resourcesByIdentifier: Map<string, ClientResource | null>
) {
  const nodeLookup = new Map(
    nodes
      .map((entry) => entry.attributes)
      .filter((entry): entry is ApplicationNode => Boolean(entry?.id))
      .map((entry) => [String(entry.id), entry])
  );
  const applicationLookup = new Map(
    applicationServers
      .map((entry) => entry.attributes)
      .filter((entry): entry is ApplicationServer => Boolean(entry?.identifier))
      .map((entry) => [String(entry.identifier), entry])
  );
  const clientLookup = new Map(
    clientServers
      .map((entry) => entry.attributes)
      .filter((entry): entry is ClientServer => Boolean(entry?.identifier))
      .map((entry) => [String(entry.identifier), entry])
  );

  const identifiers = new Set<string>([...applicationLookup.keys(), ...clientLookup.keys()]);

  return [...identifiers]
    .map((identifier) => {
      const applicationServer = applicationLookup.get(identifier);
      const clientServer = clientLookup.get(identifier);
      const resource = resourcesByIdentifier.get(identifier) ?? null;
      const node = applicationServer?.node ? nodeLookup.get(String(applicationServer.node)) : undefined;
      const limits = clientServer?.limits ?? applicationServer?.limits;
      const powerState = resource?.current_state ?? clientServer?.status ?? applicationServer?.status ?? "unknown";

      return {
        id: String(applicationServer?.id ?? clientServer?.internal_id ?? identifier),
        identifier,
        uuid: String(clientServer?.uuid ?? applicationServer?.uuid ?? identifier),
        name: String(clientServer?.name ?? applicationServer?.name ?? identifier),
        description: String(clientServer?.description ?? applicationServer?.description ?? "No description"),
        node: String(clientServer?.node ?? node?.name ?? "Unknown node"),
        allocation: toAllocationString(applicationServer),
        suspended: Boolean(resource?.is_suspended ?? clientServer?.is_suspended ?? applicationServer?.suspended),
        installing: Boolean(clientServer?.is_installing),
        powerState,
        limits: {
          memoryMb: coerceNumber(limits?.memory),
          diskMb: coerceNumber(limits?.disk),
          cpuPercent: coerceNumber(limits?.cpu)
        },
        usage: toUsage(resource)
      } satisfies GameServerSummary;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function resolveApplicationContext(
  identifier: string,
  applicationServers: Array<{ attributes?: ApplicationServer }>,
  nodes: Array<{ attributes?: ApplicationNode }>
) {
  const applicationServer = applicationServers
    .map((entry) => entry.attributes)
    .find((entry): entry is ApplicationServer => Boolean(entry?.identifier) && entry?.identifier === identifier);

  const node = nodes
    .map((entry) => entry.attributes)
    .find((entry): entry is ApplicationNode => Boolean(entry?.id) && String(entry?.id) === String(applicationServer?.node));

  return { applicationServer, node };
}

export function isGamesConfigured() {
  return Boolean(config.pterodactylUrl && (config.pterodactylApplicationApiKey || config.pterodactylClientApiKey));
}

export async function getGamesDashboard(): Promise<GamesDashboard> {
  if (!isGamesConfigured()) {
    return {
      enabled: false,
      provider: "pterodactyl",
      configured: false,
      powerActionsEnabled: Boolean(config.pterodactylClientApiKey),
      panel: { url: config.pterodactylUrl, reachable: false },
      summary: { totalServers: 0, runningServers: 0, suspendedServers: 0, nodes: 0 },
      nodes: [],
      servers: [],
      error: "Configure CLOUDOS_PTERODACTYL_URL and at least one API key to enable native game controls."
    };
  }

  try {
    const [applicationServers, clientServers, nodes] = await Promise.all([
      listApplicationServers(),
      listClientServers(),
      listApplicationNodes()
    ]);

    const identifiers = new Set<string>();
    for (const server of applicationServers) {
      if (server.attributes?.identifier) identifiers.add(String(server.attributes.identifier));
    }
    for (const server of clientServers) {
      if (server.attributes?.identifier) identifiers.add(String(server.attributes.identifier));
    }

    const resourceResults = await Promise.allSettled(
      [...identifiers].map(async (identifier) => [identifier, await getClientResources(identifier)] as const)
    );
    const resourcesByIdentifier = new Map<string, ClientResource | null>();
    for (const result of resourceResults) {
      if (result.status === "fulfilled") {
        resourcesByIdentifier.set(result.value[0], result.value[1]);
      }
    }

    const servers = mergeServers(applicationServers, clientServers, nodes, resourcesByIdentifier);

    return {
      enabled: true,
      provider: "pterodactyl",
      configured: true,
      powerActionsEnabled: Boolean(config.pterodactylClientApiKey),
      panel: { url: config.pterodactylUrl, reachable: true },
      summary: {
        totalServers: servers.length,
        runningServers: servers.filter((server) => server.powerState === "running").length,
        suspendedServers: servers.filter((server) => server.suspended).length,
        nodes: nodes.length
      },
      nodes: nodes
        .map((entry) => entry.attributes)
        .filter((entry): entry is ApplicationNode => Boolean(entry?.id))
        .map((entry) => ({
          id: String(entry.id),
          name: entry.name ?? `Node ${entry.id}`,
          fqdn: entry.fqdn ?? "unknown",
          scheme: entry.scheme ?? "https",
          maintenanceMode: Boolean(entry.maintenance_mode)
        })),
      servers,
      error: null
    };
  } catch (error) {
    return {
      enabled: false,
      provider: "pterodactyl",
      configured: true,
      powerActionsEnabled: Boolean(config.pterodactylClientApiKey),
      panel: { url: config.pterodactylUrl, reachable: false },
      summary: { totalServers: 0, runningServers: 0, suspendedServers: 0, nodes: 0 },
      nodes: [],
      servers: [],
      error: error instanceof Error ? error.message : "Unable to reach Pterodactyl."
    };
  }
}

export async function getGameServerDetail(identifier: string): Promise<GameServerDetail> {
  const [clientServer, resource, startup, databases, schedules, backups, users, activity, applicationServers, nodes, networkAllocations] =
    await Promise.all([
      getClientServer(identifier),
      getClientResources(identifier),
      getClientStartup(identifier),
      getClientDatabases(identifier),
      getClientSchedules(identifier),
      getClientBackups(identifier),
      getClientUsers(identifier),
      getClientActivity(identifier),
      listApplicationServers(),
      listApplicationNodes(),
      getClientNetworkAllocations(identifier)
    ]);

  const { applicationServer, node } = resolveApplicationContext(identifier, applicationServers, nodes);
  const relationshipAllocations = clientServer.relationships?.allocations?.data ?? [];
  const allocations = networkAllocations.length
    ? networkAllocations
        .map((entry) => entry.attributes)
        .filter((entry): entry is ClientAllocation => Boolean(entry?.id))
        .map((entry) => ({
          id: String(entry.id),
          label: `${entry.alias || entry.ip_alias || entry.ip}:${entry.port ?? ""}`.replace(/:$/, ""),
          ip: entry.ip ?? "",
          alias: entry.alias || entry.ip_alias || "",
          port: coerceNumber(entry.port),
          notes: entry.notes ?? "",
          isDefault: Boolean(entry.is_default)
        }))
    : relationshipAllocations.length
      ? relationshipAllocations
          .map((entry) => entry.attributes)
          .filter((entry): entry is { ip?: string; alias?: string | null; port?: number | string | null; is_default?: boolean } => Boolean(entry))
          .map((entry, index) => ({
            id: `${identifier}-rel-${index}`,
            label: toAllocationHost({ ip: entry.ip, alias: entry.alias, port: entry.port }),
            ip: entry.ip ?? "",
            alias: entry.alias ?? "",
            port: coerceNumber(entry.port),
            notes: "",
            isDefault: Boolean(entry.is_default)
          }))
      : (applicationServer?.allocations ?? []).map((entry, index) => ({
          id: `${applicationServer?.id ?? identifier}-${index}`,
          label: toAllocationHost(entry),
          ip: entry.ip ?? "",
          alias: entry.alias ?? "",
          port: coerceNumber(entry.port),
          notes: "",
          isDefault: index === 0
        }));
  const limits = clientServer.limits ?? applicationServer?.limits;

  return {
    id: String(applicationServer?.id ?? clientServer.internal_id ?? identifier),
    identifier,
    uuid: String(clientServer.uuid ?? applicationServer?.uuid ?? identifier),
    internalId: coerceNumber(clientServer.internal_id),
    name: clientServer.name ?? applicationServer?.name ?? identifier,
    description: clientServer.description ?? applicationServer?.description ?? "",
    node: clientServer.node ?? node?.name ?? "Unknown node",
    allocation: allocations.find((entry) => entry.isDefault)?.label ?? toAllocationString(applicationServer),
    allocations,
    suspended: Boolean(resource?.is_suspended ?? clientServer.is_suspended ?? applicationServer?.suspended),
    installing: Boolean(clientServer.is_installing),
    powerState: resource?.current_state ?? clientServer.status ?? applicationServer?.status ?? "unknown",
    dockerImage: clientServer.docker_image ?? startup.dockerImage ?? "",
    invocation: clientServer.invocation ?? startup.startupCommand ?? "",
    owner: Boolean(clientServer.server_owner),
    limits: {
      memoryMb: coerceNumber(limits?.memory),
      diskMb: coerceNumber(limits?.disk),
      cpuPercent: coerceNumber(limits?.cpu)
    },
    featureLimits: toFeatureLimits(clientServer.identifier ? clientServer : applicationServer),
    usage: toUsage(resource),
    startupVariables: startup.variables.map((entry) => ({
      name: entry.attributes?.name ?? "Unnamed",
      env: entry.attributes?.env_variable ?? "",
      value: entry.attributes?.server_value ?? "",
      defaultValue: entry.attributes?.default_value ?? "",
      editable: Boolean(entry.attributes?.is_editable),
      rules: entry.attributes?.rules ?? "",
      description: entry.attributes?.description ?? ""
    })),
    databases: databases.map((entry) => ({
      id: String(entry.attributes?.id ?? entry.attributes?.name ?? crypto.randomUUID()),
      name: entry.attributes?.name ?? "",
      username: entry.attributes?.username ?? "",
      address: entry.attributes?.host?.address
        ? `${entry.attributes.host.address}:${entry.attributes.host.port ?? ""}`.replace(/:$/, "")
        : "Unassigned",
      maxConnections: coerceNumber(entry.attributes?.max_connections)
    })),
    schedules: schedules.map((entry) => ({
      id: String(entry.attributes?.id ?? crypto.randomUUID()),
      name: entry.attributes?.name ?? "Unnamed schedule",
      active: Boolean(entry.attributes?.is_active),
      processing: Boolean(entry.attributes?.is_processing),
      onlyWhenOnline: Boolean(entry.attributes?.only_when_online),
      cron: [
        entry.attributes?.cron?.minute ?? "*",
        entry.attributes?.cron?.hour ?? "*",
        entry.attributes?.cron?.day_of_month ?? "*",
        entry.attributes?.cron?.month ?? "*",
        entry.attributes?.cron?.day_of_week ?? "*"
      ].join(" "),
      nextRunAt: toHumanDate(entry.attributes?.next_run_at),
      lastRunAt: toHumanDate(entry.attributes?.last_run_at),
      tasks: (entry.attributes?.relationships?.tasks?.data ?? []).map((task) => ({
        id: String(task.attributes?.id ?? crypto.randomUUID()),
        sequenceId: coerceNumber(task.attributes?.sequence_id),
        action: task.attributes?.action ?? "",
        payload: task.attributes?.payload ?? "",
        timeOffset: coerceNumber(task.attributes?.time_offset),
        continueOnFailure: Boolean(task.attributes?.continue_on_failure)
      }))
    })),
    backups: backups.map((entry) => ({
      id: entry.attributes?.uuid ?? crypto.randomUUID(),
      name: entry.attributes?.name ?? "Backup",
      sizeMb: toRoundedMb(coerceNumber(entry.attributes?.bytes)),
      checksum: entry.attributes?.checksum ?? "pending",
      completedAt: toHumanDate(entry.attributes?.completed_at),
      createdAt: toHumanDate(entry.attributes?.created_at),
      isLocked: Boolean((entry.attributes as ClientBackup & { is_locked?: boolean })?.is_locked),
      isSuccessful: Boolean((entry.attributes as ClientBackup & { is_successful?: boolean })?.is_successful)
    })),
    users: users.map((entry) => ({
      id: entry.attributes?.uuid ?? crypto.randomUUID(),
      username: entry.attributes?.username ?? "unknown",
      email: entry.attributes?.email ?? "",
      permissions: entry.attributes?.permissions ?? [],
      twoFactorEnabled: Boolean(entry.attributes?.["2fa_enabled"])
    })),
    activity: activity.map((entry) => ({
      id: entry.attributes?.id ?? crypto.randomUUID(),
      event: entry.attributes?.event ?? "unknown",
      description: entry.attributes?.description ?? "",
      source: entry.attributes?.is_api ? "API" : "Panel",
      createdAt: toHumanDate(entry.attributes?.created_at)
    }))
  };
}

export async function getGameServerConsoleWebsocket(identifier: string): Promise<GameServerConsoleWebsocket> {
  const websocket = await getClientWebsocket(identifier);
  if (!websocket.socket || !websocket.token) {
    throw new Error("Pterodactyl did not return websocket credentials.");
  }

  return {
    socket: websocket.socket,
    token: websocket.token
  };
}

export async function streamGameServerConsole(
  identifier: string,
  response: ServerResponse,
  onClose?: () => void
) {
  const websocket = await getClientWebsocket(identifier);
  if (!websocket.socket || !websocket.token) {
    throw new Error("Pterodactyl did not return websocket credentials.");
  }

  const NodeWebSocket = (globalThis as { WebSocket?: new (url: string) => {
    send(data: string): void;
    close(): void;
    addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  } }).WebSocket;

  if (!NodeWebSocket) {
    throw new Error("This Node runtime does not expose a global WebSocket implementation.");
  }

  const socket = new NodeWebSocket(websocket.socket);
  const write = (event: string, payload: unknown) => {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ event: "auth", args: [websocket.token] }));
    socket.send(JSON.stringify({ event: "send logs", args: [] }));
    write("ready", { ok: true });
  });

  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(String(event.data ?? "")) as { event?: string; args?: string[] };
      if (payload.event === "console output" || payload.event === "daemon message" || payload.event === "install output") {
        write("line", { lines: payload.args ?? [] });
      } else if (payload.event === "token expiring") {
        write("status", { message: "Console token expiring" });
      } else if (payload.event === "token expired") {
        write("status", { message: "Console token expired" });
      } else if (payload.event === "jwt error") {
        write("error", { message: (payload.args ?? []).join(" ") || "Console authorization failed" });
      } else if (payload.event === "status") {
        write("status", { message: (payload.args ?? []).join(" ") });
      }
    } catch {
      write("line", { lines: [String(event.data ?? "")] });
    }
  });

  const cleanup = () => {
    try {
      socket.close();
    } catch {
      // ignore cleanup errors
    }
    onClose?.();
  };

  response.on("close", cleanup);
  response.on("finish", cleanup);
}

export async function performGamePowerAction(identifier: string, signal: "start" | "stop" | "restart" | "kill") {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/power`, {
    method: "POST",
    body: JSON.stringify({ signal })
  });
}

export async function sendGameServerCommand(identifier: string, command: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/command`, {
    method: "POST",
    body: JSON.stringify({ command })
  });
}

export async function createGameServerBackup(identifier: string, name?: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/backups`, {
    method: "POST",
    body: JSON.stringify(name ? { name } : {})
  });
}

export async function getGameServerBackupDownload(identifier: string, backupId: string): Promise<GameServerDownload> {
  const payload = await pterodactylRequest<{ attributes?: { url?: string } }>(
    "client",
    `/api/client/servers/${identifier}/backups/${backupId}/download`
  );
  return { url: payload.attributes?.url ?? "" };
}

export async function restoreGameServerBackup(identifier: string, backupId: string, truncate = true) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/backups/${backupId}/restore`, {
    method: "POST",
    body: JSON.stringify({ truncate })
  });
}

export async function toggleGameServerBackupLock(identifier: string, backupId: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/backups/${backupId}/lock`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function deleteGameServerBackup(identifier: string, backupId: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/backups/${backupId}`, {
    method: "DELETE"
  });
}

export async function getGameServerFiles(identifier: string, directory = "/"): Promise<GameServerFiles> {
  const encodedDirectory = encodeURIComponent(directory);
  const payload = await pterodactylRequest<PterodactylCollection<ClientFileEntry>>(
    "client",
    `/api/client/servers/${identifier}/files/list?directory=${encodedDirectory}`
  );

  return {
    currentPath: directory,
    entries: (payload.data ?? []).map((entry) => ({
      name: entry.attributes?.name ?? "unknown",
      path: path.posix.join(directory === "/" ? "/" : directory, entry.attributes?.name ?? "unknown"),
      type: entry.attributes?.is_file ? "file" : "directory",
      size: coerceNumber(entry.attributes?.size),
      mode: entry.attributes?.mode ?? "",
      mimeType: entry.attributes?.mime ?? "",
      createdAt: toHumanDate(entry.attributes?.created_at),
      updatedAt: toHumanDate(entry.attributes?.modified_at)
    }))
  };
}

export async function getGameServerFileContents(identifier: string, filePath: string) {
  return pterodactylTextRequest("client", `/api/client/servers/${identifier}/files/contents?file=${encodeURIComponent(filePath)}`);
}

export async function getGameServerFileUploadUrl(identifier: string, directory: string) {
  const payload = await pterodactylRequest<{ attributes?: { url?: string } }>(
    "client",
    `/api/client/servers/${identifier}/files/upload?directory=${encodeURIComponent(directory)}`
  );
  return payload.attributes?.url ?? "";
}

export async function uploadGameServerFiles(
  identifier: string,
  directory: string,
  files: Array<{ name: string; buffer: Buffer; mimeType?: string }>
) {
  const uploadUrl = await getGameServerFileUploadUrl(identifier, directory);
  if (!uploadUrl) {
    throw new Error("Pterodactyl did not return an upload URL.");
  }

  const form = new FormData();
  for (const file of files) {
    form.append("files", new Blob([file.buffer], { type: file.mimeType || "application/octet-stream" }), file.name);
  }

  const response = await fetch(uploadUrl, {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    throw new Error(`Pterodactyl upload failed (${response.status})`);
  }
}

export async function getGameServerFileDownload(identifier: string, filePath: string) {
  const response = await pterodactylResponse(
    "client",
    `/api/client/servers/${identifier}/files/download?file=${encodeURIComponent(filePath)}`
  );
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    disposition: response.headers.get("content-disposition") ?? `attachment; filename="${path.posix.basename(filePath)}"`
  };
}

export async function saveGameServerFileContents(identifier: string, filePath: string, content: string) {
  if (!config.pterodactylUrl || !config.pterodactylClientApiKey) {
    throw new Error("Pterodactyl client API is not configured.");
  }

  const response = await fetch(
    `${trimTrailingSlash(config.pterodactylUrl)}/api/client/servers/${identifier}/files/write?file=${encodeURIComponent(filePath)}`,
    {
      method: "POST",
      headers: {
        Accept: "Application/vnd.pterodactyl.v1+json",
        Authorization: `Bearer ${config.pterodactylClientApiKey}`,
        "Content-Type": "text/plain"
      },
      body: content
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(parsePterodactylError(text, response.status));
  }
}

export async function createGameServerFolder(identifier: string, directory: string, name: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/files/create-folder`, {
    method: "POST",
    body: JSON.stringify({ root: directory, name })
  });
}

export async function deleteGameServerFiles(identifier: string, directory: string, files: string[]) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/files/delete`, {
    method: "POST",
    body: JSON.stringify({ root: directory, files })
  });
}

export async function renameGameServerFiles(identifier: string, directory: string, from: string, to: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/files/rename`, {
    method: "PUT",
    body: JSON.stringify({ root: directory, files: [{ from, to }] })
  });
}

export async function compressGameServerFiles(identifier: string, directory: string, files: string[]) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/files/compress`, {
    method: "POST",
    body: JSON.stringify({ root: directory, files })
  });
}

export async function decompressGameServerFile(identifier: string, directory: string, file: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/files/decompress`, {
    method: "POST",
    body: JSON.stringify({ root: directory, file })
  });
}

export async function chmodGameServerFiles(identifier: string, directory: string, file: string, mode: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/files/chmod`, {
    method: "POST",
    body: JSON.stringify({ root: directory, files: [{ file, mode }] })
  });
}

export async function pullGameServerFile(identifier: string, directory: string, url: string, filename: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/files/pull`, {
    method: "POST",
    body: JSON.stringify({ directory, url, filename })
  });
}

export async function getGameCreateCatalog(): Promise<GameCreateCatalog> {
  const [users, nodes, nests] = await Promise.all([listApplicationUsers(), listApplicationNodes(), listApplicationNests()]);
  const nodeAllocations = await Promise.all(
    nodes
      .map((entry) => entry.attributes)
      .filter((entry): entry is ApplicationNode => Boolean(entry?.id))
      .map(async (node) => [String(node.id), await listApplicationNodeAllocations(String(node.id))] as const)
  );

  const allocationsByNode = new Map(nodeAllocations);

  return {
    users: users
      .map((entry) => entry.attributes)
      .filter((entry): entry is ApplicationUser => Boolean(entry?.id))
      .map((entry) => ({
        id: String(entry.id),
        username: entry.username ?? "unknown",
        email: entry.email ?? "",
        name: [entry.first_name, entry.last_name].filter(Boolean).join(" ") || entry.username || `User ${entry.id}`
      })),
    nodes: nodes
      .map((entry) => entry.attributes)
      .filter((entry): entry is ApplicationNode => Boolean(entry?.id))
      .map((entry) => ({
        id: String(entry.id),
        name: entry.name ?? `Node ${entry.id}`,
        fqdn: entry.fqdn ?? "unknown",
        allocations: (allocationsByNode.get(String(entry.id)) ?? [])
          .map((allocation) => allocation.attributes)
          .filter((allocation): allocation is ApplicationAllocation => Boolean(allocation?.id))
          .map((allocation) => ({
            id: String(allocation.id),
            label: `${allocation.ip_alias || allocation.ip}:${allocation.port}`,
            assigned: Boolean(allocation.assigned)
          }))
      })),
    nests: nests
      .map((entry) => entry.attributes)
      .filter((entry): entry is ApplicationNest => Boolean(entry?.id))
      .map((entry) => ({
        id: String(entry.id),
        name: entry.name ?? `Nest ${entry.id}`,
        eggs: (entry.relationships?.eggs?.data ?? [])
          .map((egg) => egg.attributes)
          .filter((egg): egg is ApplicationEgg => Boolean(egg?.id))
          .map((egg) => ({
            id: String(egg.id),
            name: egg.name ?? `Egg ${egg.id}`,
            description: egg.description ?? ""
          }))
      }))
  };
}

export async function getGameEggTemplate(nestId: string, eggId: string): Promise<GameEggTemplate> {
  const egg = await getApplicationEgg(nestId, eggId);
  const dockerImages = egg.docker_images ? Object.entries(egg.docker_images) : [];

  return {
    id: String(egg.id ?? eggId),
    nestId: String(egg.nest ?? nestId),
    name: egg.name ?? `Egg ${eggId}`,
    description: egg.description ?? "",
    dockerImage: egg.docker_image ?? dockerImages[0]?.[1] ?? "",
    dockerImages: dockerImages.map(([label, image]) => ({ label, image })),
    startup: egg.startup ?? "",
    variables: (egg.relationships?.variables?.data ?? [])
      .map((entry) => entry.attributes)
      .filter((entry): entry is ApplicationEggVariable => Boolean(entry?.env_variable))
      .map((entry) => ({
        name: entry.name ?? entry.env_variable ?? "Variable",
        env: entry.env_variable ?? "",
        defaultValue: entry.default_value ?? "",
        rules: entry.rules ?? "",
        description: entry.description ?? "",
        userEditable: Boolean(entry.user_editable)
      }))
  };
}

export async function createGameServer(input: {
  name: string;
  description?: string;
  userId: number;
  eggId: number;
  dockerImage?: string;
  startup?: string;
  environment: Record<string, string>;
  limits: { memory: number; disk: number; cpu: number; swap?: number; io?: number };
  featureLimits?: { databases?: number; allocations?: number; backups?: number };
  allocation: { default: number; additional?: number[] };
}) {
  await pterodactylRequest("application", "/api/application/servers", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      description: input.description ?? "",
      user: input.userId,
      egg: input.eggId,
      docker_image: input.dockerImage,
      startup: input.startup,
      environment: input.environment,
      limits: {
        memory: input.limits.memory,
        swap: input.limits.swap ?? 0,
        disk: input.limits.disk,
        io: input.limits.io ?? 500,
        cpu: input.limits.cpu
      },
      feature_limits: {
        databases: input.featureLimits?.databases ?? 0,
        allocations: input.featureLimits?.allocations ?? 0,
        backups: input.featureLimits?.backups ?? 0
      },
      allocation: {
        default: input.allocation.default,
        additional: input.allocation.additional ?? []
      }
    })
  });
}

export async function createGameServerDatabase(identifier: string, database: string, remote: string) {
  return pterodactylRequest("client", `/api/client/servers/${identifier}/databases`, {
    method: "POST",
    body: JSON.stringify({ database, remote })
  });
}

export async function rotateGameServerDatabasePassword(identifier: string, databaseId: string) {
  return pterodactylRequest("client", `/api/client/servers/${identifier}/databases/${databaseId}/rotate-password`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function deleteGameServerDatabase(identifier: string, databaseId: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/databases/${databaseId}`, {
    method: "DELETE"
  });
}

export async function createGameServerSubuser(identifier: string, email: string, permissions: string[]) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/users`, {
    method: "POST",
    body: JSON.stringify({ email, permissions })
  });
}

export async function updateGameServerSubuser(identifier: string, userId: string, permissions: string[]) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/users/${userId}`, {
    method: "POST",
    body: JSON.stringify({ permissions })
  });
}

export async function deleteGameServerSubuser(identifier: string, userId: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/users/${userId}`, {
    method: "DELETE"
  });
}

export async function createGameServerSchedule(
  identifier: string,
  input: {
    name: string;
    minute: string;
    hour: string;
    dayOfMonth: string;
    month: string;
    dayOfWeek: string;
    onlyWhenOnline?: boolean;
    isActive?: boolean;
  }
) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/schedules`, {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      minute: input.minute,
      hour: input.hour,
      day_of_month: input.dayOfMonth,
      month: input.month,
      day_of_week: input.dayOfWeek,
      only_when_online: input.onlyWhenOnline ?? false,
      is_active: input.isActive ?? true
    })
  });
}

export async function executeGameServerSchedule(identifier: string, scheduleId: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/schedules/${scheduleId}/execute`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function deleteGameServerSchedule(identifier: string, scheduleId: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/schedules/${scheduleId}`, {
    method: "DELETE"
  });
}

export async function createGameServerScheduleTask(
  identifier: string,
  scheduleId: string,
  task: { action: string; payload: string; timeOffset: number; continueOnFailure?: boolean }
) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/schedules/${scheduleId}/tasks`, {
    method: "POST",
    body: JSON.stringify({
      action: task.action,
      payload: task.payload,
      time_offset: task.timeOffset,
      continue_on_failure: task.continueOnFailure ?? false
    })
  });
}

export async function deleteGameServerScheduleTask(identifier: string, scheduleId: string, taskId: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/schedules/${scheduleId}/tasks/${taskId}`, {
    method: "DELETE"
  });
}

export async function assignGameServerAllocation(identifier: string, ip?: string, port?: number) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/network/allocations`, {
    method: "POST",
    body: JSON.stringify({ ...(ip ? { ip } : {}), ...(port ? { port } : {}) })
  });
}

export async function setGameServerPrimaryAllocation(identifier: string, allocationId: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/network/allocations/${allocationId}/primary`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function updateGameServerAllocationNotes(identifier: string, allocationId: string, notes: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/network/allocations/${allocationId}`, {
    method: "POST",
    body: JSON.stringify({ notes })
  });
}

export async function removeGameServerAllocation(identifier: string, allocationId: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/network/allocations/${allocationId}`, {
    method: "DELETE"
  });
}

export async function updateGameServerStartupVariable(identifier: string, key: string, value: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/startup/variable`, {
    method: "PUT",
    body: JSON.stringify({ key, value })
  });
}

export async function renameGameServer(identifier: string, name: string, description = "") {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/settings/rename`, {
    method: "POST",
    body: JSON.stringify({ name, description })
  });
}

export async function reinstallGameServer(identifier: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/settings/reinstall`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function updateGameServerDockerImage(identifier: string, dockerImage: string) {
  await pterodactylRequest("client", `/api/client/servers/${identifier}/settings/docker-image`, {
    method: "PUT",
    body: JSON.stringify({ docker_image: dockerImage })
  });
}
