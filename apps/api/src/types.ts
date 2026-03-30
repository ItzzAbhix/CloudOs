export type UserRole = "admin" | "user";

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  lastLoginAt?: string;
}

export interface SessionUser {
  id: string;
  username: string;
  role: UserRole;
}

export interface ServiceRecord {
  id: string;
  name: string;
  category:
    | "core"
    | "vpn"
    | "files"
    | "downloads"
    | "media"
    | "automation"
    | "security"
    | "utility"
    | "games";
  type: "docker" | "http" | "script" | "external";
  target: string;
  port?: number;
  description: string;
  actions: Array<"start" | "stop" | "restart" | "open">;
}

export interface DeviceRecord {
  id: string;
  name: string;
  status: "active" | "inactive" | "blocked";
  ipAddress: string;
  lastSeenAt: string;
  usageMb: number;
  killSwitchEnabled: boolean;
}

export interface FileTagRecord {
  path: string;
  tags: string[];
  notes?: string;
}

export interface DownloadRecord {
  id: string;
  url: string;
  targetPath: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  bytesDownloaded: number;
  bytesTotal?: number;
  retries: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface MediaRecord {
  id: string;
  title: string;
  type: "movie" | "show" | "track";
  path: string;
  subtitleCount: number;
  detectedAt: string;
}

export interface WorkflowRecord {
  id: string;
  name: string;
  trigger: string;
  action: string;
  enabled: boolean;
}

export interface RuleRecord {
  id: string;
  name: string;
  condition: string;
  action: string;
  enabled: boolean;
}

export interface NotificationTarget {
  id: string;
  name: string;
  type: "telegram" | "webhook";
  endpoint: string;
  enabled: boolean;
}

export interface ScriptRecord {
  id: string;
  name: string;
  command: string;
  description: string;
  schedule?: string;
}

export interface ShareLinkRecord {
  id: string;
  path: string;
  password?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface NetworkEvent {
  id: string;
  source: string;
  message: string;
  severity: "info" | "warn" | "error";
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  type: string;
  message: string;
  actor: string;
  createdAt: string;
}

export interface VpnPeerRecord {
  peerId: string;
  name: string;
  publicKey: string;
  publicKeyShort: string;
  endpoint: string;
  allowedIps: string;
  keepalive: string;
  rxHuman: string;
  txHuman: string;
  handshakeAgo: string;
  online: boolean;
  seenBefore?: boolean;
  disabled: boolean;
  blockedUntil?: number;
  blockedUntilHuman?: string;
}

export interface VpnDashboardData {
  interface: {
    name: string;
    up: boolean;
    publicKey: string;
    publicKeyShort: string;
    listenPort: string;
    addresses: string;
    endpointHint: string;
    configAccessible: boolean;
  };
  stats: {
    totalPeers: number;
    onlinePeers: number;
    totalRx: string;
    totalTx: string;
    latestHandshake: string;
    nextIp: string;
    pool: string;
    disabledPeers: number;
  };
  defaults: {
    endpoint?: string;
    dns: string;
    allowedIps: string;
    refreshSeconds: number;
  };
  peers: VpnPeerRecord[];
  generatedPeer: {
    name: string;
    address: string;
    publicKey: string;
    peerId: string;
    clientConfig: string;
  } | null;
  generatedConfigs: Array<{
    name: string;
    address: string;
    publicKey: string;
    peerId: string;
    clientConfig: string;
  }>;
  analytics: Array<{
    timestamp: number;
    onlinePeers: number;
    rxBytes: number;
    txBytes: number;
  }>;
  configText: string;
  configPath: string;
  generatedAt: string;
  backups?: Array<{ path: string; createdAt: string }>;
  system?: { hostname: string; uptime: string | number };
  error?: string;
}

export interface AppState {
  users: UserRecord[];
  services: ServiceRecord[];
  devices: DeviceRecord[];
  fileTags: FileTagRecord[];
  downloads: DownloadRecord[];
  media: MediaRecord[];
  workflows: WorkflowRecord[];
  rules: RuleRecord[];
  notifications: NotificationTarget[];
  scripts: ScriptRecord[];
  shareLinks: ShareLinkRecord[];
  networkEvents: NetworkEvent[];
  audit: AuditEvent[];
}
