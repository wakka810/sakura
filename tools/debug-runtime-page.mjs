import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_URL = "http://127.0.0.1:8788/";
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_MS = 3_000;
const DEFAULT_EVENT_LIMIT = 24;
const DEFAULT_TEXT_LIMIT = 800;
const DEFAULT_POST_READY_MS = 0;

const options = parseArgs(process.argv.slice(2));
const targetUrl = options.url ?? DEFAULT_URL;
const outputJsonPath = options.jsonPath ?? "";
const outputPngPath = options.pngPath ?? "";
const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
const eventLimit = options.eventLimit ?? DEFAULT_EVENT_LIMIT;
const textLimit = options.textLimit ?? DEFAULT_TEXT_LIMIT;
const waitForReady = options.waitForReady;
const postReadyMs = options.postReadyMs ?? DEFAULT_POST_READY_MS;

const profileDir = await mkdtemp(join(tmpdir(), "sakura-chrome-profile-"));
const chrome = spawn("google-chrome-stable", [
  "--headless=new",
  "--disable-gpu",
  "--remote-debugging-port=0",
  `--user-data-dir=${profileDir}`,
  "about:blank",
], {
  stdio: ["ignore", "ignore", "pipe"],
});

let stderr = "";
chrome.stderr.on("data", (chunk) => {
  stderr += chunk.toString("utf8");
});

try {
  const wsUrl = await waitForWebSocketUrl(() => stderr, 15_000);
  const socket = new WebSocket(wsUrl);
  await onceOpen(socket);
  const cdp = createCdp(socket);
  const { targetInfos } = await cdp.send("Target.getTargets");
  const pageTarget = targetInfos.find((target) => target.type === "page") ?? null;
  if (!pageTarget) {
    throw new Error("no page target found");
  }
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: pageTarget.targetId,
    flatten: true,
  });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.navigate", { url: targetUrl }, sessionId);
  await waitForLoad(cdp, sessionId, 15_000);
  if (waitForReady) {
    await waitForRuntimeReady(cdp, sessionId, timeoutMs, pollMs);
    if (postReadyMs > 0) {
      await delay(postReadyMs);
    }
  } else {
    await delay(Math.min(timeoutMs, 12_000));
  }

  const runtimeResult = await cdp.send("Runtime.evaluate", {
    expression: buildProbeExpression({ eventLimit, textLimit }),
    returnByValue: true,
    awaitPromise: false,
  }, sessionId);
  const parsed = JSON.parse(runtimeResult.result.value);
  if (outputPngPath) {
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    await writeFile(outputPngPath, Buffer.from(screenshot.data, "base64"));
  }
  if (outputJsonPath) {
    await writeFile(outputJsonPath, `${JSON.stringify(parsed, null, 2)}\n`);
  }
  console.log(JSON.stringify(parsed));
} finally {
  chrome.kill("SIGTERM");
  await onceExit(chrome);
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

function parseArgs(args) {
  const options = {
    url: null,
    jsonPath: null,
    pngPath: null,
    timeoutMs: null,
    pollMs: null,
    eventLimit: null,
    textLimit: null,
    waitForReady: false,
    postReadyMs: null,
  };
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--wait-ready") {
      options.waitForReady = true;
      continue;
    }
    if (arg === "--json") {
      options.jsonPath = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--png") {
      options.pngPath = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = parsePositiveInt(args[index + 1], "timeout");
      index += 1;
      continue;
    }
    if (arg === "--poll-ms") {
      options.pollMs = parsePositiveInt(args[index + 1], "poll");
      index += 1;
      continue;
    }
    if (arg === "--event-limit") {
      options.eventLimit = parsePositiveInt(args[index + 1], "event limit");
      index += 1;
      continue;
    }
    if (arg === "--text-limit") {
      options.textLimit = parsePositiveInt(args[index + 1], "text limit");
      index += 1;
      continue;
    }
    if (arg === "--post-ready-ms") {
      options.postReadyMs = parsePositiveInt(args[index + 1], "post-ready delay");
      index += 1;
      continue;
    }
    positionals.push(arg);
  }
  if (positionals[0]) {
    options.url = positionals[0];
  }
  if (positionals[1] && !options.pngPath) {
    options.pngPath = positionals[1];
  }
  return options;
}

function parsePositiveInt(raw, label) {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function buildProbeExpression({ eventLimit, textLimit }) {
  return `(() => {
    const state = window.__sakuraRuntimeState ?? window.sakuraRuntimeState ?? null;
    const canvas = document.getElementById("stage");
    const ctx = canvas && typeof canvas.getContext === "function"
      ? canvas.getContext("2d", { alpha: false, willReadFrequently: true })
      : null;
    const sample = (x, y) => {
      if (!ctx) return null;
      return Array.from(ctx.getImageData(x, y, 1, 1).data);
    };
    const queue = state?.entryGraphQueue?.events ?? [];
    const historyQueue = state?.runtimeGraphHistoryQueue?.events ?? [];
    const text = document.getElementById("probe-output")?.textContent ?? "";
    const safeEvent = (event) => ({
      eventIndex: event?.eventIndex ?? 0,
      depth: event?.depth ?? 0,
      family: event?.family ?? 0,
      serviceId: event?.serviceId ?? 0,
      instructionOffset: event?.instructionOffset ?? 0,
      argCount: event?.argCount ?? 0,
      args: event?.args ?? [],
      inlineStrings: event?.inlineStrings ?? [],
      memorySamples: event?.memorySamples ?? [],
    });
    return JSON.stringify({
      dataset: { ...document.documentElement.dataset },
      summary: state?.summary ?? null,
      runtimeError: state?.runtimeError ?? null,
      graphRender: state?.graphRender ?? null,
      runtimeSession: state?.runtimeSession ?? null,
      runtimeSessionLast: state?.runtimeSession?.last ?? null,
      entryGraphQueue: {
        ready: state?.entryGraphQueue?.ready ?? false,
        recorded: state?.entryGraphQueue?.recorded ?? 0,
        events: queue.slice(0, ${eventLimit}).map(safeEvent),
      },
      runtimeGraphHistoryQueue: {
        ready: state?.runtimeGraphHistoryQueue?.ready ?? false,
        recorded: state?.runtimeGraphHistoryQueue?.recorded ?? 0,
        events: historyQueue.map(safeEvent),
      },
      entrySoundQueue: {
        ready: state?.entrySoundQueue?.ready ?? false,
        recorded: state?.entrySoundQueue?.recorded ?? 0,
        events: (state?.entrySoundQueue?.events ?? []).slice(0, ${eventLimit}),
      },
      outputTextTail: text.slice(-${textLimit}),
      canvas: canvas ? {
        width: canvas.width,
        height: canvas.height,
        center: sample(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)),
        topLeft: sample(40, 40),
        lowerMid: sample(Math.floor(canvas.width / 2), Math.max(0, canvas.height - 120)),
        bottomLeft: sample(100, Math.max(0, canvas.height - 100)),
      } : null,
    });
  })()`;
}

function createCdp(socket) {
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data.toString());
    if (typeof message.id === "number") {
      const entry = pending.get(message.id);
      if (!entry) {
        return;
      }
      pending.delete(message.id);
      if (message.error) {
        entry.reject(new Error(message.error.message ?? "cdp error"));
      } else {
        entry.resolve(message.result ?? {});
      }
      return;
    }
    for (const listener of listeners) {
      listener(message);
    }
  });
  return {
    send(method, params = {}, sessionId = null) {
      const messageId = ++id;
      const payload = { id: messageId, method, params };
      if (sessionId) {
        payload.sessionId = sessionId;
      }
      socket.send(JSON.stringify(payload));
      return new Promise((resolve, reject) => {
        pending.set(messageId, { resolve, reject });
      });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

async function waitForWebSocketUrl(getStderr, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = getStderr().match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (match) {
      return match[1];
    }
    await delay(50);
  }
  throw new Error(`timed out waiting for DevTools URL\n${getStderr()}`);
}

async function waitForLoad(cdp, sessionId, timeoutMs) {
  let resolveLoad;
  const loaded = new Promise((resolve) => {
    resolveLoad = resolve;
  });
  const dispose = cdp.onEvent((message) => {
    if (
      message.sessionId === sessionId &&
      message.method === "Page.loadEventFired"
    ) {
      dispose();
      resolveLoad();
    }
  });
  const timer = setTimeout(() => {
    dispose();
    resolveLoad();
  }, timeoutMs);
  try {
    await loaded;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForRuntimeReady(cdp, sessionId, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await cdp.send("Runtime.evaluate", {
      expression: `(() => ({
        ready: document.documentElement.dataset.runtimeReady,
        asyncErrorStage: document.documentElement.dataset.runtimeAsyncErrorStage
      }))()`,
      returnByValue: true,
      awaitPromise: false,
    }, sessionId);
    const value = result?.result?.value ?? {};
    if (value.ready === "1") {
      return;
    }
    if (value.asyncErrorStage && value.asyncErrorStage !== "0") {
      break;
    }
    await delay(pollMs);
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function onceOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (event) => {
      cleanup();
      reject(event.error ?? new Error("websocket open failed"));
    };
    const cleanup = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
  });
}

function onceExit(child) {
  if (child.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
  });
}
