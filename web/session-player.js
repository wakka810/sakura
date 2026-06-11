const PAYLOAD_KIND_DSC = 1;
const SCENARIO_KIND = 1;
const EVENT_MESSAGE = 1;
const EVENT_CHOICE = 2;
const EVENT_USER_FUNCTION = 3;
const EVENT_HALTED = 4;
const SAVE_SLOT_KEY = "sakura.session.slot.0";
const INITIAL_SCENARIO_MAX_BYTES = 256 * 1024;

const decoder = new TextDecoder("shift_jis");

function asciiName(nameBytes) {
  if (!nameBytes) return "";
  let s = "";
  for (const b of nameBytes) { if (b === 0) break; s += String.fromCharCode(b); }
  return s;
}

// Try a specific scenario record by exact entry name (e.g. the opening 00_op_01).
async function tryScenarioByName(catalog, core, wantName) {
  for (const record of catalog.recordsByKind(PAYLOAD_KIND_DSC)) {
    if (asciiName(record.name).toLowerCase() !== wantName) continue;
    const payload = await catalog.readPayload(record);
    if (core.payloadKind(payload.slice(0, 16)) !== PAYLOAD_KIND_DSC) return null;
    const summary = core.dscScriptSummary(payload);
    if (summary?.kind !== SCENARIO_KIND) return null;
    const handle = core.scenarioSessionCreate(payload);
    if (handle === 0) return null;
    const player = createPlayer(core, handle);
    if (!player.step()) { core.scenarioSessionDestroy(handle); return null; }
    player.safeState.scenarioName = wantName;
    return player;
  }
  return null;
}

export async function createInitialScenarioPlayer(catalog, core) {
  // Faithful playback starts at the opening narration (00_op_01).
  const opening = await tryScenarioByName(catalog, core, "00_op_01");
  if (opening) {
    createInitialScenarioPlayer.lastProbe = { scanned: 1, skippedLarge: 0, ready: true };
    return opening;
  }
  let scanned = 0;
  let skippedLarge = 0;
  createInitialScenarioPlayer.lastProbe = { scanned, skippedLarge, ready: false };
  for (const record of catalog.recordsByKind(PAYLOAD_KIND_DSC)) {
    if (record.size > INITIAL_SCENARIO_MAX_BYTES) {
      skippedLarge += 1;
      continue;
    }
    if (record.kind !== PAYLOAD_KIND_DSC) {
      if (record.kind !== null) {
        continue;
      }
      const prefix = await catalog.readPrefix(record, 16);
      if (core.payloadKind(prefix) !== PAYLOAD_KIND_DSC) {
        continue;
      }
    }
    scanned += 1;
    const payload = await catalog.readPayload(record);
    const summary = core.dscScriptSummary(payload);
    if (summary?.kind !== SCENARIO_KIND) {
      continue;
    }
    const handle = core.scenarioSessionCreate(payload);
    if (handle === 0) {
      continue;
    }
    const player = createPlayer(core, handle);
    if (!player.step()) {
      core.scenarioSessionDestroy(handle);
      continue;
    }
    player.safeState.scanCount = scanned;
    player.safeState.scanSkippedLarge = skippedLarge;
    createInitialScenarioPlayer.lastProbe = { scanned, skippedLarge, ready: true };
    return player;
  }
  createInitialScenarioPlayer.lastProbe = { scanned, skippedLarge, ready: false };
  return null;
}

createInitialScenarioPlayer.lastProbe = { scanned: 0, skippedLarge: 0, ready: false };

export function bindScenarioPlayerInput(canvas, getMounted, onUpdate) {
  const target = canvas.closest(".stage") ?? canvas;
  let lastInputTime = -1;
  const advance = (event) => {
    if (event.timeStamp === lastInputTime) {
      return;
    }
    lastInputTime = event.timeStamp;
    const player = getMounted()?.player;
    if (!player) {
      return;
    }
    let inputResult = -1;
    if (player.event.kind === EVENT_MESSAGE && player.advanceMessage() === 1 && player.step()) {
      inputResult = 1;
    } else if (
      player.event.kind === EVENT_CHOICE &&
      player.event.options.length > 0 &&
      player.selectChoice(choiceIndexFromEvent(event, canvas, player.event.options.length)) === 1 &&
      player.step()
    ) {
      inputResult = 2;
    }
    player.safeState.inputResult = inputResult;
    onUpdate();
  };
  canvas.addEventListener("pointerup", advance);
  if (target !== canvas) {
    target.addEventListener("pointerup", advance);
  }
  canvas.ownerDocument.defaultView.addEventListener("keyup", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      advance({ timeStamp: event.timeStamp, clientY: Number.NaN });
    }
  });
  const advanceScenario = () => {
    advance({ timeStamp: performance.now() });
    return getMounted()?.player?.safeState ?? { active: false };
  };
  const saveScenario = () => {
    const player = getMounted()?.player;
    const result = player?.saveToStorage() ?? { ok: false, bytes: 0, reason: "no_player" };
    onUpdate();
    return result;
  };
  const loadScenario = () => {
    const player = getMounted()?.player;
    const result = player?.loadFromStorage() ?? { ok: false, bytes: 0, reason: "no_player" };
    onUpdate();
    return result;
  };
  globalThis.sakuraAdvanceScenario = advanceScenario;
  globalThis.__sakuraAdvanceScenario = advanceScenario;
  globalThis.sakuraSaveSession = saveScenario;
  globalThis.__sakuraSaveSession = saveScenario;
  globalThis.sakuraLoadSession = loadScenario;
  globalThis.__sakuraLoadSession = loadScenario;
  if (globalThis.window) {
    window.sakuraAdvanceScenario = advanceScenario;
    window.__sakuraAdvanceScenario = advanceScenario;
    window.sakuraSaveSession = saveScenario;
    window.__sakuraSaveSession = saveScenario;
    window.sakuraLoadSession = loadScenario;
    window.__sakuraLoadSession = loadScenario;
  }
}

export function paintScenarioEvent(context, canvas, event) {
  if (event === null || event.kind === EVENT_HALTED) {
    return;
  }
  const boxHeight = 146;
  const x = 64;
  const y = canvas.height - boxHeight - 34;
  context.fillStyle = "rgba(0, 0, 0, 0.78)";
  context.fillRect(x, y, canvas.width - x * 2, boxHeight);
  context.strokeStyle = "rgba(255, 255, 255, 0.45)";
  context.strokeRect(x, y, canvas.width - x * 2, boxHeight);
  context.fillStyle = "#f7f3e8";
  context.font = "24px 'Noto Sans CJK JP', 'Yu Gothic', 'MS Gothic', sans-serif";
  if (event.kind === EVENT_MESSAGE) {
    drawWrappedText(context, event.text, x + 24, y + 48, canvas.width - x * 2 - 48, 30, 3);
  } else if (event.kind === EVENT_CHOICE) {
    event.options.slice(0, 3).forEach((option, index) => {
      context.fillText(`${index + 1}. ${option}`, x + 24, y + 42 + index * 34);
    });
  } else if (event.kind === EVENT_USER_FUNCTION) {
    context.fillText(event.name, x + 24, y + 48);
  }
}

function createPlayer(core, handle) {
  return {
    handle,
    event: { kind: 0 },
    safeState: safeSessionState(false, null),
    step() {
      const packet = core.scenarioSessionStep(handle);
      if (packet === null) {
        return false;
      }
      this.event = decodeSessionEvent(packet, core.scenarioSessionCurrentPayload(handle));
      this.safeState = safeSessionState(true, this.event);
      return true;
    },
    advanceMessage: () => core.scenarioSessionAdvanceMessage(handle),
    selectChoice: (index) => core.scenarioSessionSelectChoice(handle, index),
    save: () => core.scenarioSessionSnapshot(handle),
    saveToStorage() {
      const saved = this.save();
      if (!saved) {
        return { ok: false, bytes: 0, reason: "snapshot_unavailable" };
      }
      const storage = globalThis.window?.localStorage ?? globalThis.localStorage;
      if (!storage) {
        return { ok: false, bytes: saved.byteLength, reason: "storage_unavailable" };
      }
      storage.setItem(SAVE_SLOT_KEY, bytesToBase64(saved));
      this.safeState.lastSaveBytes = saved.byteLength;
      return { ok: true, bytes: saved.byteLength, reason: "ok" };
    },
    loadFromStorage() {
      const storage = globalThis.window?.localStorage ?? globalThis.localStorage;
      const encoded = storage?.getItem(SAVE_SLOT_KEY) ?? null;
      if (encoded === null) {
        return { ok: false, bytes: 0, reason: "missing_snapshot" };
      }
      const snapshot = base64ToBytes(encoded);
      const ok = this.load(snapshot);
      if (ok) {
        this.safeState.lastLoadBytes = snapshot.byteLength;
      }
      return { ok, bytes: snapshot.byteLength, reason: ok ? "ok" : "restore_failed" };
    },
    load(snapshot) {
      if (core.scenarioSessionRestoreSnapshot(handle, snapshot) !== 1) {
        return false;
      }
      this.safeState.lastLoadBytes = snapshot.byteLength;
      return true;
    },
    destroy: () => core.scenarioSessionDestroy(handle),
  };
}

function decodeSessionEvent(packet, payload) {
  const event = {
    kind: packet.eventKind,
    mode: packet.mode,
    eventCount: packet.eventCount,
    payloadLength: packet.payloadLength,
    backlogLength: packet.backlogLength,
  };
  if (packet.eventKind === EVENT_MESSAGE) {
    const nameBytes = payload.slice(0, packet.nameLength);
    const textBytes = payload.slice(packet.nameLength, packet.nameLength + packet.textLength);
    return {
      ...event,
      name: packet.nameLength === 0 ? "" : decoder.decode(nameBytes),
      text: decoder.decode(textBytes),
      textLength: packet.textLength,
    };
  }
  if (packet.eventKind === EVENT_CHOICE) {
    return { ...event, options: decodeLengthPrefixedStrings(payload, packet.optionCount) };
  }
  if (packet.eventKind === EVENT_USER_FUNCTION) {
    const nameBytes = payload.slice(0, packet.nameLength);
    return {
      ...event,
      name: decoder.decode(nameBytes),
      stringArgCount: packet.stringArgCount,
    };
  }
  return event;
}

function decodeLengthPrefixedStrings(payload, count) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const values = [];
  let cursor = 0;
  for (let index = 0; index < count && cursor + 4 <= payload.byteLength; index += 1) {
    const length = view.getUint32(cursor, true);
    cursor += 4;
    values.push(decoder.decode(payload.slice(cursor, cursor + length)));
    cursor += length;
  }
  return values;
}

function choiceIndexFromEvent(event, canvas, optionCount) {
  if (!Number.isFinite(event.clientY)) {
    return 0;
  }
  const rect = canvas.getBoundingClientRect();
  const scaleY = canvas.height / rect.height;
  const y = (event.clientY - rect.top) * scaleY;
  const boxY = canvas.height - 146 - 34;
  const index = Math.floor((y - boxY - 26) / 34);
  return Math.min(Math.max(index, 0), optionCount - 1);
}

function safeSessionState(active, event) {
  return {
    active,
    eventKind: event?.kind ?? 0,
    mode: event?.mode ?? 0,
    eventCount: event?.eventCount ?? 0,
    payloadLength: event?.payloadLength ?? 0,
    backlogLength: event?.backlogLength ?? 0,
    textLength: event?.textLength ?? 0,
    optionCount: event?.options?.length ?? 0,
    inputResult: 0,
    lastSaveBytes: 0,
    lastLoadBytes: 0,
  };
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function drawWrappedText(context, text, x, y, maxWidth, lineHeight, maxLines) {
  const chars = Array.from(text);
  let line = "";
  let lines = 0;
  for (const char of chars) {
    const candidate = line + char;
    if (context.measureText(candidate).width > maxWidth && line.length > 0) {
      context.fillText(line, x, y + lines * lineHeight);
      line = char;
      lines += 1;
      if (lines >= maxLines) {
        return;
      }
    } else {
      line = candidate;
    }
  }
  if (line.length > 0 && lines < maxLines) {
    context.fillText(line, x, y + lines * lineHeight);
  }
}
