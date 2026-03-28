import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import { stateStore } from "./store.js";
import type { AuditEvent, DownloadRecord, MediaRecord, ServiceRecord } from "./types.js";

const execAsync = promisify(exec);

function cpuSnapshot() {
  const cpus = os.cpus();
  const idle = cpus.reduce((sum, cpu) => sum + cpu.times.idle, 0);
  const total = cpus.reduce(
    (sum, cpu) => sum + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle,
    0
  );

  return Math.round(((total - idle) / total) * 100);
}

async function dockerStatus(name: string) {
  try {
    const { stdout } = await execAsync(`docker inspect -f "{{.State.Status}}" ${name}`);
    return stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

async function dockerLogs(name: string) {
  try {
    const { stdout, stderr } = await execAsync(`docker logs --tail 50 ${name}`);
    return `${stdout}${stderr}`.trim();
  } catch (error) {
    return error instanceof Error ? error.message : "Unable to load logs";
  }
}

export async function getOverview() {
  const state = stateStore.getState();
  const serviceStatuses = await Promise.all(
    state.services.map(async (service) => ({
      id: service.id,
      status: service.type === "docker" ? await dockerStatus(service.target) : "external"
    }))
  );
  const onlineServices = serviceStatuses.filter((service) => service.status === "running").length;

  return {
    appName: config.appName,
    stats: {
      cpuPercent: cpuSnapshot(),
      memoryUsedMb: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024),
      memoryTotalMb: Math.round(os.totalmem() / 1024 / 1024),
      loadAverage: os.loadavg(),
      uptimeSeconds: Math.round(os.uptime()),
      host: os.hostname(),
      platform: `${os.platform()} ${os.release()}`
    },
    counters: {
      services: state.services.length,
      servicesOnline: onlineServices,
      devices: state.devices.length,
      activeDownloads: state.downloads.filter((download) => download.status === "running").length,
      mediaItems: state.media.length,
      workflows: state.workflows.length,
      alerts: state.networkEvents.filter((event) => event.severity !== "info").length
    },
    recentAudit: state.audit.slice(-12).reverse()
  };
}

export async function getServices() {
  const state = stateStore.getState();
  const statuses = await Promise.all(
    state.services.map(async (service) => ({
      ...service,
      runtimeStatus: service.type === "docker" ? await dockerStatus(service.target) : "external"
    }))
  );
  return statuses;
}

export async function runServiceAction(service: ServiceRecord, action: "start" | "stop" | "restart") {
  if (service.type !== "docker") {
    throw new Error(`Service ${service.name} does not support ${action}`);
  }

  await execAsync(`docker ${action} ${service.target}`);
  return getServices();
}

export async function getServiceLogs(service: ServiceRecord) {
  if (service.type !== "docker") {
    return `No log adapter configured for ${service.name}`;
  }

  return dockerLogs(service.target);
}

export async function enqueueDownload(url: string, targetName?: string) {
  const id = `download-${Date.now()}`;
  const targetPath = path.join(config.downloadsRoot, targetName ?? `${id}.bin`);
  const record: DownloadRecord = {
    id,
    url,
    targetPath,
    status: "running",
    progress: 0,
    bytesDownloaded: 0,
    retries: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  stateStore.update((draft) => {
    draft.downloads.push(record);
    draft.audit.push(createAudit("download.created", `Queued download ${url}`, "admin"));
  });

  void streamDownload(record);
  return record;
}

async function streamDownload(record: DownloadRecord) {
  try {
    const response = await fetch(record.url);
    if (!response.ok || !response.body) {
      throw new Error(`Download failed with status ${response.status}`);
    }

    const total = Number(response.headers.get("content-length") ?? 0) || undefined;
    const destination = fs.createWriteStream(record.targetPath);
    let downloaded = 0;

    for await (const chunk of response.body as unknown as AsyncIterable<Buffer>) {
      downloaded += chunk.length;
      destination.write(chunk);
      stateStore.update((draft) => {
        const item = draft.downloads.find((download) => download.id === record.id);
        if (item) {
          item.bytesDownloaded = downloaded;
          item.bytesTotal = total;
          item.progress = total ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
          item.updatedAt = new Date().toISOString();
        }
      });
    }

    destination.end();

    stateStore.update((draft) => {
      const item = draft.downloads.find((download) => download.id === record.id);
      if (item) {
        item.status = "completed";
        item.progress = 100;
        item.updatedAt = new Date().toISOString();
      }
      draft.audit.push(createAudit("download.completed", `Completed ${record.url}`, "system"));
    });
  } catch (error) {
    stateStore.update((draft) => {
      const item = draft.downloads.find((download) => download.id === record.id);
      if (item) {
        item.status = "failed";
        item.error = error instanceof Error ? error.message : "Unknown error";
        item.updatedAt = new Date().toISOString();
      }
      draft.audit.push(createAudit("download.failed", `Failed ${record.url}`, "system"));
    });
  }
}

export function scanMediaLibrary() {
  const supportedVideo = new Set([".mp4", ".mkv", ".avi", ".mov"]);
  const supportedAudio = new Set([".mp3", ".flac", ".wav", ".m4a"]);
  const subtitleExtensions = new Set([".srt", ".vtt", ".ass"]);
  const mediaRecords: MediaRecord[] = [];

  const walk = (currentPath: string) => {
    const entries = fs.existsSync(currentPath) ? fs.readdirSync(currentPath, { withFileTypes: true }) : [];

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!supportedVideo.has(extension) && !supportedAudio.has(extension)) {
        continue;
      }

      const folderEntries = fs.readdirSync(path.dirname(entryPath));
      const subtitleCount = folderEntries.filter((item) => subtitleExtensions.has(path.extname(item).toLowerCase())).length;
      mediaRecords.push({
        id: `media-${Buffer.from(entryPath).toString("base64url")}`,
        title: path.basename(entry.name, extension),
        type: supportedVideo.has(extension) ? (entryPath.toLowerCase().includes("season") ? "show" : "movie") : "track",
        path: entryPath,
        subtitleCount,
        detectedAt: new Date().toISOString()
      });
    }
  };

  walk(config.mediaRoot);

  stateStore.update((draft) => {
    draft.media = mediaRecords;
    draft.audit.push(createAudit("media.scan", `Scanned media library and found ${mediaRecords.length} items`, "system"));
  });

  return mediaRecords;
}

export function listFiles(rootPath = config.filesRoot) {
  const resolved = path.resolve(rootPath);
  const base = path.resolve(config.storageRoot);

  if (!resolved.startsWith(base)) {
    throw new Error("Path outside allowed storage root");
  }

  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }

  const entries = fs.readdirSync(resolved, { withFileTypes: true }).map((entry) => {
    const entryPath = path.join(resolved, entry.name);
    const stats = fs.statSync(entryPath);
    return {
      name: entry.name,
      path: entryPath,
      type: entry.isDirectory() ? "directory" : "file",
      size: stats.size,
      updatedAt: stats.mtime.toISOString()
    };
  });

  return {
    currentPath: resolved,
    entries
  };
}

export function appendAudit(type: string, message: string, actor: string) {
  stateStore.update((draft) => {
    draft.audit.push(createAudit(type, message, actor));
  });
}

function createAudit(type: string, message: string, actor: string): AuditEvent {
  return {
    id: `${type}-${Date.now()}`,
    type,
    message,
    actor,
    createdAt: new Date().toISOString()
  };
}
