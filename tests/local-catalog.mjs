import {
  createLocalCatalog,
  createServerCatalog,
  parseArcManifest,
  readArcIndexPrefix,
  readFirstArc20EntryPayloadByExtension,
} from "../web/local-catalog.js";

const firstArchive = buildArc20([
  ["same", bytes("first")],
  ["prefix", bytes("abcdef")],
]);
const secondArchive = buildArc20([["same", bytes("second")]]);
const firstManifest = buildManifest(firstArchive.entries, firstArchive.prefixLength);
const secondManifest = buildManifest(secondArchive.entries, secondArchive.prefixLength);
const firstFile = new File([firstArchive.data], "first.arc");
const secondFile = new File([secondArchive.data], "second.arc");

const prefix = await readArcIndexPrefix(firstFile);
if (prefix === null || prefix.byteLength !== firstArchive.prefixLength) {
  throw new Error("ARC20 prefix read failed");
}

const movieArchive = buildArc20([
  ["readme.txt", bytes("not-video")],
  ["clip.MPG", bytes("mpeg-payload")],
]);
const moviePayload = readFirstArc20EntryPayloadByExtension(movieArchive.data, ".mpg");
if (moviePayload === null || text(moviePayload) !== "mpeg-payload") {
  throw new Error("ARC20 extension payload lookup failed");
}
if (readFirstArc20EntryPayloadByExtension(movieArchive.data, "../mpg") !== null) {
  throw new Error("ARC20 extension payload lookup accepted an unsafe suffix");
}

const parsed = parseArcManifest(firstManifest);
if (parsed.dataStart !== firstArchive.prefixLength || parsed.entries.length !== 2) {
  throw new Error("manifest parse failed");
}

const catalog = createLocalCatalog();
catalog.mountArchive(firstFile, firstManifest);
catalog.mountArchive(secondFile, secondManifest, { mountData: true });
catalog.mountSidecar(new File([bytes("BURIKO GDB 3.00\0local")], "BGI.gdb"));

const summary = catalog.summary();
if (
  summary.arcMountedEntries !== 3 ||
  summary.arcCanonicalEntries !== 2 ||
  summary.arcDuplicateEntries !== 1 ||
  summary.sidecarCount !== 1
) {
  throw new Error(`unexpected catalog summary ${JSON.stringify(summary)}`);
}

if (Array.from(catalog.records()).length !== 3) {
  throw new Error("catalog records should preserve duplicate mounted entries for full scans");
}

const archives = Array.from(catalog.archives());
if (archives.length !== 2 || archives[1].mountData !== true || archives[0].mountData !== false) {
  throw new Error("archive mountData flags were not preserved");
}

const mountedDataArchives = catalog.archivesWithData();
if (mountedDataArchives.length !== 1 || mountedDataArchives[0].size !== secondFile.size) {
  throw new Error("archivesWithData did not expose the expected archive");
}

const archivePayload = await catalog.readArchivePayloadByNameBytes(bytes("second.arc"));
if (archivePayload === null || archivePayload.byteLength !== secondArchive.data.byteLength) {
  throw new Error("archive basename payload lookup failed");
}

const localSidecarPayload = await catalog.readSidecarByNameBytes(bytes("bgi.gdb"));
if (localSidecarPayload === null || text(localSidecarPayload.slice(0, 15)) !== "BURIKO GDB 3.00") {
  throw new Error("local sidecar lookup failed");
}

const wildcardArchive = buildArc20([["bg", bytes("wild")]]); 
const wildcardManifest = buildManifest(wildcardArchive.entries, 0x40);
const wildcardFile = new File([wildcardArchive.data], "data01099.arc");
catalog.mountArchive(wildcardFile, wildcardManifest, { mountData: true });
const laterWildcardArchive = buildArc20([
  ["bg", bytes("later-wild")],
  ["extra", bytes("payload")],
]);
const laterWildcardManifest = buildManifest(laterWildcardArchive.entries, 0x60);
const laterWildcardFile = new File([laterWildcardArchive.data], "data01109.arc");
catalog.mountArchive(laterWildcardFile, laterWildcardManifest, { mountData: true });

const wildcardPayload = await catalog.readArchivePayloadByNameBytes(bytes("data01xxx.arc"));
if (wildcardPayload === null || wildcardPayload.byteLength !== wildcardArchive.data.byteLength) {
  throw new Error("wildcard archive payload lookup failed");
}

if (catalog.archiveDataStartByNameBytes(bytes("data01xxx.arc")) !== 0x40) {
  throw new Error("wildcard archive data start lookup failed");
}

const canonical = await catalog.readPayloadByNameBytes(bytes("same"));
if (canonical === null || text(canonical) !== "second") {
  throw new Error("later mounted canonical asset was not selected");
}

const archiveScopedCanonical = await catalog.readPayloadByArchiveAndNameBytes(
  bytes("first.arc"),
  bytes("same"),
);
if (archiveScopedCanonical === null || text(archiveScopedCanonical) !== "first") {
  throw new Error("archive-scoped asset lookup failed");
}

const archiveScopedRecord = catalog.findByArchiveAndNameBytes(
  bytes("second.arc"),
  bytes("same"),
);
if (
  archiveScopedRecord === null
  || archiveScopedRecord.archiveIndex !== 1
  || archiveScopedRecord.size !== bytes("second").byteLength
) {
  throw new Error(`archive-scoped record lookup failed ${JSON.stringify(archiveScopedRecord)}`);
}

const archiveScopedMissing = await catalog.readPayloadByArchiveAndNameBytes(
  bytes("missing.arc"),
  bytes("same"),
);
if (archiveScopedMissing !== null) {
  throw new Error("missing archive-scoped asset should return null");
}

const prefixRecord = catalog.findByNameBytes(bytes("prefix"));
if (prefixRecord === null) {
  throw new Error("synthetic prefix record missing");
}
const payloadPrefix = await catalog.readPrefix(prefixRecord, 3);
if (text(payloadPrefix) !== "abc") {
  throw new Error("payload prefix slicing failed");
}

if ((await catalog.readPayloadByNameBytes(bytes("missing"))) !== null) {
  throw new Error("missing logical asset should return null");
}

const originalFetch = globalThis.fetch;
const serverPayload = buildArc20([
  ["script1", bytes("payload-one")],
  ["script2", bytes("payload-two")],
]);
const serverCatalog = createServerCatalog({
  version: 1,
  sidecars: [
    {
      sidecarIndex: 0,
      nameHex: bytesToHex(bytes("BGI.gdb")),
      size: bytes("server-gdb").byteLength,
    },
  ],
  archives: [
    {
      nameHex: "7365727665722e617263",
      size: serverPayload.data.byteLength,
      dataStart: serverPayload.prefixLength,
      manifestHex: bytesToHex(buildManifest(serverPayload.entries, serverPayload.prefixLength)),
      entries: serverPayload.entries.map((entry, entryIndex) => ({
        archiveIndex: 0,
        entryIndex,
        nameHex: bytesToHex(entry.name),
        offset: entry.offset,
        size: entry.size,
        kind: 1,
        meta: null,
      })),
    },
  ],
}, "/api/install/payload");
let directEntryFetches = 0;
let archiveFallbackFetches = 0;
let sidecarFetches = 0;
globalThis.window = { location: { href: "http://127.0.0.1:9013/" } };
globalThis.fetch = async (input) => {
  const url = new URL(String(input), "http://127.0.0.1:9013/");
  if (url.pathname === "/api/install/sidecar") {
    sidecarFetches += 1;
    return new Response(bytes("server-gdb"), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    });
  }
  const entry = url.searchParams.get("entry");
  if (entry !== null) {
    directEntryFetches += 1;
    throw new TypeError("Failed to fetch");
  }
  archiveFallbackFetches += 1;
  return new Response(serverPayload.data.slice(), {
    status: 200,
    headers: { "Content-Type": "application/octet-stream" },
  });
};
const fallbackPayload = await serverCatalog.readPayloadByNameBytes(bytes("script2"));
const serverSidecarPayload = await serverCatalog.readSidecarByNameBytes(bytes("BGI.gdb"));
globalThis.fetch = originalFetch;
delete globalThis.window;
if (
  text(fallbackPayload) !== "payload-two"
  || directEntryFetches !== 3
  || archiveFallbackFetches !== 1
  || text(serverSidecarPayload) !== "server-gdb"
  || sidecarFetches !== 1
) {
  throw new Error(`server catalog archive fallback failed ${JSON.stringify({
    directEntryFetches,
    archiveFallbackFetches,
    sidecarFetches,
    payload: fallbackPayload ? text(fallbackPayload) : null,
    sidecarPayload: serverSidecarPayload ? text(serverSidecarPayload) : null,
  })}`);
}

const retryCatalog = createServerCatalog({
  version: 1,
  archives: [
    {
      nameHex: "7365727665722e617263",
      size: serverPayload.data.byteLength,
      dataStart: serverPayload.prefixLength,
      manifestHex: bytesToHex(buildManifest(serverPayload.entries, serverPayload.prefixLength)),
      entries: serverPayload.entries.map((entry, entryIndex) => ({
        archiveIndex: 0,
        entryIndex,
        nameHex: bytesToHex(entry.name),
        offset: entry.offset,
        size: entry.size,
        kind: 1,
        meta: null,
      })),
    },
  ],
}, "/api/install/payload");
let retryAttempts = 0;
globalThis.window = { location: { href: "http://127.0.0.1:9013/" } };
globalThis.fetch = async (input) => {
  const url = new URL(String(input), "http://127.0.0.1:9013/");
  if (url.searchParams.get("entry") !== null) {
    retryAttempts += 1;
    if (retryAttempts < 3) {
      throw new TypeError("Failed to fetch");
    }
    return new Response(bytes("payload-one"), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    });
  }
  throw new Error("archive fallback should not run when entry retry succeeds");
};
const retriedPayload = await retryCatalog.readPayloadByNameBytes(bytes("script1"));
globalThis.fetch = originalFetch;
delete globalThis.window;
if (text(retriedPayload) !== "payload-one" || retryAttempts !== 3) {
  throw new Error(`server catalog retry failed ${JSON.stringify({
    retryAttempts,
    payload: retriedPayload ? text(retriedPayload) : null,
  })}`);
}

console.log("local_catalog_smoke=ok");

function buildArc20(files) {
  const headerLength = 16;
  const entryLength = 128;
  const nameLength = 96;
  const prefixLength = headerLength + files.length * entryLength;
  const payloadLength = files.reduce((total, [, payload]) => total + payload.byteLength, 0);
  const data = new Uint8Array(prefixLength + payloadLength);
  const view = new DataView(data.buffer);
  data.set(bytes("BURIKO ARC20"), 0);
  view.setUint32(12, files.length, true);

  const entries = [];
  let payloadOffset = 0;
  for (const [index, [name, payload]] of files.entries()) {
    const entryOffset = headerLength + index * entryLength;
    data.set(bytes(name), entryOffset);
    view.setUint32(entryOffset + nameLength, payloadOffset, true);
    view.setUint32(entryOffset + nameLength + 4, payload.byteLength, true);
    data.set(payload, prefixLength + payloadOffset);
    entries.push({ name: bytes(name), offset: payloadOffset, size: payload.byteLength });
    payloadOffset += payload.byteLength;
  }

  return { data, entries, prefixLength };
}

function buildManifest(entries, dataStart) {
  const length = 12 + entries.reduce((total, entry) => total + 10 + entry.name.byteLength, 0);
  const manifest = new Uint8Array(length);
  const view = new DataView(manifest.buffer);
  view.setUint32(0, entries.length, true);
  view.setBigUint64(4, BigInt(dataStart), true);
  let cursor = 12;
  for (const entry of entries) {
    view.setUint16(cursor, entry.name.byteLength, true);
    view.setUint32(cursor + 2, entry.offset, true);
    view.setUint32(cursor + 6, entry.size, true);
    cursor += 10;
    manifest.set(entry.name, cursor);
    cursor += entry.name.byteLength;
  }
  return manifest;
}

function bytes(value) {
  return new TextEncoder().encode(value);
}

function text(value) {
  return new TextDecoder("ascii").decode(value);
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
