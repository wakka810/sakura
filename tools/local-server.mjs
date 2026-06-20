import { constants as fsConstants, createReadStream } from "node:fs";
import { access, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { homedir, networkInterfaces } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { extractIconFromPe } from "./pe-icon.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webRoot = join(root, "web");
const defaultInstallDir = join(root, "サクラノ詩");
const installDir = resolve(process.env.SAKURA_INSTALL_DIR ?? defaultInstallDir);
const homeDir = homedir();
const host = process.env.SAKURA_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.SAKURA_PORT ?? "8787", 10);
const maxPayloadBytes = Number.parseInt(process.env.SAKURA_MAX_PAYLOAD_BYTES ?? "268435456", 10);
const upscaleDefaultScale = Number.parseInt(process.env.SAKURA_UPSCALE_DEFAULT_SCALE ?? "2", 10);
const upscaleCacheBudgetBytes = parseByteEnv(
  process.env.SAKURA_UPSCALE_RAM_CACHE_BYTES,
  16 * 1024 * 1024 * 1024,
  "SAKURA_UPSCALE_RAM_CACHE_BYTES",
);
const upscaleDiskCacheRoot = resolve(
  process.env.SAKURA_UPSCALE_CACHE_DIR ?? join(root, "asset-cache", "upscale-v1"),
);
const upscaleDiskCacheBudgetBytes = parseByteEnv(
  process.env.SAKURA_UPSCALE_DISK_CACHE_BYTES,
  64 * 1024 * 1024 * 1024,
  "SAKURA_UPSCALE_DISK_CACHE_BYTES",
);
const upscaleTmpRoot = resolve(process.env.SAKURA_UPSCALE_TMPDIR ?? "/dev/shm/sakura-upscale");
const upscaleConcurrency = parsePositiveInt(process.env.SAKURA_UPSCALE_CONCURRENCY ?? "1", "SAKURA_UPSCALE_CONCURRENCY");
const upscaleTimeoutMs = parsePositiveInt(process.env.SAKURA_UPSCALE_TIMEOUT_MS ?? "180000", "SAKURA_UPSCALE_TIMEOUT_MS");
const cloudStateDir = resolve(
  process.env.SAKURA_CLOUD_STATE_DIR ?? join(root, "asset-cache", "cloud-state-v1"),
);
const cloudStateMaxBytes = parseByteEnv(
  process.env.SAKURA_CLOUD_STATE_MAX_BYTES,
  16 * 1024 * 1024,
  "SAKURA_CLOUD_STATE_MAX_BYTES",
);
const cloudStatePath = join(cloudStateDir, "default.json");
const PAYLOAD_KIND_UNKNOWN = 0;
const PAYLOAD_KIND_DSC = 1;
const PAYLOAD_KIND_COMPRESSED_BG = 2;
const PAYLOAD_KIND_BGI_AUDIO = 3;
const UPSCALE_MODELS = new Set(["realesrgan", "hat", "waifu2x"]);
const UPSCALE_MODES = new Set(["fast", "quality"]);
const UPSCALE_ROLES = new Set(["visible", "ui", "mask"]);
const UPSCALE_SCALES = new Set([1, 2]);
const FONT_EXTENSIONS = new Set([".ttc", ".ttf", ".otf"]);
const FONT_FACE_DEFS = Object.freeze({
  "ms-gothic": {
    env: "SAKURA_MS_GOTHIC_FONT",
    names: ["msgothic.ttc", "msgothic.ttf", "ms gothic.ttf"],
  },
  "ms-mincho": {
    env: "SAKURA_MS_MINCHO_FONT",
    names: ["msmincho.ttc", "msmincho.ttf", "ms mincho.ttf"],
  },
});
const execFileP = promisify(execFile);

const state = {
  install: null,
  installPromise: null,
  corePromise: null,
  fontCatalogPromise: null,
  upscaleCapabilitiesPromise: null,
  upscaleCache: new Map(),
  upscaleCacheBytes: 0,
  upscaleDiskCacheBytes: 0,
  upscaleDiskCacheItems: 0,
  upscaleDiskCacheStatsReady: false,
  upscaleJobs: new Map(),
  upscaleQueue: [],
  upscaleRunning: 0,
  upscaleJobCounter: 0,
  faviconPromise: null,
};

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("SAKURA_PORT must be in 1..=65535");
}
if (!Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 1) {
  throw new Error("SAKURA_MAX_PAYLOAD_BYTES must be positive");
}
if (!UPSCALE_SCALES.has(upscaleDefaultScale)) {
  throw new Error("SAKURA_UPSCALE_DEFAULT_SCALE must be 1 or 2");
}

const server = createServer((request, response) => {
  void route(request, response).catch((error) => {
    sendJson(response, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error),
    });
  });
});

server.listen(port, host, () => {
  console.log(`sakura_local_server=ready`);
  console.log(`bind=${host}:${port}`);
  for (const url of advertisedUrls(host, port)) {
    console.log(`url=${url}`);
  }
  console.log(`install_dir=${installDir}`);
});

async function route(request, response) {
  if (!request.url || (request.method !== "GET" && request.method !== "POST")) {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }
  const url = new URL(request.url, serverUrlBase());
  if (url.pathname === "/api/cloud-state" && request.method === "GET") {
    await sendCloudState(response);
    return;
  }
  if (url.pathname === "/api/cloud-state" && request.method === "POST") {
    await saveCloudState(request, response);
    return;
  }
  if (url.pathname === "/api/upscale/capabilities" && request.method === "GET") {
    sendJson(response, 200, await upscaleCapabilities());
    return;
  }
  if (url.pathname === "/api/upscale/asset" && request.method === "GET") {
    await sendUpscaledAsset(url, response);
    return;
  }
  if (url.pathname === "/api/upscale/prewarm" && request.method === "POST") {
    await prewarmUpscaledAssets(request, response);
    return;
  }
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }
  if (url.pathname === "/api/install/catalog") {
    sendJson(response, 200, await installCatalog());
    return;
  }
  if (url.pathname === "/api/install/payload") {
    await sendPayload(url, response);
    return;
  }
  if (url.pathname === "/api/install/sidecar") {
    await sendSidecar(url, response);
    return;
  }
  if (url.pathname === "/api/install/favicon" || url.pathname === "/favicon.ico") {
    await sendInstallFavicon(response);
    return;
  }
  if (url.pathname === "/api/fonts/status") {
    sendJson(response, 200, await fontStatus());
    return;
  }
  if (url.pathname === "/api/fonts/ms-gothic") {
    await sendFont("ms-gothic", response);
    return;
  }
  if (url.pathname === "/api/fonts/ms-mincho") {
    await sendFont("ms-mincho", response);
    return;
  }
  await sendStatic(url.pathname, response);
}

async function installCatalog() {
  if (state.install) {
    return state.install.publicCatalog;
  }
  state.installPromise ??= buildInstallCatalog();
  state.install = await state.installPromise;
  return state.install.publicCatalog;
}

async function buildInstallCatalog() {
  const files = await collectInstallFiles(installDir);
  const rootStringsDbPath = resolve(installDir, "BGI.gdb");
  const archives = [];
  const sidecars = [];
  let bgiExePath = null;
  let exeCount = 0;
  let totalEntries = 0;

  for (const path of files) {
    if (basenameLower(path) === "bgi.exe") {
      exeCount += 1;
      bgiExePath ??= path;
      continue;
    }
    if (basenameLower(path) === "bgi.gdb") {
      if (resolve(path) !== rootStringsDbPath) {
        continue;
      }
      sidecars.push(await readSidecarCatalog(path, sidecars.length));
      continue;
    }
    if (extname(path).toLowerCase() !== ".arc") {
      continue;
    }
    const archive = await readArchiveCatalog(path, archives.length);
    if (!archive) {
      continue;
    }
    totalEntries += archive.entries.length;
    archives.push(archive);
  }

  const publicCatalog = {
    version: 1,
    exeCount,
    archiveCount: archives.length,
    sidecarCount: sidecars.length,
    entryCount: totalEntries,
    archives: archives.map((archive) => ({
      nameHex: Buffer.from(archive.name, "utf8").toString("hex"),
      size: archive.size,
      dataStart: archive.dataStart,
      manifestHex: archive.manifestHex,
      entries: archive.entries,
    })),
    sidecars: sidecars.map((sidecar) => ({
      sidecarIndex: sidecar.sidecarIndex,
      nameHex: Buffer.from(sidecar.name, "utf8").toString("hex"),
      size: sidecar.size,
    })),
  };
  return { publicCatalog, archives, sidecars, bgiExePath };
}

async function readSidecarCatalog(path, sidecarIndex) {
  const sidecarStat = await stat(path);
  return {
    sidecarIndex,
    name: path.split(sep).at(-1) ?? "",
    path,
    size: sidecarStat.size,
  };
}

async function readArchiveCatalog(path, archiveIndex) {
  const archiveStat = await stat(path);
  const file = await open(path, "r");
  try {
    const header = await readRangeFromHandle(file, 0, 16);
    if (header.length !== 16 || header.subarray(0, 12).toString("ascii") !== "BURIKO ARC20") {
      return null;
    }
    const entryCount = header.readUInt32LE(12);
    const prefixLength = 16 + entryCount * 128;
    if (!Number.isSafeInteger(prefixLength) || prefixLength > archiveStat.size) {
      return null;
    }
    const prefix = await readRangeFromHandle(file, 0, prefixLength);
    const entries = [];
    for (let index = 0; index < entryCount; index += 1) {
      const entryOffset = 16 + index * 128;
      const nameBytes = prefix.subarray(entryOffset, entryOffset + 96);
      const nameLength = nameBytes.indexOf(0);
      const cleanName = nameBytes.subarray(0, nameLength < 0 ? 96 : nameLength);
      const offset = prefix.readUInt32LE(entryOffset + 96);
      const size = prefix.readUInt32LE(entryOffset + 100);
      const payloadPrefix = await readRangeFromHandle(
        file,
        prefixLength + offset,
        Math.min(size, 0x30),
      );
      const kind = sniffPayloadKind(payloadPrefix);
      entries.push({
        archiveIndex,
        entryIndex: index,
        nameHex: cleanName.toString("hex"),
        offset,
        size,
        kind,
        meta: payloadMeta(kind, payloadPrefix),
      });
    }
    return {
      name: path.split(sep).at(-1) ?? "",
      path,
      size: archiveStat.size,
      dataStart: prefixLength,
      manifestHex: buildArchiveManifestHex(prefixLength, entries),
      entries,
    };
  } finally {
    await file.close();
  }
}

function buildArchiveManifestHex(dataStart, entries) {
  let length = 12;
  for (const entry of entries) {
    length += 10 + entry.nameHex.length / 2;
  }
  const manifest = Buffer.alloc(length);
  manifest.writeUInt32LE(entries.length, 0);
  manifest.writeBigUInt64LE(BigInt(dataStart), 4);
  let cursor = 12;
  for (const entry of entries) {
    const name = Buffer.from(entry.nameHex, "hex");
    manifest.writeUInt16LE(name.length, cursor);
    manifest.writeUInt32LE(entry.offset, cursor + 2);
    manifest.writeUInt32LE(entry.size, cursor + 6);
    cursor += 10;
    name.copy(manifest, cursor);
    cursor += name.length;
  }
  return manifest.toString("hex");
}

async function sendPayload(url, response) {
  const archiveIndex = parseBoundedInt(url.searchParams.get("archive"), "archive");
  const entryRaw = url.searchParams.get("entry");
  const entryIndex = entryRaw === null ? null : parseBoundedInt(entryRaw, "entry");
  const offset = parseBoundedInt(url.searchParams.get("offset") ?? "0", "offset");
  const length = parseBoundedInt(url.searchParams.get("length") ?? "", "length");
  await installCatalog();
  const archive = state.install?.archives[archiveIndex];
  if (!archive) {
    sendJson(response, 404, { error: "asset_not_found" });
    return;
  }
  const entry = entryIndex === null ? null : archive?.entries[entryIndex];
  const sourceSize = entry ? entry.size : archive.size;
  if (entryIndex !== null && (!entry || entry.archiveIndex !== archiveIndex || entry.entryIndex !== entryIndex)) {
    sendJson(response, 404, { error: "asset_not_found" });
    return;
  }
  if (offset > sourceSize || length > maxPayloadBytes || offset + length > sourceSize) {
    sendJson(response, 416, { error: "invalid_asset_range" });
    return;
  }

  const start = entry ? archive.dataStart + entry.offset + offset : offset;
  const endInclusive = start + length - 1;
  response.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(length),
    "Cache-Control": "no-store",
  });
  if (length === 0) {
    response.end();
    return;
  }
  createReadStream(archive.path, { start, end: endInclusive }).pipe(response);
}

async function sendSidecar(url, response) {
  const sidecarIndex = parseBoundedInt(url.searchParams.get("sidecar"), "sidecar");
  const offset = parseBoundedInt(url.searchParams.get("offset") ?? "0", "offset");
  const length = parseBoundedInt(url.searchParams.get("length") ?? "", "length");
  await installCatalog();
  const sidecar = state.install?.sidecars[sidecarIndex];
  if (!sidecar) {
    sendJson(response, 404, { error: "asset_not_found" });
    return;
  }
  if (offset > sidecar.size || length > maxPayloadBytes || offset + length > sidecar.size) {
    sendJson(response, 416, { error: "invalid_asset_range" });
    return;
  }
  response.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(length),
    "Cache-Control": "no-store",
  });
  if (length === 0) {
    response.end();
    return;
  }
  createReadStream(sidecar.path, { start: offset, end: offset + length - 1 }).pipe(response);
}

async function sendInstallFavicon(response) {
  const icon = await installFavicon();
  if (!icon) {
    sendJson(response, 404, { error: "favicon_not_found" });
    return;
  }
  response.writeHead(200, {
    "Content-Type": "image/x-icon",
    "Content-Length": String(icon.length),
    "Cache-Control": "no-store",
  });
  response.end(icon);
}

async function installFavicon() {
  await installCatalog();
  const exePath = state.install?.bgiExePath ?? null;
  if (!exePath) {
    return null;
  }
  state.faviconPromise ??= readFile(exePath)
    .then((exe) => extractIconFromPe(exe))
    .catch(() => null);
  return await state.faviconPromise;
}

async function fontStatus() {
  const catalog = await resolveFontCatalog();
  return {
    version: 1,
    faces: Object.fromEntries(
      Object.entries(catalog).map(([face, entry]) => [face, publicFontEntry(entry)]),
    ),
  };
}

async function sendFont(face, response) {
  const catalog = await resolveFontCatalog();
  const entry = catalog[face] ?? null;
  if (!entry?.path) {
    sendJson(response, 404, {
      error: "font_not_found",
      face,
      env: FONT_FACE_DEFS[face]?.env ?? "",
    });
    return;
  }
  await sendFile(entry.path, response);
}

async function resolveFontCatalog() {
  state.fontCatalogPromise ??= buildFontCatalog();
  return state.fontCatalogPromise;
}

async function buildFontCatalog() {
  const roots = await fontSearchRoots();
  const out = {};
  for (const [face, def] of Object.entries(FONT_FACE_DEFS)) {
    out[face] = await resolveFontFace(def, roots);
  }
  return out;
}

async function resolveFontFace(def, roots) {
  const override = process.env[def.env];
  if (override) {
    const entry = await validateFontFile(resolve(override), "env");
    if (entry) {
      return entry;
    }
  }
  const candidates = new Set(def.names.map((name) => name.toLowerCase()));
  for (const rootDir of roots) {
    const match = await findFontInRoot(rootDir, candidates, 3);
    if (match) {
      return match;
    }
  }
  return { found: false, path: "", basename: "", size: 0, source: "" };
}

async function fontSearchRoots() {
  const roots = [
    join(root, "asset-cache", "fonts"),
    join(installDir, "Fonts"),
    join(installDir, "fonts"),
    join(homeDir, ".wine", "drive_c", "windows", "Fonts"),
    join(homeDir, ".local", "share", "Steam", "steamapps", "common", "Proton - Experimental", "files", "share", "fonts"),
    join(homeDir, ".local", "share", "Steam", "steamapps", "common", "Proton Hotfix", "files", "share", "fonts"),
    join(homeDir, ".local", "share", "fonts"),
    "/usr/local/share/fonts",
    "/usr/share/fonts",
  ];
  const compatRoot = join(homeDir, ".local", "share", "Steam", "steamapps", "compatdata");
  let compatDirs = [];
  try {
    compatDirs = await readdir(compatRoot, { withFileTypes: true });
  } catch {
    compatDirs = [];
  }
  for (const dirent of compatDirs) {
    if (dirent.isDirectory()) {
      roots.push(join(compatRoot, dirent.name, "pfx", "drive_c", "windows", "Fonts"));
    }
  }
  return roots;
}

async function findFontInRoot(rootDir, candidates, depth) {
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!candidates.has(entry.name.toLowerCase())) {
      continue;
    }
    const valid = await validateFontFile(join(rootDir, entry.name), "search");
    if (valid) {
      return valid;
    }
  }
  if (depth <= 0) {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const nested = await findFontInRoot(join(rootDir, entry.name), candidates, depth - 1);
    if (nested) {
      return nested;
    }
  }
  return null;
}

async function validateFontFile(path, source) {
  if (!FONT_EXTENSIONS.has(extname(path).toLowerCase())) {
    return null;
  }
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch {
    return null;
  }
  if (!fileStat.isFile()) {
    return null;
  }
  return {
    found: true,
    path,
    basename: basename(path),
    size: fileStat.size,
    source,
  };
}

function publicFontEntry(entry) {
  return {
    found: entry?.found === true,
    basename: entry?.basename ?? "",
    size: entry?.size ?? 0,
    source: entry?.source ?? "",
  };
}

async function sendUpscaledAsset(url, response) {
  let request;
  try {
    request = parseUpscaleRequest(url);
  } catch (error) {
    sendJson(response, 400, {
      error: "invalid_upscale_request",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  await installCatalog();
  const archive = state.install?.archives[request.archiveIndex];
  const entry = archive?.entries[request.entryIndex];
  if (!archive || !entry || entry.archiveIndex !== request.archiveIndex || entry.entryIndex !== request.entryIndex) {
    sendJson(response, 404, { error: "asset_not_found" });
    return;
  }
  if (entry.size > maxPayloadBytes) {
    sendJson(response, 413, { error: "asset_too_large" });
    return;
  }

  const key = upscaleCacheKey(entry, request);
  const cached = await getUpscaleCache(key);
  if (cached) {
    sendUpscalePacket(response, cached);
    return;
  }

  const capabilities = await upscaleCapabilities();
  const model = capabilities.models.find((candidate) => candidate.id === request.model);
  if (!model?.available && request.role !== "mask" && request.scale !== 1) {
    sendJson(response, 503, {
      error: "upscale_model_unavailable",
      model: request.model,
      reason: model?.reason ?? "unknown model",
    });
    return;
  }

  const frontPriority = request.role !== "ui";
  const job = queueUpscaleJob({
    key,
    archiveIndex: request.archiveIndex,
    entryIndex: request.entryIndex,
    entryNameHex: entry.nameHex,
    entrySize: entry.size,
    request,
  }, {
    promote: frontPriority,
    priority: frontPriority ? "front" : "normal",
  });
  if (job.status === "error") {
    sendJson(response, 500, {
      error: "upscale_failed",
      message: job.errorMessage ?? "upscale job failed",
    });
    return;
  }
  if (job.status === "ready") {
    const ready = getUpscaleCache(key);
    if (ready) {
      sendUpscalePacket(response, ready);
      return;
    }
  }

  response.setHeader("Retry-After", "1");
  sendJson(response, 202, {
    status: job.status,
    key,
    retryAfterMs: 500,
  });
}

async function prewarmUpscaledAssets(request, response) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, {
      error: "invalid_json",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (!Array.isArray(body?.assets)) {
    sendJson(response, 400, { error: "assets must be an array" });
    return;
  }

  const urlBase = serverUrlBase();
  const queued = [];
  for (const asset of body.assets.slice(0, 256)) {
    const url = new URL("/api/upscale/asset", urlBase);
    for (const [key, value] of Object.entries(asset ?? {})) {
      url.searchParams.set(key, String(value));
    }
    try {
      const parsed = parseUpscaleRequest(url);
      await installCatalog();
      const archive = state.install?.archives[parsed.archiveIndex];
      const entry = archive?.entries[parsed.entryIndex];
      if (!archive || !entry || entry.archiveIndex !== parsed.archiveIndex || entry.entryIndex !== parsed.entryIndex) {
        continue;
      }
      const cacheKey = upscaleCacheKey(entry, parsed);
      if (!(await getUpscaleCache(cacheKey))) {
        const job = queueUpscaleJob({
          key: cacheKey,
          archiveIndex: parsed.archiveIndex,
          entryIndex: parsed.entryIndex,
          entryNameHex: entry.nameHex,
          entrySize: entry.size,
          request: parsed,
        });
        queued.push({ key: cacheKey, status: job.status });
      }
    } catch {
      continue;
    }
  }
  sendJson(response, 202, { queued });
}

function parseUpscaleRequest(url) {
  const archiveIndex = parseBoundedInt(url.searchParams.get("archive"), "archive");
  const entryIndex = parseBoundedInt(url.searchParams.get("entry"), "entry");
  const scale = parseBoundedInt(url.searchParams.get("scale") ?? String(upscaleDefaultScale), "scale");
  const model = (url.searchParams.get("model") ?? "realesrgan").toLowerCase();
  const mode = (url.searchParams.get("mode") ?? "fast").toLowerCase();
  const role = (url.searchParams.get("role") ?? "visible").toLowerCase();
  if (!UPSCALE_SCALES.has(scale)) {
    throw new Error("scale must be 1 or 2");
  }
  if (!UPSCALE_MODELS.has(model)) {
    throw new Error("model must be realesrgan, hat, or waifu2x");
  }
  if (!UPSCALE_MODES.has(mode)) {
    throw new Error("mode must be fast or quality");
  }
  if (!UPSCALE_ROLES.has(role)) {
    throw new Error("role must be visible, ui, or mask");
  }
  return { archiveIndex, entryIndex, scale, model, mode, role };
}

async function upscaleCapabilities() {
  state.upscaleCapabilitiesPromise ??= detectUpscaleCapabilities();
  const detected = await state.upscaleCapabilitiesPromise;
  await refreshUpscaleDiskCacheStats();
  return {
    version: 1,
    defaultScale: upscaleDefaultScale,
    supportedScales: [...UPSCALE_SCALES].sort((a, b) => a - b),
    supportedModes: [...UPSCALE_MODES].sort(),
    supportedRoles: [...UPSCALE_ROLES].sort(),
    cache: {
      kind: "ram+disk",
      ramBudgetBytes: upscaleCacheBudgetBytes,
      usedBytes: state.upscaleCacheBytes,
      itemCount: state.upscaleCache.size,
      diskPath: upscaleDiskCacheRoot,
      diskBudgetBytes: upscaleDiskCacheBudgetBytes,
      diskUsedBytes: state.upscaleDiskCacheBytes,
      diskItemCount: state.upscaleDiskCacheItems,
    },
    queue: {
      concurrency: upscaleConcurrency,
      running: state.upscaleRunning,
      queued: state.upscaleQueue.length,
    },
    tmpfs: {
      path: upscaleTmpRoot,
    },
    models: detected.models,
  };
}

async function detectUpscaleCapabilities() {
  const realesrgan = await modelCommandCapability(
    "realesrgan",
    process.env.SAKURA_REALESRGAN_BIN ?? "realesrgan-ncnn-vulkan",
    "Real-ESRGAN NCNN Vulkan",
  );
  const waifu2x = await modelCommandCapability(
    "waifu2x",
    process.env.SAKURA_WAIFU2X_BIN ?? "waifu2x-ncnn-vulkan",
    "waifu2x NCNN Vulkan",
  );
  const hat = await modelCommandCapability(
    "hat",
    process.env.SAKURA_HAT_COMMAND ?? "sakura-hat-upscale",
    "HAT",
  );
  return { models: [realesrgan, hat, waifu2x] };
}

async function modelCommandCapability(id, command, label) {
  const resolved = await findExecutable(command);
  if (!resolved) {
    return { id, label, available: false, reason: `${command} was not found in PATH` };
  }
  return { id, label, available: true, command: resolved };
}

async function findExecutable(command) {
  if (!command) {
    return null;
  }
  const candidates = command.includes("/") || command.includes("\\")
    ? [resolve(command)]
    : (process.env.PATH ?? "")
        .split(":")
        .filter(Boolean)
        .map((dir) => join(dir, command));
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Keep scanning PATH.
    }
  }
  return null;
}

function queueUpscaleJob(jobInput, options = {}) {
  const existing = state.upscaleJobs.get(jobInput.key);
  if (existing) {
    existing.lastRequestedAt = Date.now();
    existing.requestCount = (existing.requestCount ?? 1) + 1;
    if (options.promote === true && existing.status === "queued") {
      promoteQueuedUpscaleJob(existing);
    }
    return existing;
  }
  const now = Date.now();
  const job = {
    ...jobInput,
    id: ++state.upscaleJobCounter,
    status: "queued",
    errorMessage: null,
    createdAt: now,
    lastRequestedAt: now,
    requestCount: 1,
  };
  state.upscaleJobs.set(job.key, job);
  if (options.priority === "front") {
    state.upscaleQueue.unshift(job);
  } else {
    state.upscaleQueue.push(job);
  }
  pumpUpscaleQueue();
  return job;
}

function promoteQueuedUpscaleJob(job) {
  const index = state.upscaleQueue.indexOf(job);
  if (index <= 0) {
    return;
  }
  state.upscaleQueue.splice(index, 1);
  state.upscaleQueue.unshift(job);
}

function pumpUpscaleQueue() {
  while (state.upscaleRunning < upscaleConcurrency && state.upscaleQueue.length > 0) {
    const job = state.upscaleQueue.shift();
    if (!job || job.status !== "queued") {
      continue;
    }
    state.upscaleRunning += 1;
    job.status = "running";
    void runUpscaleJob(job).finally(() => {
      state.upscaleRunning -= 1;
      pumpUpscaleQueue();
    });
  }
}

async function runUpscaleJob(job) {
  try {
    await installCatalog();
    const archive = state.install?.archives[job.archiveIndex];
    const entry = archive?.entries[job.entryIndex];
    if (!archive || !entry) {
      throw new Error("asset no longer exists in install catalog");
    }
    const payload = await readRange(archive.path, archive.dataStart + entry.offset, entry.size);
    const sourcePacket = await decodeImageRgbaPacket(payload);
    const packet = await upscaleRgbaPacket(sourcePacket, job.request, job.id);
    const source = parseRgbaHeader(sourcePacket);
    const output = parseRgbaHeader(packet);
    await putUpscaleCache(job.key, {
      key: job.key,
      packet,
      bytes: packet.byteLength,
      logicalWidth: source.width,
      logicalHeight: source.height,
      width: output.width,
      height: output.height,
      scale: job.request.scale,
      model: job.request.model,
      mode: job.request.mode,
      role: job.request.role,
      createdAt: Date.now(),
    });
    job.status = "ready";
    expireJobSoon(job, 60_000);
  } catch (error) {
    job.status = "error";
    job.errorMessage = error instanceof Error ? error.message : String(error);
    expireJobSoon(job, 300_000);
  }
}

function expireJobSoon(job, delayMs) {
  const timer = setTimeout(() => {
    if (state.upscaleJobs.get(job.key) === job) {
      state.upscaleJobs.delete(job.key);
    }
  }, delayMs);
  timer.unref?.();
}

async function getUpscaleCache(key) {
  const memoryCached = getUpscaleMemoryCache(key);
  if (memoryCached) {
    return { ...memoryCached, cacheSource: "ram" };
  }
  const diskCached = await readUpscaleDiskCache(key);
  if (!diskCached) {
    return null;
  }
  putUpscaleMemoryCache(key, diskCached);
  return { ...diskCached, cacheSource: "disk" };
}

function getUpscaleMemoryCache(key) {
  const cached = state.upscaleCache.get(key);
  if (!cached) {
    return null;
  }
  state.upscaleCache.delete(key);
  state.upscaleCache.set(key, cached);
  return cached;
}

async function putUpscaleCache(key, value) {
  putUpscaleMemoryCache(key, value);
  await writeUpscaleDiskCache(value).catch(() => {});
}

function putUpscaleMemoryCache(key, value) {
  const previous = state.upscaleCache.get(key);
  if (previous) {
    state.upscaleCacheBytes -= previous.bytes;
    state.upscaleCache.delete(key);
  }
  state.upscaleCache.set(key, value);
  state.upscaleCacheBytes += value.bytes;
  evictUpscaleCache();
}

async function readUpscaleDiskCache(key) {
  if (upscaleDiskCacheBudgetBytes <= 0) {
    return null;
  }
  const paths = upscaleDiskCachePaths(key);
  let meta;
  let packet;
  try {
    const [encoded, cachedPacket] = await Promise.all([
      readFile(paths.meta, "utf8"),
      readFile(paths.packet),
    ]);
    meta = JSON.parse(encoded);
    packet = cachedPacket;
  } catch {
    return null;
  }
  if (
    meta?.version !== 1
    || meta.key !== key
    || !Number.isSafeInteger(meta.logicalWidth)
    || !Number.isSafeInteger(meta.logicalHeight)
    || meta.logicalWidth <= 0
    || meta.logicalHeight <= 0
  ) {
    return null;
  }
  let parsed;
  try {
    parsed = parseRgbaHeader(packet);
  } catch {
    return null;
  }
  return {
    key,
    packet,
    bytes: packet.byteLength,
    logicalWidth: meta.logicalWidth,
    logicalHeight: meta.logicalHeight,
    width: parsed.width,
    height: parsed.height,
    scale: meta.scale,
    model: meta.model,
    mode: meta.mode,
    role: meta.role,
    createdAt: meta.createdAt ?? Date.now(),
  };
}

async function writeUpscaleDiskCache(value) {
  if (upscaleDiskCacheBudgetBytes <= 0) {
    return;
  }
  const paths = upscaleDiskCachePaths(value.key);
  await mkdir(paths.dir, { recursive: true });
  const now = Date.now();
  const meta = {
    version: 1,
    key: value.key,
    bytes: value.packet.byteLength,
    logicalWidth: value.logicalWidth,
    logicalHeight: value.logicalHeight,
    width: value.width,
    height: value.height,
    scale: value.scale,
    model: value.model,
    mode: value.mode,
    role: value.role,
    createdAt: value.createdAt ?? now,
    updatedAt: now,
  };
  const suffix = `${process.pid}.${now}.${Math.random().toString(16).slice(2)}.tmp`;
  const packetTmp = `${paths.packet}.${suffix}`;
  const metaTmp = `${paths.meta}.${suffix}`;
  await writeFile(packetTmp, value.packet);
  await rename(packetTmp, paths.packet);
  await writeFile(metaTmp, `${JSON.stringify(meta)}\n`);
  await rename(metaTmp, paths.meta);
  state.upscaleDiskCacheStatsReady = false;
  await evictUpscaleDiskCache();
}

function upscaleDiskCachePaths(key) {
  const digest = createHash("sha256").update(key).digest("hex");
  const dir = join(upscaleDiskCacheRoot, digest.slice(0, 2));
  return {
    dir,
    packet: join(dir, `${digest}.rgba`),
    meta: join(dir, `${digest}.json`),
  };
}

function evictUpscaleCache() {
  while (state.upscaleCacheBytes > upscaleCacheBudgetBytes && state.upscaleCache.size > 0) {
    const [oldestKey, oldestValue] = state.upscaleCache.entries().next().value;
    state.upscaleCache.delete(oldestKey);
    state.upscaleCacheBytes -= oldestValue.bytes;
  }
}

async function refreshUpscaleDiskCacheStats() {
  if (state.upscaleDiskCacheStatsReady) {
    return;
  }
  const entries = await listUpscaleDiskCacheEntries();
  state.upscaleDiskCacheBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  state.upscaleDiskCacheItems = entries.length;
  state.upscaleDiskCacheStatsReady = true;
}

async function evictUpscaleDiskCache() {
  const entries = await listUpscaleDiskCacheEntries();
  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (total <= upscaleDiskCacheBudgetBytes) {
    state.upscaleDiskCacheBytes = total;
    state.upscaleDiskCacheItems = entries.length;
    state.upscaleDiskCacheStatsReady = true;
    return;
  }
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let kept = entries.length;
  for (const entry of entries) {
    if (total <= upscaleDiskCacheBudgetBytes) {
      break;
    }
    await rm(entry.packetPath, { force: true });
    await rm(entry.metaPath, { force: true });
    total -= entry.bytes;
    kept -= 1;
  }
  state.upscaleDiskCacheBytes = Math.max(0, total);
  state.upscaleDiskCacheItems = Math.max(0, kept);
  state.upscaleDiskCacheStatsReady = true;
}

async function listUpscaleDiskCacheEntries() {
  let dirs;
  try {
    dirs = await readdir(upscaleDiskCacheRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const entries = [];
  for (const dirent of dirs) {
    if (!dirent.isDirectory() || !/^[0-9a-f]{2}$/i.test(dirent.name)) {
      continue;
    }
    const dir = join(upscaleDiskCacheRoot, dirent.name);
    let files;
    try {
      files = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".rgba")) {
        continue;
      }
      const packetPath = join(dir, file.name);
      const metaPath = join(dir, `${file.name.slice(0, -".rgba".length)}.json`);
      try {
        const packetStat = await stat(packetPath);
        entries.push({
          packetPath,
          metaPath,
          bytes: packetStat.size,
          mtimeMs: packetStat.mtimeMs,
        });
      } catch {
        continue;
      }
    }
  }
  return entries;
}

function sendUpscalePacket(response, cached) {
  response.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(cached.packet.byteLength),
    "Cache-Control": "no-store",
    "X-Sakura-Upscale-Status": "ready",
    "X-Sakura-Upscale-Scale": String(cached.scale),
    "X-Sakura-Upscale-Model": cached.model,
    "X-Sakura-Upscale-Mode": cached.mode,
    "X-Sakura-Upscale-Role": cached.role,
    "X-Sakura-Upscale-Cache": cached.cacheSource ?? "ram",
    "X-Sakura-Logical-Width": String(cached.logicalWidth),
    "X-Sakura-Logical-Height": String(cached.logicalHeight),
  });
  response.end(cached.packet);
}

function upscaleCacheKey(entry, request) {
  return [
    request.archiveIndex,
    request.entryIndex,
    entry.size,
    request.scale,
    request.model,
    request.mode,
    request.role,
  ].join(":");
}

async function decodeImageRgbaPacket(payload) {
  const exports = await coreExports();
  const ptr = allocWasm(exports, payload.byteLength);
  try {
    new Uint8Array(exports.memory.buffer, ptr, payload.byteLength).set(payload);
    const packetLength = exports.sakura_image_rgba_len(ptr, payload.byteLength) >>> 0;
    if (packetLength === 0xffffffff) {
      throw new Error("asset is not a decodable image");
    }
    const packetPtr = allocWasm(exports, packetLength);
    try {
      const written = exports.sakura_image_rgba_write(ptr, payload.byteLength, packetPtr, packetLength) >>> 0;
      if (written !== packetLength) {
        throw new Error("image decoder returned an unexpected packet length");
      }
      return Buffer.from(new Uint8Array(exports.memory.buffer, packetPtr, packetLength));
    } finally {
      deallocWasm(exports, packetPtr, packetLength);
    }
  } finally {
    deallocWasm(exports, ptr, payload.byteLength);
  }
}

async function coreExports() {
  state.corePromise ??= (async () => {
    const wasmPath = join(webRoot, "pkg", "sakura_core.wasm");
    const bytes = await readFile(wasmPath);
    const module = await WebAssembly.instantiate(bytes, {});
    return module.instance.exports;
  })();
  return await state.corePromise;
}

function allocWasm(exports, len) {
  const ptr = exports.sakura_alloc(len) >>> 0;
  if (ptr === 0) {
    throw new Error("WASM allocation failed");
  }
  return ptr;
}

function deallocWasm(exports, ptr, len) {
  exports.sakura_dealloc(ptr >>> 0, len);
}

async function upscaleRgbaPacket(sourcePacket, request, jobId) {
  if (request.scale === 1) {
    return Buffer.from(sourcePacket);
  }
  const helper = join(root, "tools", "upscale-image-helper.py");
  const jobDir = join(upscaleTmpRoot, `${process.pid}-${jobId}`);
  await mkdir(jobDir, { recursive: true });
  try {
    const sourcePath = join(jobDir, "source.rgba");
    const inputPngPath = join(jobDir, "input.png");
    const modelPngPath = join(jobDir, "model.png");
    const outputPath = join(jobDir, "output.rgba");
    await writeFile(sourcePath, sourcePacket);

    if (request.role === "mask") {
      await runPythonHelper(helper, ["resize-packet", sourcePath, outputPath, "--scale", String(request.scale), "--resample", "lanczos"]);
      return await readFile(outputPath);
    }

    await runPythonHelper(helper, ["packet-to-png", sourcePath, inputPngPath]);
    await runUpscaleModel(request, inputPngPath, modelPngPath);
    await runPythonHelper(helper, ["merge-rgb-with-alpha", modelPngPath, sourcePath, outputPath]);
    return await readFile(outputPath);
  } finally {
    await rm(jobDir, { recursive: true, force: true });
  }
}

async function runPythonHelper(helper, args) {
  await runCommand("python3", [helper, ...args], upscaleTimeoutMs);
}

async function runUpscaleModel(request, inputPath, outputPath) {
  const capabilities = await upscaleCapabilities();
  const capability = capabilities.models.find((model) => model.id === request.model);
  if (!capability?.available || !capability.command) {
    throw new Error(`${request.model} is not available`);
  }
  switch (request.model) {
    case "realesrgan":
      await runRealEsrgan(capability.command, request, inputPath, outputPath);
      return;
    case "waifu2x":
      await runWaifu2x(capability.command, request, inputPath, outputPath);
      return;
    case "hat":
      await runHat(capability.command, request, inputPath, outputPath);
      return;
    default:
      throw new Error(`unsupported upscale model: ${request.model}`);
  }
}

async function runRealEsrgan(command, request, inputPath, outputPath) {
  const modelName = request.mode === "quality" ? "realesrgan-x4plus-anime" : "realesr-animevideov3";
  await runCommand(command, [
    "-i",
    inputPath,
    "-o",
    outputPath,
    "-s",
    String(request.scale),
    "-n",
    modelName,
    "-f",
    "png",
  ], upscaleTimeoutMs);
}

async function runWaifu2x(command, request, inputPath, outputPath) {
  const noise = request.mode === "quality" ? "1" : "-1";
  await runCommand(command, [
    "-i",
    inputPath,
    "-o",
    outputPath,
    "-s",
    String(request.scale),
    "-n",
    noise,
    "-f",
    "png",
  ], upscaleTimeoutMs);
}

async function runHat(command, request, inputPath, outputPath) {
  await runCommand(command, [
    "--input",
    inputPath,
    "--output",
    outputPath,
    "--scale",
    String(request.scale),
    "--mode",
    request.mode,
  ], upscaleTimeoutMs);
}

async function runCommand(command, args, timeout) {
  try {
    await execFileP(command, args, {
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
    const detail = stderr || stdout || (error instanceof Error ? error.message : String(error));
    throw new Error(`${command} failed: ${detail}`);
  }
}

function parseRgbaHeader(packet) {
  if (packet.byteLength < 16) {
    throw new Error("RGBA packet is too short");
  }
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  const stride = view.getUint32(8, true);
  const byteLength = view.getUint32(12, true);
  if (width <= 0 || height <= 0 || stride < width * 4 || 16 + byteLength !== packet.byteLength) {
    throw new Error("invalid RGBA packet");
  }
  return { width, height, stride, byteLength };
}

async function sendCloudState(response) {
  let encoded;
  try {
    encoded = await readFile(cloudStatePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      sendJson(response, 404, { error: "cloud_state_missing" });
      return;
    }
    throw error;
  }
  let parsed;
  try {
    parsed = normalizeCloudStatePayload(JSON.parse(encoded));
  } catch (error) {
    sendJson(response, 500, {
      error: "cloud_state_corrupt",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  sendJson(response, 200, parsed);
}

async function saveCloudState(request, response) {
  let body;
  try {
    body = await readJsonBody(request, cloudStateMaxBytes);
  } catch (error) {
    sendJson(response, 400, {
      error: "invalid_cloud_state_json",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  let normalized;
  try {
    normalized = normalizeCloudStatePayload(body);
  } catch (error) {
    sendJson(response, 400, {
      error: "invalid_cloud_state",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  const encoded = `${JSON.stringify(normalized, null, 2)}\n`;
  const byteLength = Buffer.byteLength(encoded);
  if (byteLength > cloudStateMaxBytes) {
    sendJson(response, 413, { error: "cloud_state_too_large" });
    return;
  }
  await mkdir(cloudStateDir, { recursive: true });
  const tmp = join(cloudStateDir, `.default.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmp, encoded, { mode: 0o600 });
  await rename(tmp, cloudStatePath);
  sendJson(response, 200, {
    ok: true,
    metadata: normalized.metadata,
  });
}

function normalizeCloudStatePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("cloud state must be an object");
  }
  if (value.version !== 1) {
    throw new Error("cloud state version must be 1");
  }
  if (!value.localStorage || typeof value.localStorage !== "object" || Array.isArray(value.localStorage)) {
    throw new Error("cloud state localStorage must be an object");
  }
  const localStorage = Object.create(null);
  for (const key of Object.keys(value.localStorage).sort()) {
    if (key.length > 4096) {
      throw new Error("cloud state key is too long");
    }
    const item = value.localStorage[key];
    if (typeof item !== "string") {
      throw new Error(`cloud state value for ${key} must be a string`);
    }
    localStorage[key] = item;
  }
  const savedAt = typeof value.savedAt === "string" && value.savedAt.length <= 64
    ? value.savedAt
    : new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
  const origin = typeof value.origin === "string" && value.origin.length <= 2048
    ? value.origin
    : "";
  return {
    version: 1,
    savedAt,
    origin,
    localStorage,
    metadata: {
      keyCount: Object.keys(localStorage).length,
      byteLength: Buffer.byteLength(JSON.stringify(localStorage), "utf8"),
    },
  };
}

async function readJsonBody(request, maxBytes = 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new Error("request body is too large");
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function sendStatic(pathname, response) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = resolve(webRoot, relative);
  if (!target.startsWith(`${webRoot}${sep}`) && target !== webRoot) {
    sendJson(response, 403, { error: "forbidden" });
    return;
  }
  let fileStat;
  try {
    fileStat = await stat(target);
  } catch {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  if (!fileStat.isFile()) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  response.writeHead(200, {
    "Content-Type": contentType(target),
    "Content-Length": String(fileStat.size),
    "Cache-Control": isRuntimeCode(target) ? "no-store" : "max-age=0",
  });
  createReadStream(target).pipe(response);
}

async function sendFile(target, response) {
  let fileStat;
  try {
    fileStat = await stat(target);
  } catch {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  if (!fileStat.isFile()) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  response.writeHead(200, {
    "Content-Type": contentType(target),
    "Content-Length": String(fileStat.size),
    "Cache-Control": "no-store",
  });
  createReadStream(target).pipe(response);
}

function isRuntimeCode(path) {
  return path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".wasm");
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(body)),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function advertisedUrls(listenHost, listenPort) {
  const urls = [];
  const addUrl = (urlHost) => {
    const url = `http://${formatUrlHost(urlHost)}:${listenPort}/`;
    if (!urls.includes(url)) {
      urls.push(url);
    }
  };
  if (isAnyAddress(listenHost)) {
    addUrl("127.0.0.1");
    for (const address of lanIpv4Addresses()) {
      addUrl(address);
    }
  } else {
    addUrl(listenHost);
  }
  return urls;
}

function serverUrlBase() {
  return `http://${formatUrlHost(host)}:${port}`;
}

function isAnyAddress(value) {
  return value === "0.0.0.0" || value === "::" || value === "";
}

function lanIpv4Addresses() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses.sort();
}

function formatUrlHost(value) {
  return value.includes(":") && !value.startsWith("[") ? `[${value}]` : value;
}

async function collectFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(path)));
    } else if (entry.isFile()) {
      out.push(path);
    }
  }
  out.sort();
  return out;
}

async function collectInstallFiles(dir) {
  const files = await collectFiles(dir);
  const archiveByName = new Map(
    files
      .filter((path) => extname(path).toLowerCase() === ".arc")
      .map((path) => [basenameLower(path), path]),
  );
  const ordered = [];
  const used = new Set();
  try {
    const hvl = parseHvl(await readFile(join(dir, "BGI.hvl")));
    for (const name of hvl) {
      if (!name.endsWith(".arc")) {
        continue;
      }
      const path = archiveByName.get(name);
      if (path && !used.has(name)) {
        ordered.push(path);
        used.add(name);
      }
    }
  } catch {
    // HVL is optional for synthetic tests and non-installed fixtures.
  }
  for (const path of files) {
    if (extname(path).toLowerCase() !== ".arc") {
      ordered.push(path);
      continue;
    }
    const name = basenameLower(path);
    if (!used.has(name)) {
      ordered.push(path);
      used.add(name);
    }
  }
  return ordered;
}

function parseHvl(buffer) {
  if (buffer.length < 0x10 || buffer.subarray(0, 8).toString("ascii") !== "BHV_____") {
    throw new Error("invalid HVL manifest");
  }
  const count = buffer.readUInt32LE(0x0c);
  const names = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 0x10 + index * 0x40;
    if (offset + 0x38 > buffer.length) {
      throw new Error("truncated HVL manifest");
    }
    const slot = buffer.subarray(offset, offset + 0x38);
    const end = slot.indexOf(0);
    const name = slot.subarray(0, end < 0 ? slot.length : end).toString("ascii").toLowerCase();
    if (name && !name.includes("/") && !name.includes("\\") && !name.includes(":")) {
      names.push(name);
    }
  }
  return names;
}

function basenameLower(path) {
  const index = path.lastIndexOf(sep);
  return path.slice(index + 1).toLowerCase();
}

async function readRange(path, start, length) {
  const file = await open(path, "r");
  try {
    return await readRangeFromHandle(file, start, length);
  } finally {
    await file.close();
  }
}

async function readRangeFromHandle(file, start, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, start);
  return buffer.subarray(0, bytesRead);
}

function parseBoundedInt(value, name) {
  if (value === null || value === "") {
    throw new Error(`${name} is required`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function parsePositiveInt(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseByteEnv(value, fallback, name) {
  if (value === undefined || value === "") {
    return fallback;
  }
  const trimmed = value.trim().toLowerCase();
  const match = /^(\d+)([kmgt]?i?b?)?$/.exec(trimmed);
  if (!match) {
    throw new Error(`${name} must be a byte count`);
  }
  const amount = Number.parseInt(match[1], 10);
  const unit = match[2] ?? "";
  const multipliers = {
    "": 1,
    b: 1,
    k: 1024,
    kb: 1024,
    kib: 1024,
    m: 1024 ** 2,
    mb: 1024 ** 2,
    mib: 1024 ** 2,
    g: 1024 ** 3,
    gb: 1024 ** 3,
    gib: 1024 ** 3,
    t: 1024 ** 4,
    tb: 1024 ** 4,
    tib: 1024 ** 4,
  };
  const bytes = amount * multipliers[unit];
  if (!Number.isSafeInteger(bytes) || bytes < 1) {
    throw new Error(`${name} must be a positive safe integer byte count`);
  }
  return bytes;
}

function contentType(path) {
  switch (extname(path).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    case ".ttc":
      return "font/collection";
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

function sniffPayloadKind(prefix) {
  if (prefix.subarray(0, 16).toString("binary") === "DSC FORMAT 1.00\0") {
    return PAYLOAD_KIND_DSC;
  }
  if (prefix.subarray(0, 16).toString("binary") === "CompressedBG___\0") {
    return PAYLOAD_KIND_COMPRESSED_BG;
  }
  if (prefix.length >= 8 && prefix.subarray(4, 8).toString("ascii") === "bw  ") {
    return PAYLOAD_KIND_BGI_AUDIO;
  }
  return PAYLOAD_KIND_UNKNOWN;
}

function payloadMeta(kind, prefix) {
  if (kind !== PAYLOAD_KIND_COMPRESSED_BG || prefix.length < 0x30) {
    return null;
  }
  const width = prefix.readUInt16LE(0x10);
  const height = prefix.readUInt16LE(0x12);
  const bitsPerPixel = prefix.readUInt32LE(0x14);
  const version = prefix.readUInt16LE(0x2e);
  return {
    width,
    height,
    pixels: width * height,
    bitsPerPixel,
    version,
  };
}
