import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const outDir = process.env.SAKURA_PROBE_OUT_DIR ?? "output/playwright/upscale-quality-real";
const baseUrl = process.env.SAKURA_PROBE_URL
  ?? "http://127.0.0.1:8789/?scenarioPreview=1&scenarioName=00_op_01&noauto=1";
const holdMs = Number.parseInt(process.env.SAKURA_PROBE_HOLD_MS ?? "8000", 10);
const targetText = "その風景には、悲しさも、痛みも、なかった。";
const storageKey = "sakura.upscale.v1";
const storageValue = {
  version: 1,
  settings: {
    upscaleEnabled: true,
    upscaleScale: 2,
    upscaleModel: "waifu2x",
    upscaleQualityMode: "quality",
  },
};

await mkdir(outDir, { recursive: true });

const events = [];
let browser = null;
let context = null;
let page = null;
let cdp = null;
let found = null;
let closed = false;
let crashed = false;
let disconnected = false;

function pushEvent(type, data = {}) {
  events.push({ type, at: Date.now(), ...data });
}

async function writeSnapshot(name, data = {}) {
  await writeFile(
    `${outDir}/${name}.json`,
    `${JSON.stringify({ events, found, closed, crashed, disconnected, ...data }, null, 2)}\n`,
  );
}

try {
  pushEvent("launch");
  const channel = process.env.SAKURA_PROBE_BROWSER_CHANNEL || undefined;
  browser = await chromium.launch({
    channel,
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-session-crashed-bubble",
      "--hide-crash-restore-bubble",
      "--noerrdialogs",
    ],
  });
  browser.on("disconnected", () => {
    disconnected = true;
    pushEvent("browser-disconnected");
  });
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  page = await context.newPage();
  page.setDefaultTimeout(120_000);
  page.on("close", () => {
    closed = true;
    pushEvent("page-close");
  });
  page.on("crash", () => {
    crashed = true;
    pushEvent("page-crash");
  });
  page.on("pageerror", (error) => {
    pushEvent("pageerror", { message: error.message });
  });
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      pushEvent("console", { kind: message.type(), text: message.text() });
    }
  });

  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
    window.__sakuraProbe = {
      frames: [],
      intervals: [],
      longTasks: [],
      canvasCalls: [],
      eventLoopLag: [],
      advances: [],
      fetches: [],
    };

    const probe = window.__sakuraProbe;
    let lastFrame = 0;
    const raf = (now) => {
      if (lastFrame !== 0) {
        const dt = now - lastFrame;
        probe.frames.push(dt);
        if (dt > 32) probe.intervals.push({ t: now, dt });
      }
      lastFrame = now;
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);

    if (typeof PerformanceObserver === "function") {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            probe.longTasks.push({
              name: entry.name,
              startTime: entry.startTime,
              duration: entry.duration,
            });
          }
        });
        observer.observe({ entryTypes: ["longtask"] });
      } catch {
        // Some Chromium builds disable Long Tasks in non-standard contexts.
      }
    }

    let expected = performance.now() + 100;
    const lagTick = () => {
      const now = performance.now();
      const lag = now - expected;
      if (lag > 20) probe.eventLoopLag.push({ t: now, lag });
      expected = now + 100;
      setTimeout(lagTick, 100);
    };
    setTimeout(lagTick, 100);

    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const start = performance.now();
      try {
        const response = await originalFetch(...args);
        const url = String(args[0]?.url ?? args[0] ?? "");
        if (url.includes("/api/upscale/asset")) {
          probe.fetches.push({
            url,
            status: response.status,
            duration: performance.now() - start,
            upscaleCache: response.headers.get("X-Sakura-Upscale-Cache") ?? "",
          });
        }
        return response;
      } catch (error) {
        probe.fetches.push({
          url: String(args[0]?.url ?? args[0] ?? ""),
          error: String(error?.message ?? error),
          duration: performance.now() - start,
        });
        throw error;
      }
    };

    const proto = CanvasRenderingContext2D.prototype;
    const wrap = (name) => {
      const original = proto[name];
      if (typeof original !== "function") return;
      proto[name] = function wrappedCanvasCall(...args) {
        const start = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          const duration = performance.now() - start;
          if (duration > 2) {
            const canvas = this.canvas;
            probe.canvasCalls.push({
              name,
              duration,
              canvasWidth: canvas?.width ?? 0,
              canvasHeight: canvas?.height ?? 0,
              arg0Width: args[0]?.width ?? 0,
              arg0Height: args[0]?.height ?? 0,
              t: performance.now(),
            });
          }
        }
      };
    };
    wrap("drawImage");
    wrap("putImageData");
  }, { key: storageKey, value: storageValue });

  cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.start");

  pushEvent("goto");
  await page.goto(baseUrl, {
    waitUntil: "load",
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => document.documentElement.dataset.runtimeReady === "1"
      || document.documentElement.dataset.runtimeReady === "true",
    null,
    { timeout: 120_000 },
  );
  pushEvent("ready");

  for (let index = 0; index < 80; index += 1) {
    const started = Date.now();
    const state = await page.evaluate((needle) => {
      window.sakuraAdvanceScenario?.();
      const player = window.__sakuraActiveInstall?.player;
      const event = player?.event;
      const decoder = new TextDecoder("shift-jis", { fatal: false });
      const decode = (value) => {
        try {
          if (value instanceof Uint8Array) return decoder.decode(value);
          if (typeof value === "string") return value;
        } catch {
          return "";
        }
        return "";
      };
      const text = decode(event?.text);
      const canvas = document.getElementById("stage");
      const snapshot = {
        scenarioName: player?.safeState?.scenarioName ?? "",
        eventCount: event?.eventCount ?? -1,
        kind: event?.kind ?? -1,
        opcode: event?.opcode ?? -1,
        text,
        includes: text.includes(needle),
        background: player?.scene?.currentName ?? null,
        bgUpscaled: player?.scene?.current?.upscaled === true,
        bgScale: player?.scene?.current?.upscaleScale ?? 1,
        bgSize: [player?.scene?.current?.width ?? 0, player?.scene?.current?.height ?? 0],
        canvas: [canvas?.width ?? 0, canvas?.height ?? 0],
        href: location.href,
      };
      window.__sakuraProbe.advances.push({ ...snapshot, t: performance.now() });
      return snapshot;
    }, targetText);
    const elapsed = Date.now() - started;
    pushEvent("advance", { elapsed, state });
    if (elapsed > 250 || state.eventCount >= 20 || state.includes) {
      console.log(`advance elapsed=${elapsed} ${JSON.stringify(state)}`);
    }
    await writeSnapshot("latest", { lastState: state });
    if (state.includes) {
      found = state;
      break;
    }
    await page.waitForTimeout(80);
  }

  pushEvent("target-wait");
  await page.waitForTimeout(Number.isSafeInteger(holdMs) && holdMs > 0 ? holdMs : 8_000);
  const probe = await page.evaluate(() => {
    const probeState = window.__sakuraProbe;
    const frames = [...probeState.frames].sort((a, b) => a - b);
    const percentile = (q) => frames.length
      ? frames[Math.min(frames.length - 1, Math.floor((frames.length - 1) * q))]
      : null;
    const canvas = document.getElementById("stage");
    const player = window.__sakuraActiveInstall?.player;
    return {
      runtimeError: window.__sakuraRuntimeState?.runtimeError ?? null,
      dataset: { ...document.documentElement.dataset },
      frameCount: frames.length,
      frameP50: percentile(0.5),
      frameP95: percentile(0.95),
      frameP99: percentile(0.99),
      frameMax: frames.at(-1) ?? null,
      intervals: probeState.intervals.slice(-80),
      longTasks: probeState.longTasks.slice(-80),
      eventLoopLag: probeState.eventLoopLag.slice(-80),
      canvasCalls: probeState.canvasCalls.slice(-160),
      fetches: probeState.fetches.slice(-160),
      advances: probeState.advances,
      final: {
        scenarioName: player?.safeState?.scenarioName ?? "",
        eventCount: player?.event?.eventCount ?? -1,
        background: player?.scene?.currentName ?? null,
        bgUpscaled: player?.scene?.current?.upscaled === true,
        bgScale: player?.scene?.current?.upscaleScale ?? 1,
        bgSize: [player?.scene?.current?.width ?? 0, player?.scene?.current?.height ?? 0],
        canvas: [canvas?.width ?? 0, canvas?.height ?? 0],
      },
    };
  });
  const profile = await cdp.send("Profiler.stop").catch((error) => ({ error: error.message }));
  const metrics = await cdp.send("Performance.getMetrics").catch((error) => ({ error: error.message }));
  await page.screenshot({ path: `${outDir}/target-waifu2x-quality-headed.png` });
  await writeFile(`${outDir}/cpu-profile-waifu2x-quality-headed.cpuprofile`, JSON.stringify(profile.profile ?? profile));
  await writeSnapshot("result", { probe, metrics });
  console.log(JSON.stringify({
    found,
    final: probe.final,
    frameP95: probe.frameP95,
    frameMax: probe.frameMax,
    longTaskCount: probe.longTasks.length,
    slowCanvasCount: probe.canvasCalls.length,
  }));
} catch (error) {
  pushEvent("error", { message: error instanceof Error ? error.message : String(error) });
  await writeSnapshot("error", { message: error instanceof Error ? error.stack : String(error) });
  throw error;
} finally {
  await browser?.close?.().catch(() => {});
}
