import { createAudioMixer } from "../web/audio-mixer.js";

const createdUrls = [];
const revokedUrls = [];
const audioInstances = [];
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
  ended = false;
  loop = false;
  onended = null;
  paused = false;
  preload = "";
  src = "";
  volume = 1;

  constructor() {
    audioInstances.push(this);
  }

  canPlayType(type) {
    return type === "audio/ogg; codecs=vorbis" ? "probably" : "";
  }

  async play() {
    if (playShouldReject) {
      throw new Error("blocked");
    }
    this.paused = false;
  }

  pause() {
    this.paused = true;
  }

  finish() {
    this.ended = true;
    this.onended?.();
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

playShouldReject = false;
const trackMixer = createAudioMixer();
const track = await trackMixer.playTrack(new Uint8Array([0x4f, 0x67]), {
  loop: true,
  volume: 0.5,
});
state = trackMixer.state();
if (
  !track.ok
  || state.trackReady !== 1
  || state.trackPlaySuccess !== 1
  || state.trackPlayBlocked !== 0
) {
  throw new Error(`unexpected track play state ${JSON.stringify({ track, state })}`);
}
const fadeInMixer = createAudioMixer();
const fadeInTrack = await fadeInMixer.playTrack(new Uint8Array([0x4f, 0x67]), {
  loop: true,
  volume: 0.75,
  fadeInMs: 1000,
});
if (!fadeInTrack.ok || fadeInMixer.state().trackVolume !== 0) {
  throw new Error(`track fade-in did not start silent ${JSON.stringify(fadeInMixer.state())}`);
}
fadeInMixer.destroy();
const voice = await trackMixer.playVoice(new Uint8Array([0x4f, 0x67, 0x67]), {
  volume: 0.75,
});
const firstVoiceAudio = audioInstances.at(-1);
state = trackMixer.state();
if (
  !voice.ok
  || state.trackReady !== 1
  || state.voiceReady !== 1
  || state.voiceActiveChannels !== 1
  || state.voicePlaySuccess !== 1
  || state.voicePlayBlocked !== 0
) {
  throw new Error(`unexpected voice play state ${JSON.stringify({ voice, state })}`);
}
const secondVoice = await trackMixer.playVoice(new Uint8Array([0x4f, 0x67]), {
  volume: 0.5,
  channel: 1,
});
const secondVoiceAudio = audioInstances.at(-1);
state = trackMixer.state();
if (
  !secondVoice.ok
  || state.voiceActiveChannels !== 2
  || state.voiceLastChannel !== 1
  || firstVoiceAudio.paused
) {
  throw new Error(`voice channels were not independent ${JSON.stringify(state)}`);
}
const secondVoiceEnded = trackMixer.waitForVoice(1);
secondVoiceAudio.finish();
await secondVoiceEnded;
state = trackMixer.state();
if (state.voiceActiveChannels !== 1 || state.voiceReady !== 1) {
  throw new Error(`voice completion cleared the wrong channel ${JSON.stringify(state)}`);
}
if (!trackMixer.fadeOut(0)) {
  throw new Error("immediate track fade was rejected");
}
state = trackMixer.state();
if (state.trackReady !== 0 || state.voiceReady !== 1) {
  throw new Error(`track fade changed wrong channel ${JSON.stringify(state)}`);
}
const sfx = await trackMixer.playSfx(new Uint8Array([0x4f, 0x67, 0x67, 0x53]), {
  volume: 0.25,
  channel: 0,
});
state = trackMixer.state();
if (
  !sfx.ok
  || state.voiceReady !== 1
  || state.sfxReady !== 1
  || state.sfxPlaySuccess !== 1
  || state.sfxPlayBlocked !== 0
) {
  throw new Error(`unexpected sfx play state ${JSON.stringify({ sfx, state })}`);
}
const firstSfxAudio = audioInstances.at(-1);
const secondSfx = await trackMixer.playSfx(new Uint8Array([0x4f, 0x67]), {
  volume: 0.5,
  channel: 1,
});
state = trackMixer.state();
if (!secondSfx.ok || state.sfxActiveChannels !== 2 || firstSfxAudio.paused) {
  throw new Error(`independent SFX channels were not preserved ${JSON.stringify(state)}`);
}
const secondSfxAudio = audioInstances.at(-1);
const secondSfxEnded = trackMixer.waitForSfx(1);
secondSfxAudio.finish();
await secondSfxEnded;
state = trackMixer.state();
if (state.sfxActiveChannels !== 1 || state.sfxReady !== 1) {
  throw new Error(`SFX ended wait did not release only its channel ${JSON.stringify(state)}`);
}
if (!trackMixer.fadeOutSfx(0, 0) || trackMixer.state().sfxReady !== 0) {
  throw new Error("SFX channel fade did not stop the requested channel");
}
const loopingSfx = await trackMixer.playLoopingSfx(new Uint8Array([0x4f, 0x67]), {
  volume: 0.4,
});
const loopingSfxAudio = audioInstances.at(-1);
state = trackMixer.state();
if (
  !loopingSfx.ok
  || state.loopSfxReady !== 1
  || state.loopSfxPlaySuccess !== 1
  || state.sfxReady !== 0
) {
  throw new Error(`unexpected looping SFX state ${JSON.stringify({ loopingSfx, state })}`);
}
if (!trackMixer.changeLoopingSfxVolume(0.75, 0)) {
  throw new Error("immediate looping SFX volume change was rejected");
}
state = trackMixer.state();
if (
  loopingSfxAudio.volume !== 0.75
  || state.loopSfxVolume !== 0.75
  || state.loopSfxTargetVolume !== 0.75
  || state.loopSfxFadeMs !== 0
) {
  throw new Error(`looping SFX volume change was not isolated ${JSON.stringify(state)}`);
}
if (
  !trackMixer.stopLoopingSfx()
  || trackMixer.state().loopSfxReady !== 0
  || trackMixer.state().loopSfxTargetVolume !== 0
) {
  throw new Error("looping SFX stop did not clear its channel");
}
const replayedLoopingSfx = await trackMixer.playLoopingSfx(
  new Uint8Array([0x4f, 0x67]),
  { volume: 0.5 },
);
const replayedLoopingSfxAudio = audioInstances.at(-1);
if (!replayedLoopingSfx.ok) {
  throw new Error("looping SFX did not replay after immediate stop");
}
const resumedTrack = await trackMixer.playTrack(new Uint8Array([0x4f, 0x67]), {
  volume: 0.8,
});
if (!resumedTrack.ok) {
  throw new Error("track did not resume for volume-change test");
}
if (!trackMixer.setTrackCurrentTime(12.5) || trackMixer.state().trackCurrentTime !== 12.5) {
  throw new Error(`track currentTime restore failed ${JSON.stringify(trackMixer.state())}`);
}
if (!trackMixer.setLoopingSfxCurrentTime(3.25) || trackMixer.state().loopSfxCurrentTime !== 3.25) {
  throw new Error(`looping SFX currentTime restore failed ${JSON.stringify(trackMixer.state())}`);
}
if (!trackMixer.setVolumes({ master: 0.5, bgm: 0.5, voice: 0.25, sfx: 0.5 })) {
  throw new Error("config volume update was rejected");
}
state = trackMixer.state();
if (
  state.masterVolume !== 0.5
  || state.bgmVolume !== 0.5
  || state.voiceVolume !== 0.25
  || state.sfxVolume !== 0.5
  || state.trackVolume !== 0.2
  || firstVoiceAudio.volume !== 0.09375
  || replayedLoopingSfxAudio.volume !== 0.125
) {
  throw new Error(`config volumes were not applied independently ${JSON.stringify(state)}`);
}
if (!trackMixer.changeTrackVolume(0.25, 0) || !trackMixer.fadeOutLoopingSfx(0)) {
  throw new Error("immediate channel volume changes were rejected");
}
state = trackMixer.state();
if (state.trackReady !== 1 || state.loopSfxReady !== 0 || state.sfxReady !== 0) {
  throw new Error(`channel volume changes affected wrong audio ${JSON.stringify(state)}`);
}
if (!trackMixer.stopVoice(0) || trackMixer.state().voiceReady !== 0) {
  throw new Error("voice stop did not clear its channel");
}
if (!trackMixer.stopTrack() || trackMixer.state().trackReady !== 0) {
  throw new Error("track stop did not clear the BGM channel");
}

const voiceStopMixer = createAudioMixer();
await voiceStopMixer.playVoice(new Uint8Array([0x4f, 0x67]), { channel: 0 });
await voiceStopMixer.playVoice(new Uint8Array([0x4f, 0x67]), { channel: 1 });
const voiceStopFirst = audioInstances.at(-2);
const voiceStopSecond = audioInstances.at(-1);
state = voiceStopMixer.state();
if (state.voiceActiveChannels !== 2 || state.voiceReady !== 1) {
  throw new Error(`stopVoices setup did not keep both channels active ${JSON.stringify(state)}`);
}
if (!voiceStopMixer.stopVoices()) {
  throw new Error("stopVoices did not report active voice channels");
}
state = voiceStopMixer.state();
if (
  state.voiceActiveChannels !== 0
  || state.voiceReady !== 0
  || !voiceStopFirst.paused
  || !voiceStopSecond.paused
) {
  throw new Error(`stopVoices did not clear every voice channel ${JSON.stringify(state)}`);
}
if (voiceStopMixer.stopVoices()) {
  throw new Error("stopVoices reported active channels after clearing them");
}

console.log("audio_mixer_smoke=ok");
