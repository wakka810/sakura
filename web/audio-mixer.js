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
  };
  let audio = null;
  let activeUrl = null;

  return {
    prepare(ogg, queue) {
      resetAudio();
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
      audio = new Audio();
      if (audio.canPlayType("audio/ogg; codecs=vorbis") === "") {
        audio = null;
        return false;
      }
      activeUrl = URL.createObjectURL(new Blob([ogg], { type: "audio/ogg" }));
      audio.preload = "auto";
      audio.src = activeUrl;
      state.ready = true;
      return true;
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
    state: () => ({ ...state }),
    destroy: resetAudio,
  };

  function resetAudio() {
    state.ready = false;
    audio?.pause();
    audio = null;
    if (activeUrl !== null) {
      URL.revokeObjectURL(activeUrl);
      activeUrl = null;
    }
  }
}
