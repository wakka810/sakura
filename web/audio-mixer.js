const SFX_CHANNEL_COUNT = 9;

export function createAudioMixer() {
  const state = {
    ready: false,
    queued: 0,
    playAttempts: 0,
    playSuccess: 0,
    playBlocked: 0,
    firstSoundId: 0,
    lastSoundId: 0,
    firstOffset: 0,
    lastOffset: 0,
    trackReady: 0,
    trackPlaySuccess: 0,
    trackPlayBlocked: 0,
    voiceReady: 0,
    voicePlaySuccess: 0,
    voicePlayBlocked: 0,
    voiceActiveChannels: 0,
    voiceLastChannel: 0,
    sfxReady: 0,
    sfxPlaySuccess: 0,
    sfxPlayBlocked: 0,
    sfxActiveChannels: 0,
    sfxLastChannel: 0,
    sfxFadeMs: 0,
    loopSfxReady: 0,
    loopSfxPlaySuccess: 0,
    loopSfxPlayBlocked: 0,
    loopSfxFadeMs: 0,
    loopSfxTargetVolume: 0,
    masterVolume: 1,
    bgmVolume: 1,
    voiceVolume: 1,
    sfxVolume: 1,
  };
  const mix = {
    master: 1,
    bgm: 1,
    voice: 1,
    sfx: 1,
  };
  let audio = null;
  let activeUrl = null;
  let trackScriptVolume = 1;
  const voiceChannels = Array.from({ length: SFX_CHANNEL_COUNT }, () => ({
    audio: null,
    url: null,
    volume: 1,
    waiters: new Set(),
  }));
  const sfxChannels = Array.from({ length: SFX_CHANNEL_COUNT }, () => ({
    audio: null,
    url: null,
    volume: 1,
    fadeFrame: 0,
    waiters: new Set(),
  }));
  let loopSfxAudio = null;
  let loopSfxUrl = null;
  let loopSfxScriptVolume = 1;
  let bgmFadeFrame = 0;
  let loopSfxFadeFrame = 0;

  return {
    // Longest remaining playback across active voice channels, in ms (0 if none).
    // Used by Auto mode to hold a line until its voice clip finishes.
    activeVoiceRemainingMs() {
      let remaining = 0;
      for (const slot of voiceChannels) {
        const a = slot.audio;
        if (a && !a.paused && Number.isFinite(a.duration)) {
          remaining = Math.max(remaining, (a.duration - a.currentTime) * 1000);
        }
      }
      return remaining;
    },
    prepare(ogg, queue) {
      resetBgm();
      state.ready = false;
      state.queued = queue?.recordedCount ?? queue?.recorded ?? 0;
      const first = queue?.events?.[0] ?? null;
      const last = queue?.events?.[queue.events.length - 1] ?? null;
      state.firstSoundId = first?.serviceId ?? 0;
      state.lastSoundId = last?.serviceId ?? 0;
      state.firstOffset = first?.instructionOffset ?? 0;
      state.lastOffset = last?.instructionOffset ?? 0;
      if (ogg === null || state.queued === 0) {
        return false;
      }
      return configureBgm(ogg);
    },
    async playFirstQueued() {
      state.playAttempts += 1;
      if (!audio || !state.ready) {
        state.playBlocked += 1;
        return { ok: false, reason: "not_ready" };
      }
      try {
        audio.currentTime = 0;
        await audio.play();
        state.playSuccess += 1;
        return { ok: true, reason: "ok" };
      } catch {
        state.playBlocked += 1;
        return { ok: false, reason: "blocked" };
      }
    },
    async playTrack(ogg, { loop = true, volume = 1 } = {}) {
      state.playAttempts += 1;
      resetBgm();
      if (!configureBgm(ogg)) {
        state.playBlocked += 1;
        state.trackPlayBlocked += 1;
        return { ok: false, reason: "not_ready" };
      }
      audio.loop = loop;
      trackScriptVolume = clampVolume(volume);
      audio.volume = effectiveBgmVolume(trackScriptVolume);
      state.trackReady = 1;
      try {
        await audio.play();
        state.playSuccess += 1;
        state.trackPlaySuccess += 1;
        return { ok: true, reason: "ok" };
      } catch {
        state.playBlocked += 1;
        state.trackPlayBlocked += 1;
        return { ok: false, reason: "blocked" };
      }
    },
    async playVoice(ogg, { volume = 1, channel = 0 } = {}) {
      state.playAttempts += 1;
      const channelIndex = clampSfxChannel(channel);
      resetVoiceChannel(channelIndex);
      const configured = configureAudioElement(ogg);
      if (!configured) {
        state.playBlocked += 1;
        state.voicePlayBlocked += 1;
        return { ok: false, reason: "not_ready" };
      }
      const slot = voiceChannels[channelIndex];
      slot.audio = configured.audio;
      slot.url = configured.url;
      slot.audio.preload = "auto";
      slot.audio.src = slot.url;
      slot.audio.loop = false;
      slot.volume = clampVolume(volume);
      slot.audio.volume = effectiveVoiceVolume(slot.volume);
      const currentAudio = slot.audio;
      slot.audio.onended = () => {
        if (slot.audio === currentAudio) {
          resetVoiceChannel(channelIndex);
        }
      };
      state.voiceLastChannel = channelIndex;
      updateVoiceState();
      try {
        await slot.audio.play();
        state.playSuccess += 1;
        state.voicePlaySuccess += 1;
        return { ok: true, reason: "ok" };
      } catch {
        state.playBlocked += 1;
        state.voicePlayBlocked += 1;
        resetVoiceChannel(channelIndex);
        return { ok: false, reason: "blocked" };
      }
    },
    async playSfx(ogg, { volume = 1, channel = 0 } = {}) {
      state.playAttempts += 1;
      const channelIndex = clampSfxChannel(channel);
      resetSfxChannel(channelIndex);
      const configured = configureAudioElement(ogg);
      if (!configured) {
        state.playBlocked += 1;
        state.sfxPlayBlocked += 1;
        return { ok: false, reason: "not_ready" };
      }
      const slot = sfxChannels[channelIndex];
      slot.audio = configured.audio;
      slot.url = configured.url;
      slot.audio.preload = "auto";
      slot.audio.src = slot.url;
      slot.audio.loop = false;
      slot.volume = clampVolume(volume);
      slot.audio.volume = effectiveSfxVolume(slot.volume);
      const currentAudio = slot.audio;
      slot.audio.onended = () => {
        if (slot.audio === currentAudio) {
          resetSfxChannel(channelIndex);
        }
      };
      state.sfxLastChannel = channelIndex;
      updateSfxState();
      try {
        await slot.audio.play();
        state.playSuccess += 1;
        state.sfxPlaySuccess += 1;
        return { ok: true, reason: "ok" };
      } catch {
        state.playBlocked += 1;
        state.sfxPlayBlocked += 1;
        resetSfxChannel(channelIndex);
        return { ok: false, reason: "blocked" };
      }
    },
    async playLoopingSfx(ogg, { volume = 1 } = {}) {
      state.playAttempts += 1;
      resetLoopSfx();
      const configured = configureAudioElement(ogg);
      if (!configured) {
        state.playBlocked += 1;
        state.loopSfxPlayBlocked += 1;
        return { ok: false, reason: "not_ready" };
      }
      loopSfxAudio = configured.audio;
      loopSfxUrl = configured.url;
      loopSfxAudio.preload = "auto";
      loopSfxAudio.src = loopSfxUrl;
      loopSfxAudio.loop = true;
      loopSfxScriptVolume = clampVolume(volume);
      loopSfxAudio.volume = effectiveSfxVolume(loopSfxScriptVolume);
      state.loopSfxTargetVolume = loopSfxScriptVolume;
      state.loopSfxReady = 1;
      try {
        await loopSfxAudio.play();
        state.playSuccess += 1;
        state.loopSfxPlaySuccess += 1;
        return { ok: true, reason: "ok" };
      } catch {
        state.playBlocked += 1;
        state.loopSfxPlayBlocked += 1;
        return { ok: false, reason: "blocked" };
      }
    },
    fadeOut(durationMs) {
      return rampBgmVolume(0, durationMs, true);
    },
    changeTrackVolume(volume, durationMs) {
      return rampBgmVolume(volume, durationMs, false);
    },
    setVolumes({ master, bgm, voice, sfx } = {}) {
      if (master !== undefined) mix.master = clampVolume(master);
      if (bgm !== undefined) mix.bgm = clampVolume(bgm);
      if (voice !== undefined) mix.voice = clampVolume(voice);
      if (sfx !== undefined) mix.sfx = clampVolume(sfx);
      syncVolumeState();
      applyEffectiveVolumes();
      return true;
    },
    stopTrack() {
      const active = audio !== null;
      resetBgm();
      return active;
    },
    stopVoice(channel) {
      const channelIndex = clampSfxChannel(channel);
      const active = voiceChannels[channelIndex].audio !== null;
      resetVoiceChannel(channelIndex);
      return active;
    },
    stopVoices() {
      const active = state.voiceActiveChannels > 0;
      resetVoice();
      return active;
    },
    waitForVoice(channel) {
      const slot = voiceChannels[clampSfxChannel(channel)];
      if (slot.audio === null) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        slot.waiters.add(resolve);
      });
    },
    fadeOutLoopingSfx(durationMs) {
      state.loopSfxFadeMs = clampDuration(durationMs);
      state.loopSfxTargetVolume = 0;
      return rampLoopSfxVolume(0, durationMs, true);
    },
    changeLoopingSfxVolume(volume, durationMs) {
      state.loopSfxFadeMs = clampDuration(durationMs);
      state.loopSfxTargetVolume = clampVolume(volume);
      return rampLoopSfxVolume(volume, durationMs, false);
    },
    stopLoopingSfx() {
      const active = loopSfxAudio !== null;
      resetLoopSfx();
      return active;
    },
    fadeOutSfx(channel, durationMs) {
      const channelIndex = clampSfxChannel(channel);
      state.sfxLastChannel = channelIndex;
      state.sfxFadeMs = clampDuration(durationMs);
      return rampSfxVolume(channelIndex, 0, durationMs, true);
    },
    stopSfx(channel) {
      const channelIndex = clampSfxChannel(channel);
      const active = sfxChannels[channelIndex].audio !== null;
      resetSfxChannel(channelIndex);
      return active;
    },
    waitForSfx(channel) {
      const slot = sfxChannels[clampSfxChannel(channel)];
      if (slot.audio === null) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        slot.waiters.add(resolve);
      });
    },
    state: () => ({
      ...state,
      loopSfxVolume: loopSfxAudio?.volume ?? 0,
      trackVolume: audio?.volume ?? 0,
    }),
    destroy: resetAll,
  };

  function configureBgm(ogg) {
    const configured = configureAudioElement(ogg);
    if (!configured) return false;
    audio = configured.audio;
    activeUrl = configured.url;
    audio.preload = "auto";
    audio.src = activeUrl;
    trackScriptVolume = 1;
    audio.volume = effectiveBgmVolume(trackScriptVolume);
    state.ready = true;
    return true;
  }

  function configureAudioElement(ogg) {
    if (ogg === null || ogg === undefined) {
      return null;
    }
    const element = new Audio();
    if (element.canPlayType("audio/ogg; codecs=vorbis") === "") {
      return null;
    }
    return {
      audio: element,
      url: URL.createObjectURL(new Blob([ogg], { type: "audio/ogg" })),
    };
  }

  function resetBgm() {
    cancelBgmFade();
    state.ready = false;
    state.trackReady = 0;
    trackScriptVolume = 1;
    audio?.pause();
    audio = null;
    if (activeUrl !== null) {
      URL.revokeObjectURL(activeUrl);
      activeUrl = null;
    }
  }

  function resetVoiceChannel(channel) {
    const slot = voiceChannels[channel];
    slot.audio?.pause();
    if (slot.audio !== null) {
      slot.audio.onended = null;
    }
    slot.audio = null;
    slot.volume = 1;
    if (slot.url !== null) {
      URL.revokeObjectURL(slot.url);
      slot.url = null;
    }
    for (const resolve of slot.waiters) {
      resolve();
    }
    slot.waiters.clear();
    updateVoiceState();
  }

  function resetVoice() {
    for (let channel = 0; channel < voiceChannels.length; channel += 1) {
      resetVoiceChannel(channel);
    }
  }

  function updateVoiceState() {
    const active = voiceChannels.reduce(
      (count, slot) => count + Number(slot.audio !== null),
      0,
    );
    state.voiceActiveChannels = active;
    state.voiceReady = Number(active > 0);
  }

  function resetSfxChannel(channel) {
    const slot = sfxChannels[channel];
    cancelSfxFade(slot);
    slot.audio?.pause();
    if (slot.audio !== null) {
      slot.audio.onended = null;
    }
    slot.audio = null;
    slot.volume = 1;
    if (slot.url !== null) {
      URL.revokeObjectURL(slot.url);
      slot.url = null;
    }
    for (const resolve of slot.waiters) {
      resolve();
    }
    slot.waiters.clear();
    updateSfxState();
  }

  function resetSfx() {
    for (let channel = 0; channel < sfxChannels.length; channel += 1) {
      resetSfxChannel(channel);
    }
  }

  function updateSfxState() {
    const active = sfxChannels.reduce(
      (count, slot) => count + Number(slot.audio !== null),
      0,
    );
    state.sfxActiveChannels = active;
    state.sfxReady = Number(active > 0);
  }

  function resetLoopSfx() {
    cancelLoopSfxFade();
    state.loopSfxReady = 0;
    state.loopSfxTargetVolume = 0;
    loopSfxScriptVolume = 1;
    loopSfxAudio?.pause();
    loopSfxAudio = null;
    if (loopSfxUrl !== null) {
      URL.revokeObjectURL(loopSfxUrl);
      loopSfxUrl = null;
    }
  }

  function resetAll() {
    resetBgm();
    resetVoice();
    resetSfx();
    resetLoopSfx();
  }

  function rampBgmVolume(volume, durationMs, stopAtEnd) {
    if (!audio) {
      return false;
    }
    cancelBgmFade();
    const targetScriptVolume = clampVolume(volume);
    const target = stopAtEnd ? 0 : effectiveBgmVolume(targetScriptVolume);
    const duration = clampDuration(durationMs);
    if (duration === 0) {
      audio.volume = target;
      if (stopAtEnd) {
        resetBgm();
      } else {
        trackScriptVolume = targetScriptVolume;
      }
      return true;
    }
    if (!stopAtEnd) {
      trackScriptVolume = targetScriptVolume;
    }
    const currentAudio = audio;
    startAudioVolumeRamp(
      currentAudio,
      target,
      duration,
      () => audio === currentAudio,
      (handle) => { bgmFadeFrame = handle; },
      () => {
        bgmFadeFrame = 0;
        if (stopAtEnd) resetBgm();
      },
    );
    return true;
  }

  function rampLoopSfxVolume(volume, durationMs, stopAtEnd) {
    if (!loopSfxAudio) {
      return false;
    }
    cancelLoopSfxFade();
    const targetScriptVolume = clampVolume(volume);
    const target = stopAtEnd ? 0 : effectiveSfxVolume(targetScriptVolume);
    const duration = clampDuration(durationMs);
    if (duration === 0) {
      loopSfxAudio.volume = target;
      if (stopAtEnd) {
        resetLoopSfx();
      } else {
        loopSfxScriptVolume = targetScriptVolume;
      }
      return true;
    }
    if (!stopAtEnd) {
      loopSfxScriptVolume = targetScriptVolume;
    }
    const currentAudio = loopSfxAudio;
    startAudioVolumeRamp(
      currentAudio,
      target,
      duration,
      () => loopSfxAudio === currentAudio,
      (handle) => { loopSfxFadeFrame = handle; },
      () => {
        loopSfxFadeFrame = 0;
        if (stopAtEnd) resetLoopSfx();
      },
    );
    return true;
  }

  function rampSfxVolume(channel, volume, durationMs, stopAtEnd) {
    const slot = sfxChannels[channel];
    if (!slot.audio) {
      return false;
    }
    cancelSfxFade(slot);
    const targetScriptVolume = clampVolume(volume);
    const target = stopAtEnd ? 0 : effectiveSfxVolume(targetScriptVolume);
    const duration = clampDuration(durationMs);
    if (duration === 0) {
      slot.audio.volume = target;
      if (stopAtEnd) {
        resetSfxChannel(channel);
      } else {
        slot.volume = targetScriptVolume;
      }
      return true;
    }
    if (!stopAtEnd) {
      slot.volume = targetScriptVolume;
    }
    const currentAudio = slot.audio;
    startAudioVolumeRamp(
      currentAudio,
      target,
      duration,
      () => slot.audio === currentAudio,
      (handle) => { slot.fadeFrame = handle; },
      () => {
        slot.fadeFrame = 0;
        if (stopAtEnd) resetSfxChannel(channel);
      },
    );
    return true;
  }

  function cancelBgmFade() {
    if (bgmFadeFrame !== 0) {
      cancelFrame(bgmFadeFrame);
      bgmFadeFrame = 0;
    }
  }

  function cancelLoopSfxFade() {
    if (loopSfxFadeFrame !== 0) {
      cancelFrame(loopSfxFadeFrame);
      loopSfxFadeFrame = 0;
    }
  }

  function cancelSfxFade(slot) {
    if (slot.fadeFrame !== 0) {
      cancelFrame(slot.fadeFrame);
      slot.fadeFrame = 0;
    }
  }

  function applyEffectiveVolumes() {
    cancelBgmFade();
    cancelLoopSfxFade();
    if (audio !== null) {
      audio.volume = effectiveBgmVolume(trackScriptVolume);
    }
    for (const slot of voiceChannels) {
      if (slot.audio !== null) {
        slot.audio.volume = effectiveVoiceVolume(slot.volume);
      }
    }
    for (const slot of sfxChannels) {
      cancelSfxFade(slot);
      if (slot.audio !== null) {
        slot.audio.volume = effectiveSfxVolume(slot.volume);
      }
    }
    if (loopSfxAudio !== null) {
      loopSfxAudio.volume = effectiveSfxVolume(loopSfxScriptVolume);
    }
  }

  function effectiveBgmVolume(volume) {
    return clampVolume(volume * mix.master * mix.bgm);
  }

  function effectiveVoiceVolume(volume) {
    return clampVolume(volume * mix.master * mix.voice);
  }

  function effectiveSfxVolume(volume) {
    return clampVolume(volume * mix.master * mix.sfx);
  }

  function syncVolumeState() {
    state.masterVolume = mix.master;
    state.bgmVolume = mix.bgm;
    state.voiceVolume = mix.voice;
    state.sfxVolume = mix.sfx;
  }
}

function clampVolume(value) {
  return Math.max(0, Math.min(Number(value) || 0, 1));
}

function clampDuration(value) {
  return Math.max(0, Math.min(Number(value) || 0, 600_000));
}

function clampSfxChannel(value) {
  const channel = Number.isInteger(value) ? value : 0;
  return Math.max(0, Math.min(channel, SFX_CHANNEL_COUNT - 1));
}

function startAudioVolumeRamp(audio, target, duration, isCurrent, setFrame, onComplete) {
  const startedAt = now();
  const startVolume = audio.volume;
  const frame = () => {
    if (!isCurrent()) {
      onComplete();
      return;
    }
    const progress = Math.min(1, (now() - startedAt) / duration);
    audio.volume = startVolume + (target - startVolume) * progress;
    if (progress >= 1) {
      onComplete();
      return;
    }
    setFrame(requestFrame(frame));
  };
  setFrame(requestFrame(frame));
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function requestFrame(callback) {
  return globalThis.requestAnimationFrame?.(callback)
    ?? globalThis.setTimeout(callback, 16);
}

function cancelFrame(handle) {
  if (globalThis.cancelAnimationFrame) {
    globalThis.cancelAnimationFrame(handle);
  } else {
    globalThis.clearTimeout(handle);
  }
}
