// Boot the browser runtime against the local install server and dump state + screenshot.
// Usage: node tools/boot-runtime.mjs [--png out.png] [--json out.json] [--timeout-ms N] [--post-ready-ms N]
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

function parseArgs(argv) {
  const o = { png: null, json: null, timeoutMs: 90_000, postReadyMs: 1500, port: 8799 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--png") { o.png = argv[++i]; }
    else if (a === "--json") { o.json = argv[++i]; }
    else if (a === "--timeout-ms") { o.timeoutMs = Number.parseInt(argv[++i], 10); }
    else if (a === "--post-ready-ms") { o.postReadyMs = Number.parseInt(argv[++i], 10); }
    else if (a === "--port") { o.port = Number.parseInt(argv[++i], 10); }
    else if (a === "--query") { o.query = argv[++i]; }
    else if (a === "--advance") { o.advance = Number.parseInt(argv[++i], 10); }
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
const url = `http://127.0.0.1:${opts.port}/${opts.query ? `?${opts.query}` : ""}`;

const server = spawn("node", ["tools/local-server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, SAKURA_PORT: String(opts.port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (c) => { serverLog += c; });
server.stderr.on("data", (c) => { serverLog += c; });

async function waitServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (serverLog.includes("sakura_local_server=ready")) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start:\n${serverLog}`);
}

const consoleLines = [];
let browser;
try {
  await waitServer();
  browser = await chromium.launch({ args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-webgl"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("console", (m) => { consoleLines.push(`[${m.type()}] ${m.text()}`); });
  page.on("pageerror", (e) => { consoleLines.push(`[pageerror] ${e.message}`); });
  await page.goto(url, { waitUntil: "load", timeout: 20_000 });

  const deadline = Date.now() + opts.timeoutMs;
  let ready = false;
  let stage = "0";
  while (Date.now() < deadline) {
    const ds = await page.evaluate(() => ({
      ready: document.documentElement.dataset.runtimeReady,
      stage: document.documentElement.dataset.runtimeAsyncErrorStage,
    }));
    if (ds.ready === "1" || ds.ready === "true") { ready = true; break; }
    if (ds.stage && ds.stage !== "0") { stage = ds.stage; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (ready && opts.postReadyMs > 0) await new Promise((r) => setTimeout(r, opts.postReadyMs));

  for (let i = 0; i < (opts.advance ?? 0); i += 1) {
    await page.evaluate(() => { if (!window.sakuraAdvanceBoot?.()) window.sakuraAdvanceScenario?.(); });
    await new Promise((r) => setTimeout(r, 250));
  }

  const state = await page.evaluate(() => {
    const s = window.__sakuraRuntimeState ?? null;
    const inst = window.__sakuraActiveInstall ?? null;
    const ev = inst?.player?.event ?? null;
    const decoder = new TextDecoder("shift-jis", { fatal: false });
    const decode = (b) => {
      try { return b instanceof Uint8Array ? decoder.decode(b) : (typeof b === "string" ? b : null); }
      catch { return null; }
    };
    const canvas = document.getElementById("stage");
    const ctx = canvas?.getContext?.("2d", { willReadFrequently: true }) ?? null;
    const sample = (x, y) => ctx ? Array.from(ctx.getImageData(x, y, 1, 1).data) : null;
    const hq = s?.runtimeGraphHistoryQueue ?? null;
    const slim = (ev) => ({
      serviceId: ev?.serviceId, off: ev?.instructionOffset, argc: ev?.argCount,
      args: (ev?.args ?? []).map((a) => a?.value),
      inlineStrings: ev?.inlineStrings ?? [],
      memorySamples: (ev?.memorySamples ?? []).map((m) => ({ kind: m?.kind, argIndex: m?.argIndex, rawValue: m?.rawValue, asciiHints: m?.asciiHints ?? [] })),
    });
    return {
      dataset: { ...document.documentElement.dataset },
      summary: s?.summary ?? null,
      runtimeError: s?.runtimeError ?? null,
      runtimeSessionLast: s?.runtimeSession?.last ?? null,
      graphRender: s?.graphRender ?? null,
      playerEvent: ev ? { kind: ev.kind, name: decode(ev.name), text: decode(ev.text), options: (ev.options ?? []).map(decode) } : null,
      graphHistory: hq ? { ready: hq.ready, recorded: hq.recorded, count: (hq.events ?? []).length, events: (hq.events ?? []).map(slim) } : null,
      canvas: canvas ? {
        width: canvas.width, height: canvas.height,
        center: sample(canvas.width >> 1, canvas.height >> 1),
        topLeft: sample(40, 40),
        bottomMid: sample(canvas.width >> 1, Math.max(0, canvas.height - 80)),
        boxBorderTop: sample(400, canvas.height - 180),
        boxFill: sample(400, canvas.height - 120),
        textPixel: sample(92, canvas.height - 132),
        maxLuma: (() => {
          if (!ctx) return null;
          const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let m = 0;
          for (let p = 0; p < d.length; p += 4) { const l = d[p] + d[p+1] + d[p+2]; if (l > m) m = l; }
          return m;
        })(),
      } : null,
    };
  });

  const result = { ready, asyncErrorStage: stage, state, console: consoleLines.slice(-60) };
  if (opts.png) await page.screenshot({ path: opts.png });
  if (opts.json) await writeFile(opts.json, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ready, asyncErrorStage: stage, canvas: state.canvas, dataset: pickDataset(state.dataset), runtimeError: state.runtimeError }));
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill("SIGTERM");
}

function pickDataset(ds) {
  if (!ds) return null;
  const keep = ["runtimeReady", "runtimeMounted", "runtimeRendered", "runtimeAsyncErrorStage",
    "runtimeScriptCount", "runtimeHostServiceCount", "runtimeServiceTraceTotal",
    "runtimeSoundServiceCount", "runtimeEntryTraceTotal", "runtimeTimingStage", "runtimeTimingElapsedMs"];
  const out = {};
  for (const k of keep) if (k in ds) out[k] = ds[k];
  return out;
}
