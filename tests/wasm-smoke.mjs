import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const wasmPath = resolve("web/pkg/sakura_core.wasm");
const bytes = await readFile(wasmPath);
const { instance } = await WebAssembly.instantiate(bytes, {});
const version = instance.exports.sakura_engine_abi_version();

if (version !== 1) {
  throw new Error(`unexpected ABI version ${version}`);
}

for (const [name, actual, expected] of [
  ["boot", instance.exports.sakura_runtime_boot_packet_len(), 176],
  ["system probe", instance.exports.sakura_runtime_system_probe_packet_len(), 180],
  ["service trace", instance.exports.sakura_runtime_service_trace_packet_len(), 1804],
  ["sound queue", instance.exports.sakura_runtime_sound_queue_packet_len(), 265504],
  ["graph queue", instance.exports.sakura_runtime_graph_queue_packet_len(), 1147936],
]) {
  if (actual !== expected) {
    throw new Error(`unexpected runtime ${name} packet length`);
  }
}

const fixture = buildArc20Prefix([["one", 5], ["two", 9]]);
const ptr = instance.exports.sakura_alloc(fixture.prefix.length);
try {
  new Uint8Array(instance.exports.memory.buffer, ptr, fixture.prefix.length).set(fixture.prefix);
  const entries = instance.exports.sakura_arc20_index_entry_count(
    ptr,
    fixture.prefix.length,
    fixture.archiveLength,
  );
  if (entries !== 2) {
    throw new Error(`unexpected ARC entry count ${entries}`);
  }

  const manifestLen = instance.exports.sakura_arc20_index_manifest_len(
    ptr,
    fixture.prefix.length,
    fixture.archiveLength,
  );
  if (manifestLen !== 38) {
    throw new Error(`unexpected ARC manifest length ${manifestLen}`);
  }

  const manifestPtr = instance.exports.sakura_alloc(manifestLen);
  try {
    const written = instance.exports.sakura_arc20_index_manifest_write(
      ptr,
      fixture.prefix.length,
      fixture.archiveLength,
      manifestPtr,
      manifestLen,
    );
    if (written !== manifestLen) {
      throw new Error(`unexpected ARC manifest write length ${written}`);
    }
    const manifest = new Uint8Array(
      instance.exports.memory.buffer,
      manifestPtr,
      manifestLen,
    ).slice();
    const parsed = parseArcManifest(manifest);
    if (parsed.dataStart !== fixture.prefix.length || parsed.entries.length !== 2) {
      throw new Error("ARC manifest header mismatch");
    }
    if (parsed.entries[1].name !== "two" || parsed.entries[1].offset !== 5) {
      throw new Error("ARC manifest entry mismatch");
    }
  } finally {
    instance.exports.sakura_dealloc(manifestPtr, manifestLen);
  }
} finally {
  instance.exports.sakura_dealloc(ptr, fixture.prefix.length);
}

const cbg = buildSyntheticV1Cbg();
const cbgPtr = instance.exports.sakura_alloc(cbg.length);
try {
  new Uint8Array(instance.exports.memory.buffer, cbgPtr, cbg.length).set(cbg);
  const rgbaLen = instance.exports.sakura_cbg_rgba_len(cbgPtr, cbg.length);
  if (rgbaLen !== 20) {
    throw new Error(`unexpected CBG RGBA length ${rgbaLen}`);
  }
  const rgbaPtr = instance.exports.sakura_alloc(rgbaLen);
  try {
    const written = instance.exports.sakura_cbg_rgba_write(cbgPtr, cbg.length, rgbaPtr, rgbaLen);
    if (written !== rgbaLen) {
      throw new Error(`unexpected CBG RGBA write length ${written}`);
    }
    const packet = new Uint8Array(instance.exports.memory.buffer, rgbaPtr, rgbaLen).slice();
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    if (view.getUint32(0, true) !== 1 || view.getUint32(4, true) !== 1) {
      throw new Error("CBG RGBA dimensions mismatch");
    }
    if (view.getUint32(8, true) !== 4 || view.getUint32(12, true) !== 4) {
      throw new Error("CBG RGBA stride/length mismatch");
    }
    const pixel = Array.from(packet.slice(16));
    if (pixel.join(",") !== "7,7,7,255") {
      throw new Error(`CBG RGBA pixel mismatch: ${pixel.join(",")}`);
    }
  } finally {
    instance.exports.sakura_dealloc(rgbaPtr, rgbaLen);
  }
} finally {
  instance.exports.sakura_dealloc(cbgPtr, cbg.length);
}

const dscWrappedCbg = buildSyntheticDsc(buildSyntheticV1Cbg());
const dscWrappedCbgPtr = instance.exports.sakura_alloc(dscWrappedCbg.length);
try {
  new Uint8Array(instance.exports.memory.buffer, dscWrappedCbgPtr, dscWrappedCbg.length)
    .set(dscWrappedCbg);
  const rgbaLen = instance.exports.sakura_image_rgba_len(dscWrappedCbgPtr, dscWrappedCbg.length);
  if (rgbaLen !== 20) {
    throw new Error(`unexpected image RGBA length ${rgbaLen}`);
  }
  const rgbaPtr = instance.exports.sakura_alloc(rgbaLen);
  try {
    const written = instance.exports.sakura_image_rgba_write(
      dscWrappedCbgPtr,
      dscWrappedCbg.length,
      rgbaPtr,
      rgbaLen,
    );
    if (written !== rgbaLen) {
      throw new Error(`unexpected image RGBA write length ${written}`);
    }
    const packet = new Uint8Array(instance.exports.memory.buffer, rgbaPtr, rgbaLen).slice();
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    if (view.getUint32(0, true) !== 1 || view.getUint32(4, true) !== 1) {
      throw new Error("image RGBA dimensions mismatch");
    }
    const pixel = Array.from(packet.slice(16));
    if (pixel.join(",") !== "7,7,7,255") {
      throw new Error(`image RGBA pixel mismatch: ${pixel.join(",")}`);
    }
  } finally {
    instance.exports.sakura_dealloc(rgbaPtr, rgbaLen);
  }
} finally {
  instance.exports.sakura_dealloc(dscWrappedCbgPtr, dscWrappedCbg.length);
}

const audio = buildSyntheticBgiAudio();
const audioPtr = instance.exports.sakura_alloc(audio.length);
try {
  new Uint8Array(instance.exports.memory.buffer, audioPtr, audio.length).set(audio);
  const oggLen = instance.exports.sakura_bgi_audio_ogg_len(audioPtr, audio.length);
  if (oggLen !== 11) {
    throw new Error(`unexpected BGI audio Ogg length ${oggLen}`);
  }
  const oggPtr = instance.exports.sakura_alloc(oggLen);
  try {
    const written = instance.exports.sakura_bgi_audio_ogg_write(
      audioPtr,
      audio.length,
      oggPtr,
      oggLen,
    );
    if (written !== oggLen) {
      throw new Error(`unexpected BGI audio write length ${written}`);
    }
    const ogg = new Uint8Array(instance.exports.memory.buffer, oggPtr, oggLen).slice();
    if (new TextDecoder("ascii").decode(ogg.slice(0, 4)) !== "OggS") {
      throw new Error("BGI audio Ogg signature mismatch");
    }
  } finally {
    instance.exports.sakura_dealloc(oggPtr, oggLen);
  }
} finally {
  instance.exports.sakura_dealloc(audioPtr, audio.length);
}

const gdb = buildSyntheticGdb(["white", "makuralogo", "att01", "att02", "ev4001a"]);
const gdbPtr = instance.exports.sakura_alloc(gdb.length);
try {
  new Uint8Array(instance.exports.memory.buffer, gdbPtr, gdb.length).set(gdb);
  const viewedLen = instance.exports.sakura_gdb_viewed_image_names_len(gdbPtr, gdb.length);
  const expected = "white\0makuralogo\0att01\0att02\0ev4001a\0";
  if (viewedLen !== expected.length) {
    throw new Error(`unexpected GDB viewed image length ${viewedLen}`);
  }
  const viewedPtr = instance.exports.sakura_alloc(viewedLen);
  try {
    const written = instance.exports.sakura_gdb_viewed_image_names_write(
      gdbPtr,
      gdb.length,
      viewedPtr,
      viewedLen,
    );
    if (written !== viewedLen) {
      throw new Error(`unexpected GDB viewed image write length ${written}`);
    }
    const packet = new Uint8Array(
      instance.exports.memory.buffer,
      viewedPtr,
      viewedLen,
    ).slice();
    if (new TextDecoder("ascii").decode(packet) !== expected) {
      throw new Error("GDB viewed image packet mismatch");
    }
  } finally {
    instance.exports.sakura_dealloc(viewedPtr, viewedLen);
  }
} finally {
  instance.exports.sakura_dealloc(gdbPtr, gdb.length);
}

for (const [label, payload, assertSummary] of [
  [
    "scenario",
    buildSyntheticDsc(buildSyntheticScenarioScript()),
    (summary) => {
      if (summary.kind !== 1 || summary.instructions !== 4) {
        throw new Error(`unexpected scenario summary kind/instructions for ${label}`);
      }
      if (
        summary.scenarioMessages !== 1 ||
        summary.scenarioCharacterNames !== 1 ||
        summary.scenarioEventMessages !== 1
      ) {
        throw new Error(`unexpected scenario message counters for ${label}`);
      }
    },
  ],
  [
    "system",
    buildSyntheticDsc(buildSyntheticSystemScript()),
    (summary) => {
      if (summary.kind !== 2 || summary.instructions !== 6) {
        throw new Error(`unexpected system summary kind/instructions for ${label}`);
      }
      if (summary.systemGraphcalls !== 1 || summary.systemSoundcalls !== 0) {
        throw new Error(`unexpected system call counters for ${label}`);
      }
      if (
        summary.systemUserScriptCalls !== 3 ||
        summary.systemUserScriptLoads !== 1 ||
        summary.systemUserScriptReturns !== 1 ||
        summary.systemUserScriptDispatches !== 1
      ) {
        throw new Error(`unexpected system user-script counters for ${label}`);
      }
      if (summary.systemUserScriptDispatchCounts[0x2a] !== 1) {
        throw new Error(`unexpected system user-script dispatch histogram for ${label}`);
      }
    },
  ],
]) {
  const summaryLen = instance.exports.sakura_dsc_script_summary_packet_len();
  if (summaryLen !== 1112) {
    throw new Error(`unexpected script summary packet length ${summaryLen}`);
  }
  const packet = writePayloadPacket(
    payload,
    summaryLen,
    instance.exports.sakura_dsc_script_summary_write,
    `${label} script summary`,
  );
  assertSummary(parseScriptSummaryPacket(packet));
}

const scenarioEventPayload = buildSyntheticDsc(buildSyntheticScenarioScript());
const scenarioEventLen = instance.exports.sakura_dsc_scenario_first_event_packet_len();
if (scenarioEventLen !== 32) {
  throw new Error(`unexpected scenario VM event packet length ${scenarioEventLen}`);
}
const event = parseScenarioFirstEventPacket(writePayloadPacket(
  scenarioEventPayload,
  scenarioEventLen,
  instance.exports.sakura_dsc_scenario_first_event_write,
  "scenario VM event",
));
if (event.eventKind !== 1 || event.opcode !== 0x0140 || event.nameLength !== 4 || event.textLength !== 7) {
  throw new Error("unexpected scenario VM first-event counters");
}
const scenarioSessionLen = instance.exports.sakura_dsc_scenario_session_probe_packet_len();
if (scenarioSessionLen !== 40) {
  throw new Error(`unexpected scenario session probe packet length ${scenarioSessionLen}`);
}
const session = parseScenarioSessionProbePacket(writePayloadPacket(
  scenarioEventPayload,
  scenarioSessionLen,
  instance.exports.sakura_dsc_scenario_session_probe_write,
  "scenario session probe",
));
if (
  session.eventKind !== 1 ||
  session.mode !== 2 ||
  session.eventCount !== 1 ||
  session.backlogEntries !== 1 ||
  session.snapshotMode !== session.restoredMode ||
  session.snapshotEventCount !== session.restoredEventCount
) {
  throw new Error("unexpected scenario session probe counters");
}

const tracePayload = buildSyntheticDsc(buildSyntheticSystemTraceScript());
const traceLen = instance.exports.sakura_dsc_system_trace_packet_len();
if (traceLen !== 312) {
  throw new Error(`unexpected system trace packet length ${traceLen}`);
}
const trace = parseSystemTracePacket(writePayloadPacket(
  tracePayload,
  traceLen,
  instance.exports.sakura_dsc_system_trace_write,
  "system trace",
));
if (
  trace.instructionCount !== 4 ||
  trace.serviceCallCount !== 1 ||
  trace.userScriptDispatchCount !== 1 ||
  trace.dispatchArgBuckets[1] !== 1 ||
  trace.dispatch00TopKind[7] !== 1 ||
  trace.extFfTopKind[1] !== 1 ||
  trace.extFfArgBuckets[1] !== 1
) {
  throw new Error("unexpected system trace counters");
}

const vmEventLen = instance.exports.sakura_dsc_system_vm_first_event_packet_len();
if (vmEventLen !== 56) {
  throw new Error(`unexpected system VM first-event packet length ${vmEventLen}`);
}
const vmEvent = parseSystemVmFirstEventPacket(writePayloadPacket(
  tracePayload,
  vmEventLen,
  instance.exports.sakura_dsc_system_vm_first_event_write,
  "system VM first-event",
));
if (
  vmEvent.eventKind !== 1 ||
  vmEvent.family !== 3 ||
  vmEvent.serviceId !== 0xff ||
  vmEvent.argCount !== 1 ||
  vmEvent.topKind !== 1 ||
  vmEvent.argKinds[1] !== 1
) {
  throw new Error("unexpected system VM first-event counters");
}

const vmHostLen = instance.exports.sakura_dsc_system_vm_default_host_packet_len();
if (vmHostLen !== 44) {
  throw new Error(`unexpected system VM default-host packet length ${vmHostLen}`);
}
const hostRun = parseSystemVmDefaultHostPacket(writePayloadPacket(
  tracePayload,
  vmHostLen,
  instance.exports.sakura_dsc_system_vm_default_host_write,
  "system VM default-host",
));
if (
  hostRun.eventCount !== 3 ||
  hostRun.serviceEventCount !== 1 ||
  hostRun.userCallEventCount !== 1 ||
  hostRun.userReturnEventCount !== 0 ||
  hostRun.haltedEventCount !== 1 ||
  hostRun.completed !== 1 ||
  hostRun.eventLimited !== 0 ||
  hostRun.lastEventKind !== 6
) {
  throw new Error("unexpected system VM default-host counters");
}

const destPixels = new Uint8Array([0, 0, 255, 255]);
const srcPixels = new Uint8Array([255, 0, 0, 128]);
const destPtr = instance.exports.sakura_alloc(destPixels.length);
const srcPtr = instance.exports.sakura_alloc(srcPixels.length);
try {
  new Uint8Array(instance.exports.memory.buffer, destPtr, destPixels.length).set(destPixels);
  new Uint8Array(instance.exports.memory.buffer, srcPtr, srcPixels.length).set(srcPixels);
  const status = instance.exports.sakura_rgba_blit_over(
    destPtr,
    destPixels.length,
    1,
    1,
    srcPtr,
    srcPixels.length,
    1,
    1,
    0,
    0,
    255,
  );
  if (status !== 0) {
    throw new Error(`unexpected RGBA blit status ${status}`);
  }
  const blended = Array.from(
    new Uint8Array(instance.exports.memory.buffer, destPtr, destPixels.length),
  );
  if (blended.join(",") !== "128,0,127,255") {
    throw new Error(`RGBA blit mismatch: ${blended.join(",")}`);
  }
} finally {
  instance.exports.sakura_dealloc(srcPtr, srcPixels.length);
  instance.exports.sakura_dealloc(destPtr, destPixels.length);
}

console.log("wasm_smoke=ok");

function writePayloadPacket(payload, packetLength, writer, label) {
  const payloadPtr = instance.exports.sakura_alloc(payload.length);
  try {
    new Uint8Array(instance.exports.memory.buffer, payloadPtr, payload.length).set(payload);
    const packetPtr = instance.exports.sakura_alloc(packetLength);
    try {
      const written = writer(payloadPtr, payload.length, packetPtr, packetLength);
      if (written !== packetLength) {
        throw new Error(`unexpected ${label} write length ${written}`);
      }
      return new Uint8Array(instance.exports.memory.buffer, packetPtr, packetLength).slice();
    } finally {
      instance.exports.sakura_dealloc(packetPtr, packetLength);
    }
  } finally {
    instance.exports.sakura_dealloc(payloadPtr, payload.length);
  }
}

function buildArc20Prefix(files) {
  const entryLength = 128;
  const nameLength = 96;
  const headerLength = 16;
  const prefix = new Uint8Array(headerLength + files.length * entryLength);
  prefix.set(new TextEncoder().encode("BURIKO ARC20"), 0);
  new DataView(prefix.buffer).setUint32(12, files.length, true);

  let relativeOffset = 0;
  for (const [index, [name, size]] of files.entries()) {
    const entryOffset = headerLength + index * entryLength;
    prefix.set(new TextEncoder().encode(name), entryOffset);
    const view = new DataView(prefix.buffer);
    view.setUint32(entryOffset + nameLength, relativeOffset, true);
    view.setUint32(entryOffset + nameLength + 4, size, true);
    relativeOffset += size;
  }

  return {
    prefix,
    archiveLength: prefix.length + relativeOffset,
  };
}

function parseArcManifest(manifest) {
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
    const name = new TextDecoder("ascii").decode(manifest.slice(cursor, cursor + nameLength));
    cursor += nameLength;
    entries.push({ name, offset, size });
  }
  return { dataStart, entries };
}

function buildSyntheticV1Cbg() {
  const key = 0x87654321;
  const weights = new Uint8Array(0x100);
  weights[1] = 1;
  weights[7] = 1;
  const header = syntheticCbgHeader({
    key,
    width: 1,
    height: 1,
    bitsPerPixel: 8,
    intermediateLength: 2,
    encodedPlain: weights,
    version: 1,
  });
  const encrypted = encryptCbgPlain(key, weights);
  const data = new Uint8Array(header.length + encrypted.length + 1);
  data.set(header, 0);
  data.set(encrypted, header.length);
  data[header.length + encrypted.length] = 0b01000000;
  return data;
}

function syntheticCbgHeader({
  key,
  width,
  height,
  bitsPerPixel,
  intermediateLength,
  encodedPlain,
  version,
}) {
  const header = new Uint8Array(0x30);
  header.set(new TextEncoder().encode("CompressedBG___\0"), 0);
  const view = new DataView(header.buffer);
  view.setUint16(0x10, width, true);
  view.setUint16(0x12, height, true);
  view.setUint32(0x14, bitsPerPixel, true);
  view.setUint32(0x20, intermediateLength, true);
  view.setUint32(0x24, key, true);
  view.setUint32(0x28, encodedPlain.length, true);
  header[0x2c] = encodedPlain.reduce((sum, byte) => (sum + byte) & 0xff, 0);
  header[0x2d] = encodedPlain.reduce((xor, byte) => xor ^ byte, 0);
  view.setUint16(0x2e, version, true);
  return header;
}

function encryptCbgPlain(key, plain) {
  let state = key >>> 0;
  return Uint8Array.from(plain, (byte) => (byte + nextBgiKeyByte()) & 0xff);

  function nextBgiKeyByte() {
    const v0 = Math.imul(20021, state & 0xffff) >>> 0;
    let v1 = state >>> 16;
    v1 = (Math.imul(v1, 20021) + Math.imul(state, 346)) >>> 0;
    v1 = (v1 + (v0 >>> 16)) & 0xffff;
    state = (((v1 << 16) >>> 0) + (v0 & 0xffff) + 1) >>> 0;
    return v1 & 0xff;
  }
}

function buildSyntheticBgiAudio() {
  const ogg = new TextEncoder().encode("OggSfixture");
  const data = new Uint8Array(8 + ogg.length);
  new DataView(data.buffer).setUint32(0, 8, true);
  data.set(new TextEncoder().encode("bw  "), 4);
  data.set(ogg, 8);
  return data;
}

function buildSyntheticGdb(names) {
  const out = [];
  appendAscii(out, "BURIKO GDB 3.00");
  out.push(0);
  while (out.length < 0x80) {
    out.push(0);
  }
  appendU32(out, names.length);
  for (const name of names) {
    appendAscii(out, name);
    out.push(0);
  }
  appendU32(out, 1);
  appendAscii(out, "MakerLogo");
  out.push(0);
  return new Uint8Array(out);
}

function appendAscii(out, value) {
  for (let index = 0; index < value.length; index += 1) {
    out.push(value.charCodeAt(index) & 0xff);
  }
}

function buildSyntheticScenarioScript() {
  const code = [];
  appendOpcode(code, 0x0003);
  appendI32(code, 24);
  appendOpcode(code, 0x0003);
  appendI32(code, 29);
  appendOpcode(code, 0x0140);
  appendOpcode(code, 0x001b);

  const magic = new TextEncoder().encode("BurikoCompiledScriptVer1.00\0");
  const strings = new TextEncoder().encode("name\0message\0");
  const script = new Uint8Array(magic.length + 12 + code.length + strings.length);
  script.set(magic, 0);
  const view = new DataView(script.buffer);
  view.setInt32(magic.length, 12, true);
  view.setInt32(magic.length + 4, 0, true);
  view.setInt32(magic.length + 8, 0, true);
  script.set(code, magic.length + 12);
  script.set(strings, magic.length + 12 + code.length);
  return script;
}

function buildSyntheticSystemScript() {
  const script = new Uint8Array(0x1b);
  script.set([0x00, 0x2a, 0x91, 0x88, 0xff, 0xf0, 0xff, 0x2a, 0xff, 0xf8, 0x17], 0x10);
  return script;
}

function buildSyntheticSystemTraceScript() {
  const script = new Uint8Array(0x17);
  script.set([0x00, 0x07, 0xb0, 0xff, 0xff, 0x00, 0x17], 0x10);
  return script;
}

function buildSyntheticDsc(plain) {
  const hash = 0x12345678;
  const treeLength = 512;
  const headerLength = 32;
  const dsc = new Uint8Array(headerLength + treeLength + plain.length);
  dsc.set(new TextEncoder().encode("DSC FORMAT 1.00\0"), 0);
  const view = new DataView(dsc.buffer);
  view.setUint32(16, hash, true);
  view.setUint32(20, plain.length, true);

  let currentHash = hash;
  for (let symbol = 0; symbol < treeLength; symbol += 1) {
    const { nextHash, mask } = nextDscMask(currentHash);
    currentHash = nextHash;
    const depth = symbol < 256 ? 8 : 0;
    dsc[headerLength + symbol] = (depth + mask) & 0xff;
  }
  dsc.set(plain, headerLength + treeLength);
  return dsc;
}

function parseScriptSummaryPacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("unexpected script summary packet version");
  }
  const systemUserScriptDispatchCounts = [];
  for (let id = 0; id < 256; id += 1) {
    systemUserScriptDispatchCounts.push(view.getUint32(88 + id * 4, true));
  }
  return {
    kind: view.getUint32(4, true),
    decompressedLength: view.getUint32(8, true),
    instructions: view.getUint32(12, true),
    scenarioMessages: view.getUint32(16, true),
    scenarioCharacterNames: view.getUint32(20, true),
    scenarioChoices: view.getUint32(24, true),
    scenarioUserFunctions: view.getUint32(28, true),
    scenarioEventMessages: view.getUint32(32, true),
    scenarioEventChoices: view.getUint32(36, true),
    systemSyscalls: view.getUint32(40, true),
    systemGraphcalls: view.getUint32(44, true),
    systemSoundcalls: view.getUint32(48, true),
    systemExtcalls: view.getUint32(52, true),
    systemUserScriptCalls: view.getUint32(56, true),
    systemConditionalJumps: view.getUint32(60, true),
    systemInvalidBlocks: view.getUint32(64, true),
    systemStringOperands: view.getUint32(68, true),
    systemUserScriptLoads: view.getUint32(72, true),
    systemUserScriptFrees: view.getUint32(76, true),
    systemUserScriptReturns: view.getUint32(80, true),
    systemUserScriptDispatches: view.getUint32(84, true),
    systemUserScriptDispatchCounts,
  };
}

function parseScenarioFirstEventPacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("unexpected scenario VM first-event packet header");
  }
  return {
    eventKind: view.getUint32(4, true),
    opcode: view.getUint32(8, true),
    offset: view.getUint32(12, true),
    nameLength: view.getUint32(16, true),
    textLength: view.getUint32(20, true),
    optionCount: view.getUint32(24, true),
    stringArgCount: view.getUint32(28, true),
  };
}

function parseSystemTracePacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1 || view.getUint32(4, true) !== 2) {
    throw new Error("unexpected system trace packet header");
  }
  return {
    instructionCount: view.getUint32(8, true),
    serviceCallCount: view.getUint32(12, true),
    userScriptDispatchCount: view.getUint32(16, true),
    maxStackDepth: view.getUint32(20, true),
    dispatchArgBuckets: readTraceCounts(view, 24),
    dispatchFfTopKind: readTraceCounts(view, 56),
    dispatch00TopKind: readTraceCounts(view, 88),
    extFfTopKind: readTraceCounts(view, 120),
    extFfArgBuckets: readTraceCounts(view, 152),
    sound00TopKind: readTraceCounts(view, 184),
    sound00ArgBuckets: readTraceCounts(view, 216),
    graph68TopKind: readTraceCounts(view, 248),
    graph68ArgBuckets: readTraceCounts(view, 280),
  };
}

function parseScenarioSessionProbePacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("unexpected scenario session probe packet header");
  }
  return {
    eventKind: view.getUint32(4, true), mode: view.getUint32(8, true),
    eventCount: view.getUint32(12, true), backlogEntries: view.getUint32(16, true),
    choiceOptionCount: view.getUint32(20, true), snapshotMode: view.getUint32(24, true),
    snapshotEventCount: view.getUint32(28, true), restoredMode: view.getUint32(32, true),
    restoredEventCount: view.getUint32(36, true),
  };
}

function parseSystemVmFirstEventPacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("unexpected system VM first-event packet header");
  }
  return {
    eventKind: view.getUint32(4, true),
    family: view.getUint32(8, true),
    serviceId: view.getUint32(12, true),
    argCount: view.getUint32(16, true),
    topKind: view.getUint32(20, true),
    argKinds: readTraceCounts(view, 24),
  };
}

function parseSystemVmDefaultHostPacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("unexpected system VM default-host packet header");
  }
  return {
    eventCount: view.getUint32(4, true),
    serviceEventCount: view.getUint32(8, true),
    userCallEventCount: view.getUint32(12, true),
    userLoadEventCount: view.getUint32(16, true),
    userFreeEventCount: view.getUint32(20, true),
    userReturnEventCount: view.getUint32(24, true),
    haltedEventCount: view.getUint32(28, true),
    completed: view.getUint32(32, true),
    eventLimited: view.getUint32(36, true),
    lastEventKind: view.getUint32(40, true),
  };
}

function readTraceCounts(view, offset) {
  const counts = [];
  for (let index = 0; index < 8; index += 1) {
    counts.push(view.getUint32(offset + index * 4, true));
  }
  return counts;
}

function appendOpcode(out, opcode) {
  appendU32(out, opcode);
}

function appendI32(out, value) {
  appendU32(out, value >>> 0);
}

function appendU32(out, value) {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function nextDscMask(hash) {
  const edx = Math.imul(20021, hash & 0xffff) >>> 0;
  const eax =
    (Math.imul(20021, (hash >>> 16) & 0xffff) +
      Math.imul(346, hash) +
      ((edx >>> 16) & 0xffff)) >>>
    0;
  const nextHash = ((((eax & 0xffff) << 16) >>> 0) + (edx & 0xffff) + 1) >>> 0;
  return { nextHash, mask: eax & 0xff };
}
