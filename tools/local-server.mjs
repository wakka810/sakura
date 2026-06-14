import { createReadStream } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webRoot = join(root, "web");
const defaultInstallDir = join(root, "サクラノ詩");
const installDir = resolve(process.env.SAKURA_INSTALL_DIR ?? defaultInstallDir);
const host = process.env.SAKURA_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.SAKURA_PORT ?? "8787", 10);
const maxPayloadBytes = Number.parseInt(process.env.SAKURA_MAX_PAYLOAD_BYTES ?? "268435456", 10);
const PAYLOAD_KIND_UNKNOWN = 0;
const PAYLOAD_KIND_DSC = 1;
const PAYLOAD_KIND_COMPRESSED_BG = 2;
const PAYLOAD_KIND_BGI_AUDIO = 3;

const state = {
  install: null,
  installPromise: null,
};

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("SAKURA_PORT must be in 1..=65535");
}
if (!Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 1) {
  throw new Error("SAKURA_MAX_PAYLOAD_BYTES must be positive");
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
  console.log(`url=http://${host}:${port}/`);
  console.log(`install_dir=${installDir}`);
});

async function route(request, response) {
  if (!request.url || request.method !== "GET") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }
  const url = new URL(request.url, `http://${host}:${port}`);
  if (url.pathname === "/api/install/catalog") {
    sendJson(response, 200, await installCatalog());
    return;
  }
  if (url.pathname === "/api/install/payload") {
    await sendPayload(url, response);
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
  const archives = [];
  let exeCount = 0;
  let totalEntries = 0;

  for (const path of files) {
    if (path.endsWith(`${sep}BGI.exe`)) {
      exeCount += 1;
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
    entryCount: totalEntries,
    archives: archives.map((archive) => ({
      nameHex: Buffer.from(archive.name, "utf8").toString("hex"),
      size: archive.size,
      dataStart: archive.dataStart,
      manifestHex: archive.manifestHex,
      entries: archive.entries,
    })),
  };
  return { publicCatalog, archives };
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
