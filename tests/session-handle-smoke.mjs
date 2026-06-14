import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const bytes = await readFile(resolve("web/pkg/sakura_core.wasm"));
const { instance } = await WebAssembly.instantiate(bytes, {});
const { exports } = instance;
const stepPacketLen = exports.sakura_scenario_session_step_packet_len();

if (stepPacketLen !== 40) {
  throw new Error(`unexpected session step packet length ${stepPacketLen}`);
}

const dsc = buildSyntheticDsc(buildSyntheticScenarioScript());
const dscPtr = exports.sakura_alloc(dsc.length);
try {
  new Uint8Array(exports.memory.buffer, dscPtr, dsc.length).set(dsc);
  const handle = exports.sakura_scenario_session_create_from_dsc(dscPtr, dsc.length);
  if (handle === 0) {
    throw new Error("failed to create scenario session handle");
  }
  try {
    const graph = step(handle);
    if (
      graph.eventKind !== 5
      || graph.nameLength !== 1
      || graph.textLength !== 1
      || graph.optionCount !== 0x0280
    ) {
      throw new Error("unexpected graph command packet");
    }
    const graphPayload = decodeCurrentPayloadBytes(handle);
    const graphView = new DataView(
      graphPayload.buffer,
      graphPayload.byteOffset,
      graphPayload.byteLength,
    );
    if (
      graphView.getInt32(0, true) !== 3000
      || graphView.getUint32(4, true) !== 7
      || new TextDecoder().decode(graphPayload.slice(8)) !== "sp0065a"
    ) {
      throw new Error("unexpected graph command payload");
    }
    const wait = step(handle);
    if (
      wait.eventKind !== 6
      || wait.nameLength !== 1000
      || wait.optionCount !== 0x0110
    ) {
      throw new Error("unexpected wait command packet");
    }

    const first = step(handle);
    if (first.eventKind !== 1 || first.mode !== 2 || first.textLength !== 5) {
      throw new Error("unexpected first message packet");
    }
    if (decodeCurrentPayload(handle) !== "first") {
      throw new Error("unexpected first message payload");
    }
    if (step(handle, true) !== -1) {
      throw new Error("stepping during pending message should fail");
    }
    if (exports.sakura_scenario_session_advance_message(handle) !== 1) {
      throw new Error("advance message failed");
    }

    const choice = step(handle);
    if (choice.eventKind !== 2 || choice.mode !== 3 || choice.optionCount !== 2) {
      throw new Error("unexpected choice packet");
    }
    const snapshot = sessionSnapshot(handle);
    if (
      snapshot.byteLength < 64 ||
      new TextDecoder("ascii").decode(snapshot.slice(0, 7)) !== "SKRSLT1"
    ) {
      throw new Error("unexpected session snapshot packet");
    }
    if (textIndex(snapshot, "first") !== -1 || textIndex(snapshot, "left") !== -1) {
      throw new Error("session snapshot leaked text payload");
    }
    if (exports.sakura_scenario_session_select_choice(handle, 2) !== 0) {
      throw new Error("out-of-range choice should fail");
    }
    if (exports.sakura_scenario_session_select_choice(handle, 1) !== 1) {
      throw new Error("valid choice failed");
    }

    const second = step(handle);
    if (second.eventKind !== 1 || second.backlogLength !== 2) {
      throw new Error("unexpected second message packet");
    }
    if (decodeCurrentPayload(handle) !== "second") {
      throw new Error("unexpected second message payload");
    }
    const cloned = exports.sakura_scenario_session_clone(handle);
    if (cloned === 0 || decodeCurrentPayload(cloned) !== "second") {
      throw new Error("cloned session did not preserve current payload");
    }
    exports.sakura_scenario_session_destroy(cloned);

    const restored = exports.sakura_scenario_session_create_from_dsc(dscPtr, dsc.length);
    if (restored === 0) {
      throw new Error("failed to create restore target session");
    }
    try {
      restoreSessionSnapshot(restored, snapshot);
      if (exports.sakura_scenario_session_select_choice(restored, 1) !== 1) {
        throw new Error("restored choice selection failed");
      }
      const restoredSecond = step(restored);
      if (restoredSecond.eventKind !== 1 || decodeCurrentPayload(restored) !== "second") {
        throw new Error("restored session did not resume at saved choice");
      }
    } finally {
      exports.sakura_scenario_session_destroy(restored);
    }
  } finally {
    if (exports.sakura_scenario_session_destroy(handle) !== 1) {
      throw new Error("destroy session failed");
    }
  }
} finally {
  exports.sakura_dealloc(dscPtr, dsc.length);
}

console.log("session_handle_smoke=ok");

function step(handle, allowFailure = false) {
  const ptr = exports.sakura_alloc(stepPacketLen);
  try {
    const written = exports.sakura_scenario_session_step_write(handle, ptr, stepPacketLen);
    if (allowFailure && written !== stepPacketLen) {
      return written;
    }
    if (written !== stepPacketLen) {
      throw new Error(`unexpected session step write length ${written}`);
    }
    const packet = new Uint8Array(exports.memory.buffer, ptr, stepPacketLen).slice();
    return parseStepPacket(packet);
  } finally {
    exports.sakura_dealloc(ptr, stepPacketLen);
  }
}

function decodeCurrentPayload(handle) {
  return new TextDecoder().decode(decodeCurrentPayloadBytes(handle));
}

function decodeCurrentPayloadBytes(handle) {
  const len = exports.sakura_scenario_session_current_payload_len(handle);
  const ptr = exports.sakura_alloc(len);
  try {
    const written = exports.sakura_scenario_session_current_payload_write(handle, ptr, len);
    if (written !== len) {
      throw new Error(`unexpected payload write length ${written}`);
    }
    return new Uint8Array(exports.memory.buffer, ptr, len).slice();
  } finally {
    exports.sakura_dealloc(ptr, len);
  }
}

function sessionSnapshot(handle) {
  const len = exports.sakura_scenario_session_snapshot_len(handle);
  const ptr = exports.sakura_alloc(len);
  try {
    const written = exports.sakura_scenario_session_snapshot_write(handle, ptr, len);
    if (written !== len) {
      throw new Error(`unexpected snapshot write length ${written}`);
    }
    return new Uint8Array(exports.memory.buffer, ptr, len).slice();
  } finally {
    exports.sakura_dealloc(ptr, len);
  }
}

function restoreSessionSnapshot(handle, snapshot) {
  const ptr = exports.sakura_alloc(snapshot.byteLength);
  try {
    new Uint8Array(exports.memory.buffer, ptr, snapshot.byteLength).set(snapshot);
    if (
      exports.sakura_scenario_session_restore_snapshot(handle, ptr, snapshot.byteLength) !== 1
    ) {
      throw new Error("restore snapshot failed");
    }
  } finally {
    exports.sakura_dealloc(ptr, snapshot.byteLength);
  }
}

function textIndex(bytes, value) {
  const needle = new TextEncoder().encode(value);
  for (let offset = 0; offset + needle.byteLength <= bytes.byteLength; offset += 1) {
    let matched = true;
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (bytes[offset + index] !== needle[index]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return offset;
    }
  }
  return -1;
}

function parseStepPacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("invalid step packet");
  }
  return {
    eventKind: view.getUint32(4, true),
    mode: view.getUint32(8, true),
    eventCount: view.getUint32(12, true),
    nameLength: view.getUint32(16, true),
    textLength: view.getUint32(20, true),
    optionCount: view.getUint32(24, true),
    stringArgCount: view.getUint32(28, true),
    payloadLength: view.getUint32(32, true),
    backlogLength: view.getUint32(36, true),
  };
}

function buildSyntheticScenarioScript() {
  const code = [];
  appendPushInt(code, 3000);
  appendPushString(code, 104);
  appendOpcode(code, 0x0280);
  appendPushInt(code, 1000);
  appendOpcode(code, 0x0110);
  appendPushString(code, 80);
  appendOpcode(code, 0x0140);
  appendPushString(code, 86);
  appendPushString(code, 91);
  appendOpcode(code, 0x0160);
  appendPushString(code, 97);
  appendOpcode(code, 0x0140);
  appendOpcode(code, 0x001b);
  const magic = new TextEncoder().encode("BurikoCompiledScriptVer1.00\0");
  const strings = new TextEncoder().encode("first\0left\0right\0second\0sp0065a\0");
  const script = new Uint8Array(magic.length + 12 + code.length + strings.length);
  script.set(magic, 0);
  const view = new DataView(script.buffer);
  view.setInt32(magic.length, 12, true);
  script.set(code, magic.length + 12);
  script.set(strings, magic.length + 12 + code.length);
  return script;
}

function appendPushString(code, address) {
  appendOpcode(code, 0x0003);
  appendI32(code, address);
}

function appendPushInt(code, value) {
  appendOpcode(code, 0x0000);
  appendI32(code, value);
}

function appendOpcode(code, opcode) {
  code.push(opcode & 0xff, (opcode >>> 8) & 0xff, (opcode >>> 16) & 0xff, opcode >>> 24);
}

function appendI32(code, value) {
  code.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24);
}

function buildSyntheticDsc(plain) {
  const hash = 0x12345678;
  const treeLen = 512;
  const headerLen = 32;
  const dsc = new Uint8Array(headerLen + treeLen + plain.length);
  dsc.set(new TextEncoder().encode("DSC FORMAT 1.00\0"), 0);
  const view = new DataView(dsc.buffer);
  view.setUint32(16, hash, true);
  view.setUint32(20, plain.length, true);
  let current = hash;
  for (let symbol = 0; symbol < treeLen; symbol += 1) {
    const next = nextDscMask(current);
    current = next.hash;
    dsc[headerLen + symbol] = ((symbol < 256 ? 8 : 0) + next.mask) & 0xff;
  }
  dsc.set(plain, headerLen + treeLen);
  return dsc;
}

function nextDscMask(hash) {
  const edx = Math.imul(20021, hash & 0xffff) >>> 0;
  const eax = (
    Math.imul(20021, (hash >>> 16) & 0xffff) +
    Math.imul(346, hash) +
    ((edx >>> 16) & 0xffff)
  ) >>> 0;
  return {
    hash: ((((eax & 0xffff) << 16) >>> 0) + (edx & 0xffff) + 1) >>> 0,
    mask: eax & 0xff,
  };
}
