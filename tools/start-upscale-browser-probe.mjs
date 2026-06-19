import { mkdir, writeFile } from "node:fs/promises";
import { chromium, firefox } from "playwright";

const targetUrl = process.env.SAKURA_PROBE_URL ?? "http://127.0.0.1:8789/";
const outDir = process.env.SAKURA_PROBE_OUT_DIR ?? "output/playwright/start-upscale-real";
const holdMs = Number.parseInt(process.env.SAKURA_PROBE_HOLD_MS ?? "15000", 10);
const targetMs = Number.parseInt(process.env.SAKURA_PROBE_TARGET_MS ?? "45000", 10);
const targetText = process.env.SAKURA_PROBE_TARGET_TEXT
  ?? "その風景には、悲しさも、痛みも、なかった。";
const engines = (process.env.SAKURA_PROBE_ENGINES ?? "chromium,firefox")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

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

for (const engine of engines) {
  await runEngine(engine);
}

async function runEngine(engine) {
  const events = [];
  const consoleLines = [];
  let browser = null;
  const push = (type, data = {}) => events.push({ type, at: Date.now(), ...data });
  const save = async (name, data = {}) => {
    await writeFile(
      `${outDir}/${engine}-${name}.json`,
      `${JSON.stringify({ engine, events, console: consoleLines.slice(-100), ...data }, null, 2)}\n`,
    );
  };

  try {
    push("launch");
    browser = await launchBrowser(engine);
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    page.setDefaultTimeout(120_000);
    page.on("console", (message) => {
      consoleLines.push(`[${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      consoleLines.push(`[pageerror] ${error.message}`);
    });
    page.on("crash", () => push("page-crash"));
    page.on("close", () => push("page-close"));
    await page.addInitScript(({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
      window.__startProbe = { frames: [], longTasks: [], fetches: [] };
      const probe = window.__startProbe;
      let lastFrame = 0;
      const frame = (now) => {
        if (lastFrame !== 0) probe.frames.push(now - lastFrame);
        lastFrame = now;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      if (typeof PerformanceObserver === "function") {
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              probe.longTasks.push({
                startTime: entry.startTime,
                duration: entry.duration,
              });
            }
          }).observe({ entryTypes: ["longtask"] });
        } catch {
          // Long Task API can be unavailable in some browser builds.
        }
      }
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        const started = performance.now();
        try {
          const response = await originalFetch(...args);
          const url = String(args[0]?.url ?? args[0] ?? "");
          if (url.includes("/api/upscale/") || url.includes("/api/install/")) {
            probe.fetches.push({
              url,
              status: response.status,
              duration: performance.now() - started,
              cache: response.headers.get("X-Sakura-Upscale-Cache") ?? "",
            });
          }
          return response;
        } catch (error) {
          probe.fetches.push({
            url: String(args[0]?.url ?? args[0] ?? ""),
            error: String(error?.message ?? error),
            duration: performance.now() - started,
          });
          throw error;
        }
      };
    }, { key: "sakura.upscale.v1", value: storageValue });

    push("goto");
    await page.goto(targetUrl, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction(
      () => document.documentElement.dataset.runtimeReady === "1"
        || document.documentElement.dataset.runtimeReady === "true",
      null,
      { timeout: 120_000 },
    );
    push("ready", { state: await readState(page) });

    await page.keyboard.press("ControlLeft");
    push("left-ctrl", { state: await readState(page) });

    await driveToTitle(page, push);
    const beforeStart = await readState(page);
    push("title", { state: beforeStart });

    const startPoint = await page.evaluate(() => {
      const canvas = document.getElementById("stage");
      const inst = window.__sakuraActiveInstall ?? null;
      const image = inst?.titleImage ?? null;
      const controls = window.sakuraTitleMenuControls?.() ?? [];
      const start = controls.find((control) => control.action === "start") ?? null;
      if (!canvas || !inst || inst.stage !== "title" || !image || !start) return null;
      const logicalWidth = Number.isFinite(image.logicalWidth) && image.logicalWidth > 0
        ? image.logicalWidth
        : image.width;
      const logicalHeight = Number.isFinite(image.logicalHeight) && image.logicalHeight > 0
        ? image.logicalHeight
        : image.height;
      const scale = Math.min(canvas.width / logicalWidth, canvas.height / logicalHeight);
      const drawW = Math.round(logicalWidth * scale);
      const drawH = Math.round(logicalHeight * scale);
      const x = Math.floor((canvas.width - drawW) / 2);
      const y = Math.floor((canvas.height - drawH) / 2);
      const button = inst.titleButtonSprites?.[start.label] ?? null;
      const width = (button?.stateWidth ?? 114) * scale;
      const height = (button?.stateHeight ?? 64) * scale;
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + (x + start.x * scale + width / 2) * rect.width / canvas.width,
        y: rect.top + (y + start.y * scale + height / 2) * rect.height / canvas.height,
      };
    });
    if (!startPoint) throw new Error("Start button point unavailable");
    await page.mouse.click(startPoint.x, startPoint.y);
    push("start-click", { point: startPoint, state: await readState(page) });

    const samples = [];
    let target = null;
    let lastMessageClickAt = 0;
    const samplingStartedAt = Date.now();
    const deadline = Date.now() + Math.max(holdMs, targetMs);
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      const state = await readState(page);
      samples.push(state);
      if (samples.length <= 10 || state.player?.eventKind === 1) {
        push("sample", { state });
      }
      if (typeof state.player?.text === "string" && state.player.text.includes(targetText)) {
        target = state;
        push("target", { state });
        await page.screenshot({ path: `${outDir}/${engine}-target.png` });
        break;
      }
      if (
        (
          state.player?.eventKind === 1
          || (
            state.player?.automaticRunning === true
            && state.player?.automaticSkippable === true
            && [3, 5, 6, 7, 8, 9].includes(state.player?.eventKind)
          )
        )
        && Date.now() - lastMessageClickAt >= 350
        && Date.now() - samplingStartedAt < targetMs
      ) {
        const point = await page.evaluate(() => {
          const canvas = document.getElementById("stage");
          const rect = canvas?.getBoundingClientRect();
          if (!rect) return null;
          return {
            x: rect.left + rect.width * 0.5,
            y: rect.top + rect.height * 0.82,
          };
        });
        if (point) {
          await page.mouse.click(point.x, point.y);
          lastMessageClickAt = Date.now();
          push("message-click", { point, state });
        }
      }
    }
    const final = await readState(page);
    await page.screenshot({ path: `${outDir}/${engine}-after-start.png` });
    await save("result", { beforeStart, final, target, targetText, samples });
    console.log(JSON.stringify({
      engine,
      beforeStart: summarizeState(beforeStart),
      final: summarizeState(final),
      target: target ? summarizeState(target) : null,
    }));
  } catch (error) {
    push("error", { message: error instanceof Error ? error.message : String(error) });
    await save("error", { message: error instanceof Error ? error.stack : String(error) });
    console.error(`${engine}: ${error instanceof Error ? error.stack : error}`);
  } finally {
    await browser?.close?.().catch(() => {});
  }
}

async function launchBrowser(engine) {
  if (engine === "firefox") {
    return await firefox.launch({ headless: false });
  }
  if (engine === "helium") {
    return await chromium.launch({
      executablePath: "/opt/helium-browser-bin/helium",
      headless: false,
      args: ["--no-sandbox", "--incognito"],
    });
  }
  return await chromium.launch({ headless: false, args: ["--no-sandbox"] });
}

async function driveToTitle(page, push) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const state = await readState(page);
    if (state.stage === "title") return;
    if (typeof state.stage === "string" && state.stage !== "boot") {
      push("drive-nontitle", { state });
    }
    await page.evaluate(() => window.sakuraAdvanceBoot?.());
    await page.waitForTimeout(120);
  }
  throw new Error("title stage did not become ready");
}

async function readState(page) {
  return await page.evaluate(() => {
    const canvas = document.getElementById("stage");
    const context = canvas?.getContext?.("2d", { willReadFrequently: true }) ?? null;
    let nonBlack = 0;
    let sampled = 0;
    if (canvas && context) {
      try {
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const stepX = Math.max(1, Math.floor(canvas.width / 32));
        const stepY = Math.max(1, Math.floor(canvas.height / 18));
        for (let y = 0; y < canvas.height; y += stepY) {
          for (let x = 0; x < canvas.width; x += stepX) {
            const i = (y * canvas.width + x) * 4;
            sampled += 1;
            if ((data[i] ?? 0) > 4 || (data[i + 1] ?? 0) > 4 || (data[i + 2] ?? 0) > 4) {
              nonBlack += 1;
            }
          }
        }
      } catch {
        nonBlack = -1;
      }
    }
    const inst = window.__sakuraActiveInstall ?? null;
    const player = inst?.player ?? null;
    const frames = [...(window.__startProbe?.frames ?? [])].sort((a, b) => a - b);
    const percentile = (q) => frames.length
      ? frames[Math.min(frames.length - 1, Math.floor((frames.length - 1) * q))]
      : null;
    const event = player?.event ?? null;
    return {
      href: location.href,
      dataset: { ...document.documentElement.dataset },
      stage: inst?.stage ?? "",
      scenarioPlayerQueued: inst?.scenarioPlayerQueued === true,
      hasPlayer: Boolean(player),
      player: player ? {
        scenarioName: player.safeState?.scenarioName ?? "",
        scenarioRoute: player.safeState?.scenarioRoute ?? "",
        scenarioIndex: player.safeState?.scenarioIndex ?? -1,
        active: player.safeState?.active ?? false,
        eventKind: event?.kind ?? -1,
        eventCount: event?.eventCount ?? -1,
        opcode: event?.opcode ?? -1,
        text: typeof event?.text === "string" ? event.text : "",
        automaticRunning: player.automaticRunning === true,
        automaticSkippable: player.automaticSkippable === true,
        messageWindowHidden: player.messageWindowHidden === true,
        visualOpacity: player.messageVisual?.current?.opacity ?? player.messageVisual?.opacity ?? null,
        sceneCurrentName: player.scene?.currentName ?? null,
        sceneCurrentReady: Boolean(player.scene?.current),
        sceneCurrentUpscaled: player.scene?.current?.upscaled === true,
        sceneTargetName: player.scene?.targetName ?? null,
        sceneTransitioning: player.scene?.transitioning === true,
        upscaleSettings: player.upscaleSettings,
      } : null,
      titleLastAction: inst?.titleLastAction ?? "",
      engineManagerOpen: document.querySelector(".engine-manager")?.hidden === false,
      canvas: canvas ? {
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.getBoundingClientRect().width,
        clientHeight: canvas.getBoundingClientRect().height,
        nonBlack,
        sampled,
      } : null,
      probe: {
        frameCount: frames.length,
        frameP95: percentile(0.95),
        frameMax: frames.at(-1) ?? null,
        longTasks: window.__startProbe?.longTasks?.slice(-20) ?? [],
        fetches: window.__startProbe?.fetches?.slice(-80) ?? [],
      },
    };
  });
}

function summarizeState(state) {
  return {
    stage: state.stage,
    queued: state.scenarioPlayerQueued,
    hasPlayer: state.hasPlayer,
    titleLastAction: state.titleLastAction,
    player: state.player,
    canvas: state.canvas,
  };
}
