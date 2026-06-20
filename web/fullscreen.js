export function applyFullscreenMode(settings, documentRef = globalThis.document, targetRef = null) {
  const document = documentRef ?? globalThis.document;
  if (!document) {
    return { ok: false, reason: "document_unavailable" };
  }
  const wantsFullscreen = settings?.screenMode === "fullscreen";
  return wantsFullscreen
    ? enterFullscreen(document, targetRef)
    : exitFullscreen(document);
}

export function toggleFullscreenMode(documentRef = globalThis.document, targetRef = null) {
  const document = documentRef ?? globalThis.document;
  if (!document) {
    return { ok: false, reason: "document_unavailable" };
  }
  return isFullscreenActive(document)
    ? exitFullscreen(document)
    : enterFullscreen(document, targetRef);
}

export function readFullscreenState(documentRef = globalThis.document, targetRef = null) {
  const document = documentRef ?? globalThis.document;
  return {
    active: isFullscreenActive(document),
    available: isFullscreenAvailable(document, targetRef),
  };
}

export function isFullscreenActive(documentRef = globalThis.document) {
  const document = documentRef ?? globalThis.document;
  return Boolean(fullscreenElement(document));
}

export function isFullscreenAvailable(documentRef = globalThis.document, targetRef = null) {
  const document = documentRef ?? globalThis.document;
  const target = fullscreenTarget(document, targetRef);
  if (!document || !target) {
    return false;
  }
  if (document.fullscreenEnabled === false && document.webkitFullscreenEnabled === false) {
    return false;
  }
  return typeof requestFullscreenFunction(target) === "function";
}

function enterFullscreen(document, targetRef) {
  if (isFullscreenActive(document)) {
    return { ok: true, reason: "already_fullscreen" };
  }
  const target = fullscreenTarget(document, targetRef);
  const requestFullscreen = requestFullscreenFunction(target);
  if (typeof requestFullscreen !== "function") {
    return { ok: false, reason: "fullscreen_unavailable" };
  }
  try {
    const promise = requestFullscreen.call(target);
    promise?.catch?.(() => {});
    return { ok: true, reason: "fullscreen_requested" };
  } catch {
    return { ok: false, reason: "fullscreen_failed" };
  }
}

function exitFullscreen(document) {
  if (!isFullscreenActive(document)) {
    return { ok: true, reason: "already_window" };
  }
  const exitFullscreen = exitFullscreenFunction(document);
  if (typeof exitFullscreen !== "function") {
    return { ok: false, reason: "exit_fullscreen_unavailable" };
  }
  try {
    const promise = exitFullscreen.call(document);
    promise?.catch?.(() => {});
    return { ok: true, reason: "exit_fullscreen_requested" };
  } catch {
    return { ok: false, reason: "exit_fullscreen_failed" };
  }
}

function fullscreenElement(document) {
  return document?.fullscreenElement
    ?? document?.webkitFullscreenElement
    ?? document?.msFullscreenElement
    ?? null;
}

function fullscreenTarget(document, targetRef) {
  return targetRef ?? document?.documentElement ?? null;
}

function requestFullscreenFunction(target) {
  return target?.requestFullscreen
    ?? target?.webkitRequestFullscreen
    ?? target?.msRequestFullscreen
    ?? null;
}

function exitFullscreenFunction(document) {
  return document?.exitFullscreen
    ?? document?.webkitExitFullscreen
    ?? document?.msExitFullscreen
    ?? null;
}
