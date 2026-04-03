import { config } from "./config.js";

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
};

type ApplicationNode = {
  id?: number;
  name?: string;
  fqdn?: string;
  scheme?: string;
  behind_proxy?: boolean;
  maintenance_mode?: boolean;
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
  limits?: { memory?: number; disk?: number; cpu?: number };
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

type GameServerSummary = {
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

type GamesDashboard = {
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

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function toRoundedMb(bytes: number) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function coerceNumber(value: unknown, fallback = 0) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function toAllocationString(server?: ApplicationServer) {
  const ip = server?.allocation?.ip;
  const alias = server?.allocation?.alias;
  const host = alias || ip;
  const port = server?.allocation?.port;
  if (!host && !port) return "Unassigned";
  if (!host) return `${port ?? "unknown"}`;
  if (!port) return host;
  return `${host}:${port}`;
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
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Pterodactyl request failed (${response.status})`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
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

async function listClientServers() {
  if (!config.pterodactylClientApiKey) return [];
  const payload = await pterodactylRequest<PterodactylCollection<ClientServer>>("client", "/api/client");
  return payload.data ?? [];
}

async function getClientResources(identifier: string) {
  if (!config.pterodactylClientApiKey) return null;
  const payload = await pterodactylRequest<{ attributes?: ClientResource }>(
    "client",
    `/api/client/servers/${identifier}/resources`
  );
  return payload.attributes ?? null;
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
      const resourceValues = resource?.resources;
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
        usage: resourceValues
          ? {
              memoryMb: toRoundedMb(coerceNumber(resourceValues.memory_bytes)),
              diskMb: toRoundedMb(coerceNumber(resourceValues.disk_bytes)),
              cpuPercent: Math.round(coerceNumber(resourceValues.cpu_absolute) * 10) / 10,
              networkRxMb: toRoundedMb(coerceNumber(resourceValues.network_rx_bytes)),
              networkTxMb: toRoundedMb(coerceNumber(resourceValues.network_tx_bytes)),
              uptimeSeconds: coerceNumber(resourceValues.uptime)
            }
          : null
      } satisfies GameServerSummary;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
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

export async function performGamePowerAction(identifier: string, signal: "start" | "stop" | "restart" | "kill") {
  await pterodactylRequest(
    "client",
    `/api/client/servers/${identifier}/power`,
    {
      method: "POST",
      body: JSON.stringify({ signal })
    }
  );
}
