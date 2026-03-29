import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

export const config = {
  port: Number(process.env.PORT ?? 4000),
  appName: "CloudOS Control Panel",
  repoRoot,
  dataRoot: process.env.CLOUDOS_DATA_ROOT ?? path.join(repoRoot, "data"),
  stateFile: process.env.CLOUDOS_STATE_FILE ?? path.join(repoRoot, "data", "cloudos-state.json"),
  storageRoot: process.env.CLOUDOS_STORAGE_ROOT ?? path.join(repoRoot, "data", "storage"),
  filesRoot: process.env.CLOUDOS_FILES_ROOT ?? path.join(repoRoot, "data", "storage", "files"),
  downloadsRoot: process.env.CLOUDOS_DOWNLOADS_ROOT ?? path.join(repoRoot, "data", "storage", "downloads"),
  mediaRoot: process.env.CLOUDOS_MEDIA_ROOT ?? path.join(repoRoot, "data", "storage", "media"),
  scriptsRoot: process.env.CLOUDOS_SCRIPTS_ROOT ?? path.join(repoRoot, "scripts"),
  jwtSecret: process.env.CLOUDOS_JWT_SECRET ?? "cloudos-dev-secret",
  cookieName: process.env.CLOUDOS_COOKIE_NAME ?? "cloudos_session",
  corsOrigin: process.env.CLOUDOS_CORS_ORIGIN ?? "http://localhost:4173",
  vpnStateFile: process.env.CLOUDOS_VPN_STATE_FILE ?? path.join(repoRoot, "data", "cloudos-vpn-state.json"),
  vpnInterface: process.env.WG_INTERFACE ?? "wg0",
  vpnConfigPath: process.env.WG_CONFIG_PATH ?? `/etc/wireguard/${process.env.WG_INTERFACE ?? "wg0"}.conf`,
  vpnDefaultDns: process.env.WG_DEFAULT_DNS ?? "1.1.1.1, 1.0.0.1",
  vpnDefaultAllowedIps: process.env.WG_DEFAULT_ALLOWED_IPS ?? "0.0.0.0/0",
  vpnServerEndpoint: process.env.WG_SERVER_ENDPOINT ?? "",
  vpnRefreshSeconds: Number(process.env.WG_REFRESH_SECONDS ?? 10),
  vpnUseSudo: process.env.WG_USE_SUDO === "1"
};
