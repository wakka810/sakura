import { createAudioMixer } from "../web/audio-mixer.js";

const createdUrls = [];
const revokedUrls = [];
let playShouldReject = false;

globalThis.Blob = class FakeBlob {
  constructor(parts, options) {
    this.parts = parts;
    this.type = options?.type ?? "";
  }
};

globalThis.URL = {
  createObjectURL(blob) {
    const url = `blob:synthetic-${createdUrls.length + 1}`;
    createdUrls.push({ blob, url });
    return url;
  },
  revokeObjectURL(url) {
    revokedUrls.push(url);
  },
};

globalThis.Audio = class FakeAudio {
  currentTime = 0;
  paused = false;
  preload = "";
  src = "";

  canPlayType(type) {
    return type === "audio/ogg; codecs=vorbis" ? "probably" : "";
  }

  async play() {
    if (playShouldReject) {
      throw new Error("blocked");
    }
  }

  pause() {
    this.paused = true;
  }
};

const queue = {
  recordedCount: 2,
  events: [
    { serviceId: 117, instructionOffset: 396 },
    { serviceId: 114, instructionOffset: 408 },
  ],
};
const mixer = createAudioMixer();

if (!mixer.prepare(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), queue)) {
  throw new Error("expected Ogg queue to prepare");
}

let state = mixer.state();
if (
  !state.ready ||
  state.queued !== 2 ||
  state.firstSoundId !== 117 ||
  state.lastSoundId !== 114 ||
  state.firstOffset !== 396 ||
  state.lastOffset !== 408
) {
  throw new Error(`unexpected prepared mixer state ${JSON.stringify(state)}`);
}

const played = await mixer.playFirstQueued();
state = mixer.state();
if (!played.ok || state.playAttempts !== 1 || state.playSuccess !== 1 || state.playBlocked !== 0) {
  throw new Error(`unexpected successful play state ${JSON.stringify({ played, state })}`);
}

playShouldReject = true;
const blocked = await mixer.playFirstQueued();
state = mixer.state();
if (blocked.ok || blocked.reason !== "blocked" || state.playBlocked !== 1) {
  throw new Error(`unexpected blocked play state ${JSON.stringify({ blocked, state })}`);
}

if (!mixer.prepare(new Uint8Array([0x4f]), { recorded: 1, events: [{ serviceId: 1 }] })) {
  throw new Error("expected legacy recorded queue to prepare");
}
if (revokedUrls.length !== 1 || revokedUrls[0] !== "blob:synthetic-1") {
  throw new Error(`expected prior URL revoke, got ${JSON.stringify(revokedUrls)}`);
}

mixer.destroy();
state = mixer.state();
if (revokedUrls.length !== 2 || state.ready !== false || state.queued !== 1) {
  throw new Error(`unexpected destroy state ${JSON.stringify({ revokedUrls, state })}`);
}

const emptyMixer = createAudioMixer();
if (emptyMixer.prepare(null, queue)) {
  throw new Error("null Ogg should not prepare");
}
const notReady = await emptyMixer.playFirstQueued();
if (notReady.ok || notReady.reason !== "not_ready" || emptyMixer.state().playBlocked !== 1) {
  throw new Error("not-ready play did not report blocked state");
}

console.log("audio_mixer_smoke=ok");
