const ARC20_HEADER_LEN = 16;
const ARC20_ENTRY_LEN = 128;
const ARC20_NAME_LEN = 96;
const ARC20_MAGIC_TEXT = "BURIKO ARC20";
const HEX_BYTES = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, "0"));
const SERVER_FETCH_RETRY_LIMIT = 3;

export async function readArcIndexPrefix(file) {
  if (file.size < ARC20_HEADER_LEN) {
    return null;
  }
  const header = new Uint8Array(await file.slice(0, ARC20_HEADER_LEN).arrayBuffer());
  const magic = new TextDecoder("ascii").decode(header.slice(0, 12));
  if (magic !== ARC20_MAGIC_TEXT) {
    return null;
  }

  const count = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(
    12,
    true,
  );
  const prefixLength = ARC20_HEADER_LEN + count * ARC20_ENTRY_LEN;
  if (!Number.isSafeInteger(prefixLength) || prefixLength > file.size) {
    return null;
  }
  return new Uint8Array(await file.slice(0, prefixLength).arrayBuffer());
}

export function readArc20EntryPayload(payload, entryName) {
  if (!(payload instanceof Uint8Array) || payload.byteLength < ARC20_HEADER_LEN) {
    return null;
  }
  if (!matchesArc20Magic(payload)) {
    return null;
  }
  const query = normalizeArc20EntryQuery(entryName);
  if (!query) {
    return null;
  }
  const count = readU32LE(payload, 12);
  const prefixLength = ARC20_HEADER_LEN + count * ARC20_ENTRY_LEN;
  if (!Number.isSafeInteger(prefixLength) || prefixLength > payload.byteLength) {
    return null;
  }

  for (let index = 0; index < count; index += 1) {
    const entryOffset = ARC20_HEADER_LEN + index * ARC20_ENTRY_LEN;
    const currentName = arc20EntryNameLower(payload.subarray(entryOffset, entryOffset + ARC20_NAME_LEN));
    if (currentName !== query) {
      continue;
    }
    const offset = readU32LE(payload, entryOffset + ARC20_NAME_LEN);
    const size = readU32LE(payload, entryOffset + ARC20_NAME_LEN + 4);
    const start = prefixLength + offset;
    const end = start + size;
    if (
      !Number.isSafeInteger(start)
      || !Number.isSafeInteger(end)
      || start < prefixLength
      || end < start
      || end > payload.byteLength
    ) {
      return null;
    }
    return payload.slice(start, end);
  }
  return null;
}

export function readFirstArc20EntryPayloadByExtension(payload, extension) {
  if (
    !(payload instanceof Uint8Array)
    || payload.byteLength < ARC20_HEADER_LEN
    || !matchesArc20Magic(payload)
    || typeof extension !== "string"
    || !/^\.[a-z0-9]+$/i.test(extension)
  ) {
    return null;
  }
  const count = readU32LE(payload, 12);
  const prefixLength = ARC20_HEADER_LEN + count * ARC20_ENTRY_LEN;
  if (!Number.isSafeInteger(prefixLength) || prefixLength > payload.byteLength) {
    return null;
  }
  const suffix = extension.toLowerCase();
  for (let index = 0; index < count; index += 1) {
    const entryOffset = ARC20_HEADER_LEN + index * ARC20_ENTRY_LEN;
    const name = arc20EntryNameLower(
      payload.subarray(entryOffset, entryOffset + ARC20_NAME_LEN),
    );
    if (!name.endsWith(suffix)) {
      continue;
    }
    const offset = readU32LE(payload, entryOffset + ARC20_NAME_LEN);
    const size = readU32LE(payload, entryOffset + ARC20_NAME_LEN + 4);
    const start = prefixLength + offset;
    const end = start + size;
    if (
      !Number.isSafeInteger(start)
      || !Number.isSafeInteger(end)
      || start < prefixLength
      || end < start
      || end > payload.byteLength
    ) {
      return null;
    }
    return payload.slice(start, end);
  }
  return null;
}

export function createLocalCatalog() {
  return new LocalAssetCatalog();
}

export function createServerCatalog(
  catalogPayload,
  endpoint = "./api/install/payload",
  sidecarEndpoint = "./api/install/sidecar",
) {
  const catalog = createLocalCatalog();
  catalog.mountServerCatalog(catalogPayload, endpoint, sidecarEndpoint);
  return catalog;
}

export function parseArcManifest(manifest) {
  const view = new DataView(manifest.buffer, manifest.byteOffset, manifest.byteLength);
  const count = view.getUint32(0, true);
  const dataStart = Number(view.getBigUint64(4, true));
  const entries = [];
  let cursor = 12;

  for (let index = 0; index < count; index += 1) {
    const nameLength = view.getUint16(cursor, true);
    const offset = view.getUint32(cursor + 2, true);
    const size = view.getUint32(cursor + 6, true);
    cursor += 10;
    const name = manifest.slice(cursor, cursor + nameLength);
    cursor += nameLength;
    entries.push({ name, offset, size });
  }

  return { dataStart, entries };
}

export function parseHvlManifest(manifest) {
  const view = new DataView(manifest.buffer, manifest.byteOffset, manifest.byteLength);
  const count = view.getUint32(0, true);
  const names = [];
  let cursor = 4;
  for (let index = 0; index < count && cursor + 2 <= manifest.byteLength; index += 1) {
    const length = view.getUint16(cursor, true);
    cursor += 2;
    if (cursor + length > manifest.byteLength) {
      break;
    }
    names.push(manifest.slice(cursor, cursor + length));
    cursor += length;
  }
  return names;
}

export function orderFilesByHvl(files, hvlNames) {
  const byLowerName = new Map();
  const ordered = [];
  const used = new Set();
  for (const file of files) {
    byLowerName.set(file.name.toLowerCase(), file);
  }
  for (const nameBytes of hvlNames ?? []) {
    const name = asciiLower(nameBytes);
    const file = byLowerName.get(name);
    if (file && !used.has(name)) {
      ordered.push(file);
      used.add(name);
    }
  }
  const rest = files
    .filter((file) => !used.has(file.name.toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name));
  ordered.push(...rest);
  return ordered;
}

class LocalAssetCatalog {
  #archives = [];
  #records = [];
  #byName = new Map();
  #archivesByName = new Map();
  #sidecars = [];
  #sidecarsByName = new Map();
  #mountedEntries = 0;
  #duplicateEntries = 0;

  mountArchive(file, manifest, options = {}) {
    const parsed = parseArcManifest(manifest);
    const archiveIndex = this.#archives.length;
    const archiveName = bytes(file.name);
    this.#archives.push({
      file,
      name: archiveName,
      dataStart: parsed.dataStart,
      manifest,
      size: file.size,
      mountData: options.mountData === true,
    });
    this.#archivesByName.set(bytesToHex(archiveName), archiveIndex);
    for (const entry of parsed.entries) {
      const key = bytesToHex(entry.name);
      if (this.#byName.has(key)) {
        this.#duplicateEntries += 1;
      }
      const record = {
        name: entry.name,
        archiveIndex,
        offset: entry.offset,
        size: entry.size,
        kind: null,
        meta: null,
      };
      this.#records.push(record);
      this.#byName.set(key, record);
      this.#mountedEntries += 1;
    }
    return { entryCount: parsed.entries.length };
  }

  mountSidecar(file) {
    const sidecarIndex = this.#sidecars.length;
    const sidecarName = bytes(file.name);
    this.#sidecars.push({
      file,
      name: sidecarName,
      size: file.size,
    });
    this.#sidecarsByName.set(bytesToHex(sidecarName), sidecarIndex);
    return { sidecarIndex };
  }

  mountServerCatalog(payload, endpoint, sidecarEndpoint) {
    if (payload?.version !== 1 || !Array.isArray(payload.archives)) {
      throw new Error("invalid local server catalog");
    }
    let mounted = 0;
    for (const archive of payload.archives) {
      const archiveIndex = this.#archives.length;
      const archiveName = typeof archive.nameHex === "string" ? hexToBytes(archive.nameHex) : null;
      this.#archives.push({
        endpoint,
        serverArchiveIndex: archiveIndex,
        name: archiveName,
        dataStart: archive.dataStart,
        manifest: typeof archive.manifestHex === "string" ? hexToBytes(archive.manifestHex) : null,
        size: archive.size,
      });
      if (archiveName instanceof Uint8Array) {
        this.#archivesByName.set(bytesToHex(archiveName), archiveIndex);
      }
      for (const entry of archive.entries ?? []) {
        const name = hexToBytes(entry.nameHex);
        const key = bytesToHex(name);
        if (this.#byName.has(key)) {
          this.#duplicateEntries += 1;
        }
        const record = {
          name,
          archiveIndex,
          entryIndex: entry.entryIndex,
          offset: entry.offset,
          size: entry.size,
          kind: entry.kind ?? null,
          meta: entry.meta ?? null,
        };
        this.#records.push(record);
        this.#byName.set(key, record);
        this.#mountedEntries += 1;
        mounted += 1;
      }
    }
    for (const sidecar of payload.sidecars ?? []) {
      const sidecarIndex = this.#sidecars.length;
      const sidecarName = typeof sidecar.nameHex === "string" ? hexToBytes(sidecar.nameHex) : null;
      this.#sidecars.push({
        endpoint: sidecarEndpoint,
        serverSidecarIndex: sidecar.sidecarIndex ?? sidecarIndex,
        name: sidecarName,
        size: sidecar.size,
      });
      if (sidecarName instanceof Uint8Array) {
        this.#sidecarsByName.set(bytesToHex(sidecarName), sidecarIndex);
      }
    }
    return { entryCount: mounted };
  }

  records() {
    return this.#records.values();
  }

  recordsByKind(kind) {
    const records = this.#records;
    return records.some((record) => record.kind !== null)
      ? records.filter((record) => record.kind === kind)
      : records;
  }

  findByNameBytes(name) {
    const exact = this.#byName.get(bytesToHex(name));
    if (exact) {
      return exact;
    }
    const query = asciiLower(name);
    for (let index = this.#records.length - 1; index >= 0; index -= 1) {
      const record = this.#records[index];
      if (asciiLower(record.name) === query) {
        return record;
      }
    }
    return null;
  }

  findByArchiveAndNameBytes(archiveName, entryName) {
    const archiveIndex = this.#archivesByName.get(bytesToHex(archiveName));
    if (!Number.isInteger(archiveIndex) || archiveIndex < 0) {
      return null;
    }
    const entryKey = asciiLower(entryName);
    for (let index = this.#records.length - 1; index >= 0; index -= 1) {
      const record = this.#records[index];
      if (record.archiveIndex !== archiveIndex) {
        continue;
      }
      if (asciiLower(record.name) !== entryKey) {
        continue;
      }
      return record;
    }
    return null;
  }

  async readPrefix(record, length) {
    const archive = this.#archives[record.archiveIndex];
    if (archive.endpoint) {
      return readServerRecord(archive, record, 0, Math.min(length, record.size));
    }
    const start = archive.dataStart + record.offset;
    const end = start + Math.min(length, record.size);
    return new Uint8Array(await archive.file.slice(start, end).arrayBuffer());
  }

  async readPayload(record) {
    const archive = this.#archives[record.archiveIndex];
    if (archive.endpoint) {
      return readServerRecord(archive, record, 0, record.size);
    }
    const start = archive.dataStart + record.offset;
    const end = start + record.size;
    return new Uint8Array(await archive.file.slice(start, end).arrayBuffer());
  }

  async readPayloadByNameBytes(name) {
    const record = this.findByNameBytes(name);
    if (record === null) {
      return null;
    }
    return this.readPayload(record);
  }

  async readPayloadByArchiveAndNameBytes(archiveName, entryName) {
    const record = this.findByArchiveAndNameBytes(archiveName, entryName);
    return record === null ? null : this.readPayload(record);
  }

  async readArchivePayloadByNameBytes(name) {
    const archiveIndex = this.#findArchiveIndexByNameBytes(name);
    const archive = this.#archives[archiveIndex ?? -1];
    if (!archive) {
      return null;
    }
    if (archive.endpoint) {
      const response = await fetch(
        `${archive.endpoint}?archive=${archive.serverArchiveIndex}&offset=0&length=${archive.size}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        return null;
      }
      return new Uint8Array(await response.arrayBuffer());
    }
    if (!(archive.file instanceof Blob)) {
      return null;
    }
    return new Uint8Array(await archive.file.arrayBuffer());
  }

  archiveDataStartByNameBytes(name) {
    const archiveIndex = this.#findArchiveIndexByNameBytes(name);
    const archive = this.#archives[archiveIndex ?? -1];
    return Number.isSafeInteger(archive?.dataStart) ? archive.dataStart : 0;
  }

  archiveManifests() {
    return this.#archives
      .filter((archive) => archive.manifest !== null && Number.isSafeInteger(archive.size))
      .map((archive) => ({ manifest: archive.manifest, size: archive.size }));
  }

  archives() {
    return this.#archives.values();
  }

  archivesWithData() {
    return this.#archives
      .map((archive, archiveIndex) => ({ ...archive, archiveIndex }))
      .filter((archive) => archive.mountData === true && archive.file instanceof Blob);
  }

  sidecars() {
    return this.#sidecars.values();
  }

  async readSidecarByNameBytes(name) {
    const sidecarIndex = this.#findSidecarIndexByNameBytes(name);
    const sidecar = this.#sidecars[sidecarIndex ?? -1];
    if (!sidecar) {
      return null;
    }
    if (sidecar.endpoint) {
      const url = new URL(sidecar.endpoint, globalThis.window?.location?.href ?? "http://127.0.0.1/");
      url.searchParams.set("sidecar", String(sidecar.serverSidecarIndex));
      url.searchParams.set("offset", "0");
      url.searchParams.set("length", String(sidecar.size));
      const { response } = await fetchServerPayload(url);
      if (response === null || !response.ok) {
        return null;
      }
      return new Uint8Array(await response.arrayBuffer());
    }
    if (!(sidecar.file instanceof Blob)) {
      return null;
    }
    return new Uint8Array(await sidecar.file.arrayBuffer());
  }

  summary() {
    return {
      arcMountedEntries: this.#mountedEntries,
      arcCanonicalEntries: this.#byName.size,
      arcDuplicateEntries: this.#duplicateEntries,
      sidecarCount: this.#sidecars.length,
    };
  }

  #findArchiveIndexByNameBytes(name) {
    const exact = this.#archivesByName.get(bytesToHex(name));
    if (Number.isInteger(exact) && exact >= 0) {
      return exact;
    }
    const query = asciiLower(name);
    if (!query.includes("x")) {
      return null;
    }
    for (let index = 0; index < this.#archives.length; index += 1) {
      const archiveName = this.#archives[index]?.name;
      if (!(archiveName instanceof Uint8Array)) {
        continue;
      }
      if (archiveQueryMatches(query, asciiLower(archiveName))) {
        return index;
      }
    }
    return null;
  }

  #findSidecarIndexByNameBytes(name) {
    const exact = this.#sidecarsByName.get(bytesToHex(name));
    if (Number.isInteger(exact) && exact >= 0) {
      return exact;
    }
    const query = asciiLower(name);
    for (let index = this.#sidecars.length - 1; index >= 0; index -= 1) {
      const sidecarName = this.#sidecars[index]?.name;
      if (sidecarName instanceof Uint8Array && asciiLower(sidecarName) === query) {
        return index;
      }
    }
    return null;
  }
}

function bytesToHex(bytes) {
  let out = "";
  for (const byte of bytes) {
    out += HEX_BYTES[byte];
  }
  return out;
}

function matchesArc20Magic(payload) {
  if (payload.byteLength < ARC20_MAGIC_TEXT.length) {
    return false;
  }
  for (let index = 0; index < ARC20_MAGIC_TEXT.length; index += 1) {
    if (payload[index] !== ARC20_MAGIC_TEXT.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

function normalizeArc20EntryQuery(entryName) {
  if (typeof entryName === "string") {
    return entryName.trim().toLowerCase();
  }
  if (entryName instanceof Uint8Array) {
    return asciiLower(entryName).replace(/\0+$/g, "").trim();
  }
  return "";
}

function arc20EntryNameLower(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) {
    end -= 1;
  }
  return asciiLower(bytes.subarray(0, end)).trim();
}

function readU32LE(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) {
    return 0;
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0) {
    throw new Error("invalid hex asset name");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytes(value) {
  return new TextEncoder().encode(value);
}

function asciiLower(bytes) {
  let out = "";
  for (const byte of bytes) {
    out += String.fromCharCode(byte).toLowerCase();
  }
  return out;
}

function archiveQueryMatches(query, candidate) {
  return query.length === candidate.length
    && Array.from(query).every((char, index) => (
      char === "x" ? isAsciiDigit(candidate.charCodeAt(index)) : char === candidate[index]
    ));
}

function isAsciiDigit(code) {
  return code >= 0x30 && code <= 0x39;
}

async function readServerRecord(archive, record, offset, length) {
  const url = new URL(archive.endpoint, globalThis.window?.location?.href ?? "http://127.0.0.1/");
  url.searchParams.set("archive", String(archive.serverArchiveIndex));
  url.searchParams.set("entry", String(record.entryIndex));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("length", String(length));
  const { response, error } = await fetchServerPayload(url);
  if (response === null) {
    return readServerRecordViaArchiveFallback(archive, record, offset, length, error);
  }
  if (!response.ok) {
    return readServerRecordViaArchiveFallback(
      archive,
      record,
      offset,
      length,
      new Error(`http ${response.status}`),
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function readServerRecordViaArchiveFallback(archive, record, offset, length, cause) {
  const payload = await readServerArchivePayload(archive, cause);
  const start = archive.dataStart + record.offset + offset;
  const end = start + length;
  if (
    !(payload instanceof Uint8Array)
    || start < 0
    || end < start
    || end > payload.byteLength
  ) {
    throw new Error(
      `local asset fetch fallback failed: archive=${archive.serverArchiveIndex} entry=${record.entryIndex ?? -1} size=${record.size ?? -1} name=${bytesToHex(record.name ?? new Uint8Array())} cause=${String(cause?.message ?? cause)}`,
    );
  }
  return payload.slice(start, end);
}

async function readServerArchivePayload(archive, cause = null) {
  if (archive.cachedPayload instanceof Uint8Array) {
    return archive.cachedPayload;
  }
  if (archive.cachedPayloadPromise instanceof Promise) {
    return archive.cachedPayloadPromise;
  }
  archive.cachedPayloadPromise = (async () => {
    const url = new URL(archive.endpoint, globalThis.window?.location?.href ?? "http://127.0.0.1/");
    url.searchParams.set("archive", String(archive.serverArchiveIndex));
    url.searchParams.set("offset", "0");
    url.searchParams.set("length", String(archive.size));
    const { response, error } = await fetchServerPayload(url);
    if (response === null) {
      throw new Error(
        `local archive fallback fetch failed before response: archive=${archive.serverArchiveIndex} size=${archive.size} url=${String(url)} cause=${String(error?.message ?? error ?? "")} prior=${String(cause?.message ?? cause ?? "")}`,
      );
    }
    if (!response.ok) {
      throw new Error(
        `local archive fallback fetch failed: archive=${archive.serverArchiveIndex} size=${archive.size} status=${response.status} url=${String(url)} prior=${String(cause?.message ?? cause ?? "")}`,
      );
    }
    const payload = new Uint8Array(await response.arrayBuffer());
    archive.cachedPayload = payload;
    return payload;
  })();
  try {
    return await archive.cachedPayloadPromise;
  } finally {
    if (!(archive.cachedPayload instanceof Uint8Array)) {
      archive.cachedPayloadPromise = null;
    }
  }
}

async function fetchServerPayload(url) {
  let lastError = null;
  for (let attempt = 0; attempt < SERVER_FETCH_RETRY_LIMIT; attempt += 1) {
    try {
      return { response: await fetch(url, { cache: "no-store" }), error: null };
    } catch (error) {
      lastError = error;
      await yieldServerFetchRetry();
    }
  }
  if (lastError !== null) {
    globalThis.console?.warn?.(
      "sakura_local_catalog_fetch_retry_exhausted",
      String(url),
      String(lastError?.message ?? lastError),
    );
  }
  return { response: null, error: lastError };
}

async function yieldServerFetchRetry() {
  await new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}
