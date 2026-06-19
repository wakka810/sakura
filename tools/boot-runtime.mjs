// Boot the browser runtime against the local install server and dump state + screenshot.
// Usage: node tools/boot-runtime.mjs [--png out.png] [--json out.json] [--route pi|an|rn|ze] [--scenario-name NAME] [--start-route pi|an|rn|ze] [--start-scenario-name NAME] [--smoke-routes] [--smoke-route-chapters] [--smoke-full-routes] [--smoke-full-route ROUTE] [--quick-save-load-smoke] [--quick-save-storage-failure-smoke] [--cloud-state-smoke] [--engine-manager-click-smoke] [--timeout-ms N] [--post-ready-ms N] [--wait-after-target-ms N] [--advance-delay-ms N] [--wait-title] [--click-title-menu Start|Load|Config|Extra|Graphic|Scene|Music|IV|V|VI|Exit]... [--open-title-scene] [--click-title-scene INDEX] [--click-title-graphic INDEX] [--click-title-graphic-button previous|next|top|last|back]... [--click-title-graphic-viewer] [--click-title-music INDEX] [--click-dialog-control yes|no|ack] [--seed-save-slot N] [--seed-dummy-save-slot N] [--seed-config-voice-off INDEX] [--seed-upscale] [--seed-upscale-scale N] [--seed-upscale-model MODEL] [--seed-upscale-mode fast|quality] [--press-left-ctrl] [--save-load-advance N] [--open-log-after-backlog N] [--click-message-control INDEX] [--open-userdata save|load] [--click-userdata-control top|previous|next|last|load|save|back|exit|delete|move|copy] [--click-config-control reset|title|back] [--advance-until-event N] [--advance-until-message-control N] [--message-control-count N] [--message-control-opcode N] [--advance-until-sprite-transition N] [--sprite-transition-scenario NAME] [--advance-until-sprite-motion N] [--advance-until-control-motion N] [--advance-until-scene-object N] [--advance-after-scene-object N] [--advance-after-scene-object-delay-ms N] [--advance-until-scene-object-transition N] [--scene-object-transition-event N] [--advance-after-scene-object-transition N] [--advance-until-filter N] [--advance-after-filter N] [--advance-until-filter-clear N] [--advance-after-filter-clear N] [--advance-until-preset-shake N] [--advance-until-sfx-control N] [--advance-until-voice-channels N] [--voice-channel-count N] [--advance-until-scenario N] [--target-scenario NAME] [--advance-until-choice N]
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import {
  scenarioChapterChoices,
  scenarioRouteChoices,
} from "../web/scenario-routes.js";
import {
  defaultScenarioConfigSettings,
  normalizedScenarioConfigSettings,
  SCENARIO_CONFIG_STORAGE_KEY,
} from "../web/scenario-config-window.js";
import {
  normalizeUpscaleSettings,
  UPSCALE_SETTINGS_STORAGE_KEY,
} from "../web/upscale-client.js";

function parseArgs(argv) {
  const o = {
    png: null,
    moviePng: null,
    json: null,
    timeoutMs: 90_000,
    postReadyMs: 1500,
    waitAfterTargetMs: 0,
    port: 8799,
    query: "",
    route: "",
    scenarioName: "",
    startRoute: "",
    startScenarioName: "",
    smokeRoutes: false,
    smokeRouteChapters: false,
    smokeFullRoutes: false,
    smokeFullRoute: "",
    quickSaveLoadSmoke: false,
    quickSaveStorageFailureSmoke: false,
    cloudStateSmoke: false,
    engineManagerClickSmoke: false,
    advanceDelayMs: 250,
    waitTitle: false,
    clickTitleMenu: "",
    clickTitleMenus: [],
    openTitleScene: false,
    clickTitleScene: -1,
    clickTitleGraphic: -1,
    clickTitleGraphicButtons: [],
    clickTitleGraphicViewer: false,
    clickTitleMusic: -1,
    clickDialogControl: "",
    seedSaveSlot: -1,
    seedDummySaveSlot: -1,
    seedTitleClear: "",
    seedConfigVoiceOff: -1,
    seedUpscale: false,
    seedUpscaleScale: 2,
    seedUpscaleModel: "waifu2x",
    seedUpscaleMode: "fast",
    pressLeftCtrl: false,
    saveLoadAdvance: 0,
    openLogAfterBacklog: 0,
    clickMessageControl: -1,
    clickMessageControls: [],
    clickUserDataSlot: -1,
    clickUserDataControl: "",
    openUserData: "",
    clickConfigControl: "",
    logWheel: 0,
    advanceUntilEvent: 0,
    advanceUntilMessageControl: 0,
    messageControlCount: 1,
    messageControlOpcode: 0,
    advanceUntilSpriteTransition: 0,
    spriteTransitionOpcode: 0,
    spriteTransitionCount: 1,
    spriteTransitionEvent: 0,
    spriteTransitionScenario: "",
    advanceUntilSpriteMotion: 0,
    advanceUntilControlMotion: 0,
    advanceAfterControlMotion: 0,
    advanceUntilSceneObject: 0,
    advanceAfterSceneObject: 0,
    advanceAfterSceneObjectDelayMs: 0,
    advanceUntilSceneObjectTransition: 0,
    sceneObjectTransitionEvent: 0,
    advanceAfterSceneObjectTransition: 0,
    advanceUntilFilter: 0,
    advanceAfterFilter: 0,
    advanceUntilFilterClear: 0,
    advanceAfterFilterClear: 0,
    advanceUntilPresetShake: 0,
    advanceUntilSfxControl: 0,
    sfxControlCount: 1,
    advanceAfterSfxControl: 0,
    advanceUntilVoiceChannels: 0,
    voiceChannelCount: 1,
    advanceUntilScenario: 0,
    targetScenario: "",
    advanceUntilChoice: 0,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--png") { o.png = argv[++i]; }
    else if (a === "--movie-png") { o.moviePng = argv[++i]; }
    else if (a === "--json") { o.json = argv[++i]; }
    else if (a === "--timeout-ms") { o.timeoutMs = Number.parseInt(argv[++i], 10); }
    else if (a === "--post-ready-ms") { o.postReadyMs = Number.parseInt(argv[++i], 10); }
    else if (a === "--wait-after-target-ms") {
      o.waitAfterTargetMs = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--port") { o.port = Number.parseInt(argv[++i], 10); }
    else if (a === "--query") { o.query = argv[++i]; }
    else if (a === "--route") { o.route = argv[++i] ?? ""; }
    else if (a === "--scenario-name") { o.scenarioName = argv[++i] ?? ""; }
    else if (a === "--start-route") { o.startRoute = argv[++i] ?? ""; }
    else if (a === "--start-scenario-name") { o.startScenarioName = argv[++i] ?? ""; }
    else if (a === "--smoke-routes") { o.smokeRoutes = true; }
    else if (a === "--smoke-route-chapters") { o.smokeRouteChapters = true; }
    else if (a === "--smoke-full-routes") { o.smokeFullRoutes = true; }
    else if (a === "--smoke-full-route") { o.smokeFullRoute = argv[++i] ?? ""; }
    else if (a === "--quick-save-load-smoke") { o.quickSaveLoadSmoke = true; }
    else if (a === "--quick-save-storage-failure-smoke") {
      o.quickSaveStorageFailureSmoke = true;
    }
    else if (a === "--cloud-state-smoke") {
      o.cloudStateSmoke = true;
    }
    else if (a === "--engine-manager-click-smoke") {
      o.engineManagerClickSmoke = true;
    }
    else if (a === "--advance") { o.advance = Number.parseInt(argv[++i], 10); }
    else if (a === "--advance-delay-ms") { o.advanceDelayMs = Number.parseInt(argv[++i], 10); }
    else if (a === "--wait-title") { o.waitTitle = true; }
    else if (a === "--click-title-menu") {
      o.clickTitleMenu = argv[++i] ?? "";
      o.clickTitleMenus.push(o.clickTitleMenu);
    }
    else if (a === "--open-title-scene") { o.openTitleScene = true; }
    else if (a === "--click-title-scene") {
      o.clickTitleScene = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--click-title-graphic") {
      o.clickTitleGraphic = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--click-title-graphic-button") {
      o.clickTitleGraphicButtons.push(argv[++i] ?? "");
    }
    else if (a === "--click-title-graphic-viewer") {
      o.clickTitleGraphicViewer = true;
    }
    else if (a === "--click-title-music") {
      o.clickTitleMusic = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--click-dialog-control") { o.clickDialogControl = argv[++i] ?? ""; }
    else if (a === "--seed-save-slot") { o.seedSaveSlot = Number.parseInt(argv[++i], 10); }
    else if (a === "--seed-dummy-save-slot") {
      o.seedDummySaveSlot = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--seed-title-clear") { o.seedTitleClear = argv[++i] ?? "iv"; }
    else if (a === "--seed-config-voice-off") {
      o.seedConfigVoiceOff = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--seed-upscale") {
      o.seedUpscale = true;
    }
    else if (a === "--seed-upscale-scale") {
      o.seedUpscale = true;
      o.seedUpscaleScale = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--seed-upscale-model") {
      o.seedUpscale = true;
      o.seedUpscaleModel = argv[++i] ?? "waifu2x";
    }
    else if (a === "--seed-upscale-mode") {
      o.seedUpscale = true;
      o.seedUpscaleMode = argv[++i] ?? "fast";
    }
    else if (a === "--press-left-ctrl") {
      o.pressLeftCtrl = true;
    }
    else if (a === "--save-load-advance") { o.saveLoadAdvance = Number.parseInt(argv[++i], 10); }
    else if (a === "--open-log-after-backlog") {
      o.openLogAfterBacklog = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--click-message-control") {
      const index = Number.parseInt(argv[++i], 10);
      o.clickMessageControl = index;
      o.clickMessageControls.push(index);
    }
    else if (a === "--click-userdata-slot") {
      o.clickUserDataSlot = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--click-userdata-control") {
      o.clickUserDataControl = argv[++i] ?? "";
    }
    else if (a === "--open-userdata") {
      o.openUserData = argv[++i] ?? "";
    }
    else if (a === "--click-config-control") {
      o.clickConfigControl = argv[++i] ?? "";
    }
    else if (a === "--log-wheel") {
      o.logWheel = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-until-choice") {
      o.advanceUntilChoice = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-until-event") {
      o.advanceUntilEvent = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-until-message-control") {
      o.advanceUntilMessageControl = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--message-control-count") {
      o.messageControlCount = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--message-control-opcode") {
      o.messageControlOpcode = Number(argv[++i]);
    }
    else if (a === "--advance-until-sprite-transition") {
      o.advanceUntilSpriteTransition = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--sprite-transition-opcode") {
      o.spriteTransitionOpcode = Number(argv[++i]);
    }
    else if (a === "--sprite-transition-count") {
      o.spriteTransitionCount = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--sprite-transition-event") {
      o.spriteTransitionEvent = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--sprite-transition-scenario") {
      o.spriteTransitionScenario = argv[++i];
    }
    else if (a === "--advance-until-sprite-motion") {
      o.advanceUntilSpriteMotion = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-until-control-motion") {
      o.advanceUntilControlMotion = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-after-control-motion") {
      o.advanceAfterControlMotion = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-until-scene-object") {
      o.advanceUntilSceneObject = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-after-scene-object") {
      o.advanceAfterSceneObject = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-after-scene-object-delay-ms") {
      o.advanceAfterSceneObjectDelayMs = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-until-scene-object-transition") {
      o.advanceUntilSceneObjectTransition = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--scene-object-transition-event") {
      o.sceneObjectTransitionEvent = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-after-scene-object-transition") {
      o.advanceAfterSceneObjectTransition = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-until-filter") {
      o.advanceUntilFilter = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-after-filter") {
      o.advanceAfterFilter = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-until-filter-clear") {
      o.advanceUntilFilterClear = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-after-filter-clear") {
      o.advanceAfterFilterClear = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-until-preset-shake") {
      o.advanceUntilPresetShake = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-until-sfx-control") {
      o.advanceUntilSfxControl = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--sfx-control-count") {
      o.sfxControlCount = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-after-sfx-control") {
      o.advanceAfterSfxControl = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-until-voice-channels") {
      o.advanceUntilVoiceChannels = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--voice-channel-count") {
      o.voiceChannelCount = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--advance-until-scenario") {
      o.advanceUntilScenario = Number.parseInt(argv[++i], 10);
    }
    else if (a === "--target-scenario") {
      o.targetScenario = argv[++i].toLowerCase();
    }
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
const url = `http://127.0.0.1:${opts.port}/${buildRuntimeQuery(opts)}`;

function buildRuntimeQuery(opts) {
  const params = new URLSearchParams(opts.query ?? "");
  if (opts.route) {
    params.set("route", opts.route);
  }
  if (opts.scenarioName) {
    params.set("scenarioPreview", "1");
    params.set("scenarioName", opts.scenarioName);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

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
  if (opts.seedUpscale) {
    const settings = normalizeUpscaleSettings({
      upscaleEnabled: true,
      upscaleScale: opts.seedUpscaleScale,
      upscaleModel: opts.seedUpscaleModel,
      upscaleQualityMode: opts.seedUpscaleMode,
    });
    await page.addInitScript(({ key, settings: seededSettings }) => {
      window.localStorage.setItem(key, JSON.stringify({ version: 1, settings: seededSettings }));
    }, { key: UPSCALE_SETTINGS_STORAGE_KEY, settings });
  }
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

  let seededDummySave = null;
  if (opts.seedDummySaveSlot >= 0) {
    seededDummySave = await seedDummySaveSlot(page, opts.seedDummySaveSlot);
  }
  let seededTitleClear = null;
  if (opts.seedTitleClear) {
    seededTitleClear = await seedTitleClear(page, opts.seedTitleClear);
  }
  let seededConfigVoiceOffResult = null;
  if (opts.seedConfigVoiceOff >= 0) {
    seededConfigVoiceOffResult = await seedConfigVoiceOff(page, opts.seedConfigVoiceOff);
  }

  let startedRoute = null;
  if (opts.startRoute) {
    startedRoute = await startScenarioRoute(page, opts.startRoute, opts.startScenarioName);
  }
  let routeSmoke = null;
  if (opts.smokeRoutes) {
    routeSmoke = await smokeRouteEndings(page, opts.timeoutMs, opts.advanceDelayMs);
  }
  let routeChapterSmoke = null;
  if (opts.smokeRouteChapters) {
    routeChapterSmoke = await smokeRouteChapters(page, opts.timeoutMs, opts.advanceDelayMs);
  }
  let fullRouteSmoke = null;
  if (opts.smokeFullRoutes || opts.smokeFullRoute) {
    fullRouteSmoke = await smokeFullRoutes(
      page,
      opts.timeoutMs,
      opts.advanceDelayMs,
      opts.smokeFullRoute,
    );
  }

  let openedTitleScene = null;
  let clickedTitleScene = null;
  let clickedTitleGraphic = null;
  let clickedTitleGraphicButtons = [];
  let clickedTitleGraphicViewerResult = null;
  let clickedTitleMusic = null;
  if (
    opts.waitTitle
    || opts.clickTitleMenus.length > 0
    || opts.openTitleScene
    || opts.clickTitleScene >= 0
    || opts.clickTitleGraphic >= 0
    || opts.clickTitleGraphicButtons.length > 0
    || opts.clickTitleGraphicViewer
    || opts.clickTitleMusic >= 0
  ) {
    await waitForTitle(page, opts.timeoutMs);
  }
  for (const titleMenu of opts.clickTitleMenus) {
    if (titleMenu) {
      await clickTitleMenu(page, titleMenu);
    }
  }
  if (opts.openTitleScene || opts.clickTitleScene >= 0) {
    openedTitleScene = await openTitleScene(page);
  }
  if (opts.clickTitleScene >= 0) {
    clickedTitleScene = await clickTitleScene(page, opts.clickTitleScene);
  }
  for (const action of opts.clickTitleGraphicButtons) {
    clickedTitleGraphicButtons.push(await clickTitleGraphicButton(page, action));
  }
  if (opts.clickTitleGraphic >= 0) {
    clickedTitleGraphic = await clickTitleGraphic(page, opts.clickTitleGraphic);
  }
  if (opts.clickTitleGraphicViewer) {
    clickedTitleGraphicViewerResult = await clickTitleGraphicViewer(page);
  }
  if (opts.clickTitleMusic >= 0) {
    clickedTitleMusic = await clickTitleMusic(page, opts.clickTitleMusic);
  }

  await advanceRuntime(page, opts.advance ?? 0, opts.advanceDelayMs);
  if (opts.advanceUntilEvent > 0) {
    await advanceUntilEvent(page, opts.advanceUntilEvent, opts.advanceDelayMs);
  }
  if (opts.advanceUntilChoice > 0) {
    await advanceUntilChoice(page, opts.advanceUntilChoice, opts.advanceDelayMs);
  }
  if (opts.advanceUntilMessageControl > 0) {
    await advanceUntilMessageControl(
      page,
      opts.advanceUntilMessageControl,
      opts.messageControlCount,
      opts.messageControlOpcode,
      opts.advanceDelayMs,
    );
  }
  if (opts.advanceUntilSpriteTransition > 0) {
    await advanceUntilSpriteTransition(
      page,
      opts.advanceUntilSpriteTransition,
      opts.spriteTransitionOpcode,
      opts.spriteTransitionCount,
      opts.spriteTransitionEvent,
      opts.spriteTransitionScenario,
      opts.advanceDelayMs,
    );
  }
  if (opts.advanceUntilSpriteMotion > 0) {
    await advanceUntilSpriteMotion(page, opts.advanceUntilSpriteMotion, opts.advanceDelayMs);
  }
  if (opts.advanceUntilControlMotion > 0) {
    await advanceUntilControlMotion(page, opts.advanceUntilControlMotion, opts.advanceDelayMs);
  }
  if (opts.advanceAfterControlMotion > 0) {
    await waitForStableScenario(page, opts.timeoutMs);
    await advanceRuntime(page, opts.advanceAfterControlMotion, opts.advanceDelayMs);
  }
  if (opts.advanceUntilSceneObject > 0) {
    await advanceUntilSceneObject(page, opts.advanceUntilSceneObject, opts.advanceDelayMs);
  }
  if (opts.advanceAfterSceneObject > 0) {
    await advanceRuntime(
      page,
      opts.advanceAfterSceneObject,
      opts.advanceAfterSceneObjectDelayMs || opts.advanceDelayMs,
    );
  }
  if (opts.advanceUntilSceneObjectTransition > 0) {
    await advanceUntilSceneObjectTransition(
      page,
      opts.advanceUntilSceneObjectTransition,
      opts.sceneObjectTransitionEvent,
      opts.advanceDelayMs,
    );
  }
  if (opts.advanceAfterSceneObjectTransition > 0) {
    await advanceRuntime(
      page,
      opts.advanceAfterSceneObjectTransition,
      opts.advanceDelayMs,
    );
  }
  if (opts.advanceUntilFilter > 0) {
    await advanceUntilFilter(page, opts.advanceUntilFilter, opts.advanceDelayMs);
  }
  if (opts.advanceAfterFilter > 0) {
    await advanceRuntime(page, opts.advanceAfterFilter, opts.advanceDelayMs);
  }
  if (opts.advanceUntilFilterClear > 0) {
    await advanceUntilFilterClear(page, opts.advanceUntilFilterClear, opts.advanceDelayMs);
  }
  if (opts.advanceAfterFilterClear > 0) {
    await advanceRuntime(page, opts.advanceAfterFilterClear, opts.advanceDelayMs);
  }
  if (opts.advanceUntilPresetShake > 0) {
    await advanceUntilPresetShake(page, opts.advanceUntilPresetShake, opts.advanceDelayMs);
  }
  if (opts.advanceUntilSfxControl > 0) {
    await advanceUntilSfxControl(
      page,
      opts.advanceUntilSfxControl,
      opts.sfxControlCount,
      opts.advanceDelayMs,
    );
  }
  if (opts.advanceAfterSfxControl > 0) {
    await advanceRuntime(page, opts.advanceAfterSfxControl, opts.advanceDelayMs);
  }
  if (opts.advanceUntilVoiceChannels > 0) {
    await advanceUntilVoiceChannels(
      page,
      opts.advanceUntilVoiceChannels,
      opts.voiceChannelCount,
      opts.advanceDelayMs,
    );
  }
  if (opts.advanceUntilScenario > 0) {
    await advanceUntilScenario(
      page,
      opts.advanceUntilScenario,
      opts.targetScenario,
      opts.advanceDelayMs,
    );
  }
  let seededSave = null;
  if (opts.seedSaveSlot >= 0) {
    seededSave = await seedSaveSlot(page, opts.seedSaveSlot, opts.timeoutMs);
  }
  if (opts.openLogAfterBacklog > 0) {
    await openLogAfterBacklog(
      page,
      opts.openLogAfterBacklog,
      opts.timeoutMs,
      opts.advanceDelayMs,
    );
    if (opts.logWheel !== 0) {
      await page.mouse.wheel(0, opts.logWheel * 100);
      await page.waitForTimeout(100);
    }
  }
  const messageControlClicks = opts.clickMessageControls.length > 0
    ? opts.clickMessageControls
    : (opts.clickMessageControl >= 0 ? [opts.clickMessageControl] : []);
  for (const controlIndex of messageControlClicks) {
    await waitForStableScenario(page, opts.timeoutMs);
    await clickMessageControl(page, controlIndex);
  }
  if (opts.openUserData) {
    await openUserDataWindow(page, opts.openUserData);
  }
  if (opts.clickUserDataSlot >= 0) {
    await clickUserDataSlot(page, opts.clickUserDataSlot);
  }
  if (opts.clickUserDataControl) {
    await clickUserDataControl(page, opts.clickUserDataControl);
  }
  if (opts.clickConfigControl) {
    await clickConfigControl(page, opts.clickConfigControl);
  }
  if (opts.clickDialogControl) {
    await clickDialogControl(page, opts.clickDialogControl);
  }
  let pressedLeftCtrl = null;
  if (opts.pressLeftCtrl) {
    await page.keyboard.press("ControlLeft");
    await page.waitForTimeout(120);
    pressedLeftCtrl = await page.evaluate(() => {
      const manager = document.querySelector(".engine-manager");
      const inst = window.__sakuraActiveInstall ?? null;
      return {
        managerPresent: manager !== null,
        managerOpen: manager !== null && manager.hidden !== true,
        activeTab: manager?.dataset?.activeTab ?? "",
        tabLabels: Array.from(manager?.querySelectorAll?.(".engine-manager__tab") ?? [])
          .map((button) => button.textContent ?? ""),
        scenarioConfigOpen: inst?.player?.configState?.open === true,
        safeConfigOpen: inst?.player?.safeState?.configOpen ?? 0,
      };
    });
  }
  let engineManagerClick = null;
  if (opts.engineManagerClickSmoke) {
    engineManagerClick = await runEngineManagerClickSmoke(page);
  }
  if (opts.waitAfterTargetMs > 0) {
    await page.waitForTimeout(opts.waitAfterTargetMs);
  }

  let saveLoad = null;
  if (opts.saveLoadAdvance > 0) {
    await waitForStableScenario(page, opts.timeoutMs);
    const before = await captureSaveLoadState(page);
    const save = await page.evaluate(() => window.sakuraSaveSession?.() ?? null);
    await advanceRuntime(page, opts.saveLoadAdvance, opts.advanceDelayMs);
    await waitForStableScenario(page, opts.timeoutMs);
    const advanced = await captureSaveLoadState(page);
    const load = await page.evaluate(async () => await window.sakuraLoadSession?.() ?? null);
    await waitForStableScenario(page, opts.timeoutMs);
    const restored = await captureSaveLoadState(page);
    await advanceRuntime(page, 1, opts.advanceDelayMs);
    await waitForStableScenario(page, opts.timeoutMs);
    const resumed = await captureSaveLoadState(page);
    saveLoad = {
      save,
      load,
      before,
      advanced,
      restored,
      resumed,
      restoredExactly: JSON.stringify(before) === JSON.stringify(restored),
      resumedForward: resumed?.event?.eventCount > restored?.event?.eventCount,
    };
  }
  let quickSaveLoad = null;
  if (opts.quickSaveLoadSmoke) {
    quickSaveLoad = await runQuickSaveLoadSmoke(page, opts);
  }
  let quickSaveStorageFailure = null;
  if (opts.quickSaveStorageFailureSmoke) {
    quickSaveStorageFailure = await runQuickSaveStorageFailureSmoke(page, opts);
  }
  let cloudState = null;
  if (opts.cloudStateSmoke) {
    cloudState = await runCloudStateSmoke(page);
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
    const imageSummary = (image) => image ? {
      width: image.width ?? 0,
      height: image.height ?? 0,
      logicalWidth: image.logicalWidth ?? image.width ?? 0,
      logicalHeight: image.logicalHeight ?? image.height ?? 0,
      upscaled: image.upscaled === true,
      upscaleScale: image.upscaleScale ?? 1,
    } : null;
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
      engineManager: (() => {
        const overlay = document.querySelector(".engine-manager");
        const status = overlay?.querySelector?.(".engine-manager__status") ?? null;
        return {
          present: overlay !== null,
          open: overlay !== null && overlay.hidden !== true,
          activeTab: overlay?.dataset?.activeTab ?? "",
          statusText: status?.textContent ?? "",
        };
      })(),
      hostVisual: inst ? {
        stage: inst.stage ?? "",
        backingScale: Number.parseInt(canvas?.dataset?.backingScale ?? "1", 10),
        titleImage: inst.titleImage ? imageSummary(inst.titleImage) : null,
        bootScreens: (inst.bootScreens ?? []).map((screen) => ({
          name: screen.name,
          image: imageSummary(screen.image),
        })),
        titleButtons: Object.fromEntries(
          Object.entries(inst.titleButtonSprites ?? {}).map(([name, sprite]) => [
            name,
            {
              image: imageSummary(sprite.image),
              stateWidth: sprite.stateWidth ?? 0,
              stateHeight: sprite.stateHeight ?? 0,
              sourceStateWidth: sprite.sourceStateWidth ?? 0,
              sourceStateHeight: sprite.sourceStateHeight ?? 0,
            },
          ]),
        ),
        titleMusicBackground: inst.titleMusicSprites?.background
          ? imageSummary(inst.titleMusicSprites.background)
          : null,
        messagePanel: inst.messageWindow?.panel ? imageSummary(inst.messageWindow.panel) : null,
        configBase: inst.configWindow?.base ? imageSummary(inst.configWindow.base) : null,
        dialogExit: inst.dialogWindow?.panels?.exit
          ? imageSummary(inst.dialogWindow.panels.exit)
          : null,
      } : null,
      graphRender: s?.graphRender ?? null,
      playerEvent: ev ? {
        kind: ev.kind,
        eventCount: ev.eventCount,
        opcode: ev.opcode,
        offset: ev.offset,
        intArgs: ev.intArgs ?? [],
        stringArgCount: ev.stringArgs?.length ?? ev.stringArgCount ?? 0,
        name: decode(ev.name),
        text: decode(ev.text),
        options: (ev.options ?? []).map(decode),
      } : null,
      scenarioAudio: inst?.player ? {
        assetReady: inst.player.safeState?.bgmAssetReady ?? 0,
        playResult: inst.player.safeState?.bgmPlayResult ?? 0,
        nameLength: inst.player.safeState?.bgmNameLength ?? 0,
        fadeMs: inst.player.safeState?.bgmFadeMs ?? 0,
        voiceAssetReady: inst.player.safeState?.voiceAssetReady ?? 0,
        voicePlayResult: inst.player.safeState?.voicePlayResult ?? 0,
        voiceNameLength: inst.player.safeState?.voiceNameLength ?? 0,
        voiceChannel: inst.player.safeState?.voiceChannel ?? 0,
        voiceCharacterIndex: inst.player.safeState?.voiceCharacterIndex ?? -1,
        voiceSuppressedByConfig: inst.player.safeState?.voiceSuppressedByConfig ?? 0,
        voiceControlOpcode: inst.player.safeState?.voiceControlOpcode ?? 0,
        voiceControlCount: inst.player.safeState?.voiceControlCount ?? 0,
        voiceWaitInterruptible: inst.player.safeState?.voiceWaitInterruptible ?? 0,
        sfxAssetReady: inst.player.safeState?.sfxAssetReady ?? 0,
        sfxPlayResult: inst.player.safeState?.sfxPlayResult ?? 0,
        sfxNameLength: inst.player.safeState?.sfxNameLength ?? 0,
        sfxPlayOpcode: inst.player.safeState?.sfxPlayOpcode ?? 0,
        sfxPan: inst.player.safeState?.sfxPan ?? 64,
        sfxControlOpcode: inst.player.safeState?.sfxControlOpcode ?? 0,
        sfxChannel: inst.player.safeState?.sfxChannel ?? 0,
        sfxFadeMs: inst.player.safeState?.sfxFadeMs ?? 0,
        sfxControlCount: inst.player.safeState?.sfxControlCount ?? 0,
        sfxWaitInterruptible: inst.player.safeState?.sfxWaitInterruptible ?? 0,
        loopSfxControlOpcode: inst.player.safeState?.loopSfxControlOpcode ?? 0,
        loopSfxFadeMs: inst.player.safeState?.loopSfxFadeMs ?? 0,
        loopSfxTargetVolume: inst.player.safeState?.loopSfxTargetVolume ?? 0,
        mixer: inst.audioMixer?.state?.() ?? null,
      } : null,
      scenarioVisual: inst?.player ? {
        backgroundName: inst.player.scene?.currentName ?? null,
        backgroundReady: Number(inst.player.scene?.current !== null),
        backgroundUpscaled: inst.player.scene?.current?.upscaled === true,
        backgroundUpscaleScale: inst.player.scene?.current?.upscaleScale ?? 1,
        backgroundWidth: inst.player.scene?.current?.width ?? 0,
        backgroundHeight: inst.player.scene?.current?.height ?? 0,
        backgroundLogicalWidth: inst.player.scene?.current?.logicalWidth ?? 0,
        backgroundLogicalHeight: inst.player.scene?.current?.logicalHeight ?? 0,
        shakeMs: inst.player.safeState?.sceneShakeMs ?? 0,
        shakeAmplitudeX: inst.player.safeState?.sceneShakeAmplitudeX ?? 0,
        shakeAmplitudeY: inst.player.safeState?.sceneShakeAmplitudeY ?? 0,
        shakeUpdateCount: inst.player.safeState?.sceneShakeUpdateCount ?? 0,
        presetShakeCount: inst.player.safeState?.scenePresetShakeCount ?? 0,
        shakeDirection: inst.player.safeState?.sceneShakeDirection ?? 0,
        shakeStrengthIndex: inst.player.safeState?.sceneShakeStrengthIndex ?? 0,
        shakePeriodMs: inst.player.safeState?.sceneShakePeriodMs ?? 0,
        shakeCycles: inst.player.safeState?.sceneShakeCycles ?? 0,
        shakeDecayPercent: inst.player.safeState?.sceneShakeDecayPercent ?? 0,
        shake: inst.player.scene?.shake ? { ...inst.player.scene.shake } : null,
        apertureCount: inst.player.safeState?.sceneApertureCount ?? 0,
        apertureDurationMs: inst.player.safeState?.sceneApertureDurationMs ?? 0,
        aperture: inst.player.scene?.aperture ? {
          current: inst.player.scene.aperture.current
            ? { ...inst.player.scene.aperture.current }
            : null,
          pending: inst.player.scene.aperture.pending
            ? { ...inst.player.scene.aperture.pending }
            : null,
          from: inst.player.scene.aperture.from
            ? { ...inst.player.scene.aperture.from }
            : null,
          to: inst.player.scene.aperture.to
            ? { ...inst.player.scene.aperture.to }
            : null,
          progress: inst.player.scene.aperture.progress ?? 1,
          transitioning: inst.player.scene.aperture.transitioning === true,
        } : null,
        rainCount: inst.player.safeState?.sceneRainCount ?? 0,
        rainActive: inst.player.safeState?.sceneRainActive ?? 0,
        rainDensity: inst.player.safeState?.sceneRainDensity ?? 0,
        rainSpeed: inst.player.safeState?.sceneRainSpeed ?? 0,
        rainAngle: inst.player.safeState?.sceneRainAngle ?? 0,
        rainAlpha: inst.player.safeState?.sceneRainAlpha ?? 0,
        rain: inst.player.scene?.rain
          ? {
              active: inst.player.scene.rain.active === true,
              alpha: inst.player.scene.rain.alpha,
              angleDeg: inst.player.scene.rain.angleDeg,
              density: inst.player.scene.rain.density,
              fadeMs: inst.player.scene.rain.fadeMs,
              red: inst.player.scene.rain.red,
              green: inst.player.scene.rain.green,
              blue: inst.player.scene.rain.blue,
              speed: inst.player.scene.rain.speed,
            }
          : null,
        effectMs: inst.player.safeState?.sceneEffectMs ?? 0,
        effectNameLength: inst.player.safeState?.sceneEffectNameLength ?? 0,
        bankSpriteMs: inst.player.safeState?.sceneBankSpriteMs ?? 0,
        bankSpriteNameLength: inst.player.safeState?.sceneBankSpriteNameLength ?? 0,
        bankSpriteTerminations: inst.player.safeState?.sceneBankSpriteTerminations ?? 0,
        transitionMapReady: inst.player.safeState?.sceneTransitionMapReady ?? 0,
        transitionMapNameLength:
          inst.player.safeState?.sceneTransitionMapNameLength ?? 0,
        activeTransitionMapName: inst.player.scene?.transitionMapName ?? null,
        spriteSlot: inst.player.safeState?.sceneSpriteSlot ?? 0,
        spriteCount: inst.player.safeState?.sceneSpriteCount ?? 0,
        spriteTransitions: inst.player.safeState?.sceneSpriteTransitions ?? 0,
        spriteMotionCount: inst.player.safeState?.sceneSpriteMotionCount ?? 0,
        sceneObjectId: inst.player.safeState?.sceneObjectId ?? 0,
        sceneObjectCount: inst.player.safeState?.sceneObjectCount ?? 0,
        sceneObjectAssetReady: inst.player.safeState?.sceneObjectAssetReady ?? 0,
        sceneObjectEventCount: inst.player.safeState?.sceneObjectEventCount ?? 0,
        sceneObjectControlOpcode:
          inst.player.safeState?.sceneObjectControlOpcode ?? 0,
        sceneObjectControlCount:
          inst.player.safeState?.sceneObjectControlCount ?? 0,
        sceneObjectControlId:
          inst.player.safeState?.sceneObjectControlId ?? -1,
        sceneObjectControlAffected:
          inst.player.safeState?.sceneObjectControlAffected ?? 0,
        sceneObjectMotionCount:
          inst.player.scene?.sprites?.sceneObjectMotions?.size
            ?? inst.player.safeState?.sceneObjectMotionCount
            ?? 0,
        movieCount: inst.player.safeState?.sceneMovieCount ?? 0,
        movieArchiveNameLength:
          inst.player.safeState?.sceneMovieArchiveNameLength ?? 0,
        movieFrameRate: inst.player.safeState?.sceneMovieFrameRate ?? 0,
        movies: [...(
          inst.player.scene?.movies?.objects?.values?.() ?? []
        )].map((movie) => {
          const movieContext = movie.canvas?.getContext?.(
            "2d",
            { willReadFrequently: true },
          ) ?? null;
          const pixels = movieContext
            ? movieContext.getImageData(
                0,
                0,
                movie.canvas.width,
                movie.canvas.height,
              ).data
            : null;
          let yMin = 255;
          let yMax = 0;
          if (pixels) {
            const step = Math.max(4, Math.floor(pixels.length / 4096 / 4) * 4);
            for (let index = 0; index < pixels.length; index += step) {
              const y = (
                pixels[index] * 77
                + pixels[index + 1] * 150
                + pixels[index + 2] * 29
              ) >> 8;
              yMin = Math.min(yMin, y);
              yMax = Math.max(yMax, y);
            }
          }
          return {
            id: movie.id,
            frameRate: movie.frameRate,
            decodedFrames: movie.decodedFrames,
            decoderFrame: inst.player.scene.movies.core
              ?.movieDecoderDecodedFrames?.(movie.decoderHandle) ?? 0,
            yMin: pixels ? yMin : null,
            yMax: pixels ? yMax : null,
            center: movieContext
              ? Array.from(movieContext.getImageData(
                  movie.canvas.width >> 1,
                  movie.canvas.height >> 1,
                  1,
                  1,
                ).data)
              : null,
          };
        }),
        filterCount: inst.player.safeState?.sceneFilterCount ?? 0,
        filterDurationMs: inst.player.safeState?.sceneFilterDurationMs ?? 0,
        filterMode: inst.player.safeState?.sceneFilterMode ?? 0,
        filterStrength: inst.player.safeState?.sceneFilterStrength ?? 0,
        filter: inst.player.scene?.filter
          ? {
              current: inst.player.scene.filter.current
                ? { ...inst.player.scene.filter.current }
                : null,
              transition: inst.player.scene.filter.transition
                ? { ...inst.player.scene.filter.transition }
                : null,
            }
          : null,
        sceneObjectTransitions: [...(
          inst.player.scene?.sprites?.sceneObjectTransitions?.values?.() ?? []
        )].map((transition) => ({
          type: transition.type,
          id: transition.id,
          durationMs: transition.durationMs,
          blocking: transition.blocking,
          elapsedMs: performance.now() - transition.startedAt,
          from: { ...transition.from },
          to: { ...transition.to },
        })),
        sceneObjects: [...(
          inst.player.scene?.sprites?.sceneObjects?.values?.() ?? []
        )].map((object) => {
          const animation = object.animation;
          const motion = inst.player.scene.sprites.sceneObjectMotions
            ?.get(object.id) ?? null;
          const elapsedMs = animation ? performance.now() - animation.startedAt : 0;
          const transition = inst.player.scene.sprites.sceneObjectTransitions
            ?.get(object.id) ?? null;
          const progress = transition
            ? Math.max(
                0,
                Math.min(1, (performance.now() - transition.startedAt) / transition.durationMs),
              )
            : 0;
          const value = (field) => transition
            ? transition.from[field]
              + (transition.to[field] - transition.from[field]) * progress
            : object[field];
          return {
            id: object.id,
            assetName: object.assetName,
            priority: object.priority,
            blendMode: object.blendMode,
            isMovie: object.isMovie === true,
            maskAssetName: object.maskAssetName ?? "",
            hasMaskImage: object.maskImage ? true : false,
            x: value("x"),
            y: value("y"),
            z: value("z"),
            anchorX: object.anchorX,
            anchorY: object.anchorY,
            alpha: value("alpha"),
            frameCount: animation?.frameCount ?? 1,
            frameIntervalMs: animation?.frameIntervalMs ?? 0,
            sequenceStyle: animation?.sequenceStyle ?? -1,
            frameIndex: animation
              ? Math.floor(elapsedMs / animation.frameIntervalMs) % animation.frameCount
              : 0,
            motion: motion
              ? {
                  amplitudeX: motion.amplitudeX ?? 0,
                  amplitudeY: motion.amplitudeY ?? 0,
                  directionMode: motion.directionMode ?? null,
                  periodMs: motion.periodMs,
                  phase: motion.phase ?? 0,
                  speed: motion.speed ?? null,
                }
              : null,
          };
        }),
        spriteTransitions: [...(
          inst.player.scene?.sprites?.transitions?.values?.() ?? []
        )].map((transition) => {
          const elapsedMs = performance.now() - transition.startedAt;
          return {
            slot: transition.slot,
            opcode: transition.opcode,
            eventCount: transition.eventCount,
            durationMs: transition.durationMs,
            elapsedMs,
            mapAssetName: transition.mapAssetName ?? "",
            progress: Math.max(0, Math.min(1, elapsedMs / transition.durationMs)),
            blocking: transition.blocking,
            remove: transition.remove,
            from: transition.from
              ? {
                  assetName: transition.from.assetName,
                  alpha: transition.from.alpha,
                  order: transition.from.order,
                  priority: transition.from.priority,
                  x: transition.from.x,
                  y: transition.from.y,
                  z: transition.from.z,
                }
              : null,
            to: transition.to
              ? {
                  assetName: transition.to.assetName,
                  alpha: transition.to.alpha,
                  order: transition.to.order,
                  priority: transition.to.priority,
                  x: transition.to.x,
                  y: transition.to.y,
                  z: transition.to.z,
                }
              : null,
          };
        }),
        spriteLayers: [...(
          inst.player.scene?.sprites?.presentedLayers?.values?.()
          ?? inst.player.scene?.sprites?.layers?.values?.()
          ?? []
        )].map(
          (layer) => ({
            slot: layer.slot,
            assetName: layer.assetName,
            alpha: layer.alpha,
            order: layer.order,
            priority: layer.priority,
            imageWidth: layer.image?.width ?? 0,
            imageHeight: layer.image?.height ?? 0,
            imageFirstPixel: layer.image?.pixels
              ? Array.from(layer.image.pixels.slice(0, 4))
              : null,
            x: layer.x,
            y: layer.y,
            z: layer.z,
          }),
        ),
        controlMotions: [...(
          inst.player.scene?.sprites?.controlMotions?.values?.() ?? []
        )].map((motion) => ({
          spriteId: motion.spriteId,
          slot: motion.slot,
          repeatCount: motion.repeatCount,
          startedAt: motion.startedAt,
          elements: motion.elements,
        })),
      } : null,
      scenarioFlow: inst?.player ? {
        name: inst.player.safeState?.scenarioName ?? "",
        route: inst.player.safeState?.scenarioRoute ?? "",
        index: inst.player.safeState?.scenarioIndex ?? 0,
        count: inst.player.safeState?.scenarioCount ?? 0,
        transitions: inst.player.safeState?.scenarioTransitions ?? 0,
        loading: inst.player.scenarioLoading === true,
        autoMode: inst.player.safeState?.autoMode ?? 0,
        skipMode: inst.player.safeState?.skipMode ?? 0,
        autoAdvanceDelayMs: inst.player.autoAdvanceDelayMs ?? 0,
      } : null,
      scenarioMessageWindow: inst?.player ? (() => {
        const visual = inst.player.messageVisual ?? null;
        const transition = visual?.transition ?? null;
        const elapsedMs = transition ? performance.now() - transition.startedAt : 0;
        const progress = transition
          ? Math.max(0, Math.min(1, elapsedMs / transition.durationMs))
          : 0;
        return {
          visibleKind: visual?.event?.kind ?? 0,
          visibleEventCount: visual?.event?.eventCount ?? 0,
          opacity: transition
            ? transition.fromOpacity
              + (transition.toOpacity - transition.fromOpacity) * progress
            : visual?.opacity ?? 0,
          transitioning: transition !== null,
          durationMs: transition?.durationMs ?? 0,
          controlOpcode: inst.player.safeState?.messageControlOpcode ?? 0,
          controlDurationMs: inst.player.safeState?.messageControlDurationMs ?? 0,
          controlVisible: inst.player.safeState?.messageControlVisible ?? 0,
          controlCount: inst.player.safeState?.messageControlCount ?? 0,
          hidden: inst.player.safeState?.messageWindowHidden ?? 0,
          clickIndex: inst.player.safeState?.messageControlClickIndex ?? -1,
          clickName: inst.player.safeState?.messageControlClickName ?? "",
          clickResult: inst.player.safeState?.messageControlClickResult ?? "",
          clickOk: inst.player.safeState?.messageControlClickOk ?? 0,
        };
      })() : null,
      scenarioBacklog: inst?.player ? {
        open: inst.player.backlogState?.open === true,
        firstIndex: inst.player.backlogState?.firstIndex ?? 0,
        entryCount: inst.player.backlog?.length ?? 0,
        visible: (inst.player.backlog ?? [])
          .slice(
            inst.player.backlogState?.firstIndex ?? 0,
            (inst.player.backlogState?.firstIndex ?? 0) + 4,
          )
          .map((entry) => ({
            eventCount: entry.eventCount,
            name: entry.name,
            text: entry.text,
            voiceName: entry.voiceName ?? null,
          })),
      } : null,
      scenarioUserData: inst?.player ? {
        open: inst.player.userDataState?.open === true,
        mode: inst.player.userDataState?.mode ?? "",
        page: inst.player.userDataState?.page ?? 0,
        selectedSlot: inst.player.userDataState?.selectedSlot ?? 0,
        hover: inst.player.userDataState?.hover ?? null,
        safeOpen: inst.player.safeState?.userDataOpen ?? 0,
        safeMode: inst.player.safeState?.userDataMode ?? "",
        safePage: inst.player.safeState?.userDataPage ?? 0,
        safeSelectedSlot: inst.player.safeState?.userDataSelectedSlot ?? 0,
        lastResult: inst.player.safeState?.userDataLastResult ?? "",
        lastOk: inst.player.safeState?.userDataLastOk ?? 0,
        lastSaveSlot: inst.player.safeState?.lastSaveSlot ?? 0,
        lastLoadSlot: inst.player.safeState?.lastLoadSlot ?? 0,
        pendingDialogKind: inst.player.safeState?.userDataPendingDialogKind ?? "",
        pendingDialogSource: inst.player.safeState?.userDataPendingDialogSource ?? "",
        pendingDialogSlot: inst.player.safeState?.userDataPendingDialogSlot ?? -1,
      } : null,
      titleConfig: inst ? {
        stage: inst.stage ?? "",
        menuMode: inst.titleMenuMode ?? "main",
        menuControls: typeof window.sakuraTitleMenuControls === "function"
          ? window.sakuraTitleMenuControls().map((control) => ({
              label: control.label,
              action: control.action,
              routeId: control.routeId,
              x: control.x,
              y: control.y,
              enabled: control.enabled,
            }))
          : [],
        menuHoverIndex: inst.hoverIndex ?? -1,
        menuLastAction: inst.titleLastAction ?? "",
        open: inst.titleConfigState?.open === true,
        hover: inst.titleConfigState?.hover ?? null,
        lastAction: inst.titleConfigState?.lastAction ?? "",
        textSpeed: Math.round((inst.titleConfigState?.settings?.textSpeed ?? 0) * 100),
        autoSpeed: Math.round((inst.titleConfigState?.settings?.autoSpeed ?? 0) * 100),
        windowOpacity: Math.round((inst.titleConfigState?.settings?.windowOpacity ?? 0) * 100),
        masterVolume: Math.round((inst.titleConfigState?.settings?.masterVolume ?? 0) * 100),
        bgmVolume: Math.round((inst.titleConfigState?.settings?.bgmVolume ?? 0) * 100),
        sfxVolume: Math.round((inst.titleConfigState?.settings?.sfxVolume ?? 0) * 100),
        voiceVolume: Math.round((inst.titleConfigState?.settings?.voiceVolume ?? 0) * 100),
        screenMode: inst.titleConfigState?.settings?.screenMode ?? "",
        screenModeOk: inst.titleConfigScreenModeOk ?? 0,
        screenModeResult: inst.titleConfigScreenModeResult ?? "",
      } : null,
      titleClear: (() => {
        try {
          const encoded = window.localStorage?.getItem("sakura.title.clear.v1");
          const parsed = encoded ? JSON.parse(encoded) : null;
          const routes = parsed?.routes && typeof parsed.routes === "object"
            ? Object.keys(parsed.routes).sort()
            : [];
          return {
            version: parsed?.version ?? 0,
            routeCount: routes.length,
            routes,
          };
        } catch {
          return { version: 0, routeCount: 0, routes: [] };
        }
      })(),
      titleUserData: inst ? {
        stage: inst.stage ?? "",
        menuHoverIndex: inst.hoverIndex ?? -1,
        menuLastAction: inst.titleLastAction ?? "",
        open: inst.titleUserDataState?.open === true,
        mode: inst.titleUserDataState?.mode ?? "",
        page: inst.titleUserDataState?.page ?? 0,
        selectedSlot: inst.titleUserDataState?.selectedSlot ?? 0,
        hover: inst.titleUserDataState?.hover ?? null,
        lastResult: inst.titleUserDataLastResult ?? "",
        lastOk: inst.titleUserDataLastOk ?? 0,
        pendingDialogKind: inst.pendingDialogAction?.kind ?? "",
        pendingDialogSource: inst.pendingDialogAction?.source ?? "",
        pendingDialogSlot: inst.pendingDialogAction?.slot ?? -1,
      } : null,
      titleScene: inst ? (() => {
        const sceneChoices = typeof window.sakuraTitleSceneChoices === "function"
          ? window.sakuraTitleSceneChoices()
          : [];
        return {
        stage: inst.stage ?? "",
        menuHoverIndex: inst.hoverIndex ?? -1,
        menuLastAction: inst.titleLastAction ?? "",
        open: inst.titleSceneState?.open === true,
        hoverIndex: inst.titleSceneState?.hoverIndex ?? -1,
        lastAction: inst.titleSceneState?.lastAction ?? "",
        selectedRoute: inst.titleSceneState?.selectedRoute ?? "",
        selectedScenarioName: inst.titleSceneState?.selectedScenarioName ?? "",
        selectedReplayId: inst.titleSceneState?.selectedReplayId ?? 0,
        selectedThumbnailAssetName: inst.titleSceneState?.selectedThumbnailAssetName ?? "",
        choiceCount: sceneChoices.length,
        thumbnailLoadedCount: inst.titleSceneImageCache instanceof Map
          ? Array.from(inst.titleSceneImageCache.values()).filter((entry) => entry?.status === "ready").length
          : 0,
        firstScenarioName: sceneChoices[0]?.scenarioName ?? "",
        lastScenarioName: sceneChoices.at(-1)?.scenarioName ?? "",
        firstThumbnailAssetName: sceneChoices[0]?.thumbnailAssetName ?? "",
        lastThumbnailAssetName: sceneChoices.at(-1)?.thumbnailAssetName ?? "",
        };
      })() : null,
      titleGraphic: inst ? (() => {
        const allAssets = Array.isArray(inst.titleGraphicAssetsCache?.assets)
          ? inst.titleGraphicAssetsCache.assets
          : [];
        const visibleAssets = typeof window.sakuraTitleGraphicAssets === "function"
          ? window.sakuraTitleGraphicAssets()
          : [];
        return {
        stage: inst.stage ?? "",
        menuHoverIndex: inst.hoverIndex ?? -1,
        menuLastAction: inst.titleLastAction ?? "",
        open: inst.titleGraphicState?.open === true,
        page: inst.titleGraphicState?.page ?? 0,
        hoverIndex: inst.titleGraphicState?.hoverIndex ?? -1,
        selectedIndex: inst.titleGraphicState?.selectedIndex ?? -1,
        selectedAssetName: inst.titleGraphicState?.selectedAssetName ?? "",
        viewerOpen: inst.titleGraphicState?.viewerOpen === true,
        viewerAssetName: inst.titleGraphicState?.viewerAssetName ?? "",
        viewerLoadOk: inst.titleGraphicState?.viewerLoadOk ?? 0,
        viewerLoadReason: inst.titleGraphicState?.viewerLoadReason ?? "",
        lastAction: inst.titleGraphicState?.lastAction ?? "",
        lastLoadOk: inst.titleGraphicState?.lastLoadOk ?? 0,
        lastLoadReason: inst.titleGraphicState?.lastLoadReason ?? "",
        assetCount: allAssets.length,
        pageCount: Math.max(1, Math.ceil(allAssets.length / 8)),
        visibleCount: visibleAssets.length,
        unlockedCount: allAssets.filter((asset) => asset?.unlocked !== false).length,
        lockedCount: allAssets.filter((asset) => asset?.locked === true).length,
        visibleUnlockedCount: visibleAssets.filter((asset) => asset?.unlocked !== false).length,
        visibleLockedCount: visibleAssets.filter((asset) => asset?.locked === true).length,
        loadedCount: inst.titleGraphicImageCache instanceof Map
          ? Array.from(inst.titleGraphicImageCache.values()).filter((entry) => entry?.status === "ready").length
          : 0,
        chromeLoadedCount: inst.titleGraphicChromeCache instanceof Map
          ? Array.from(inst.titleGraphicChromeCache.values()).filter((entry) => entry?.status === "ready").length
          : 0,
        };
      })() : null,
      titleMusic: inst ? {
        stage: inst.stage ?? "",
        menuHoverIndex: inst.hoverIndex ?? -1,
        menuLastAction: inst.titleLastAction ?? "",
        open: inst.titleMusicState?.open === true,
        page: inst.titleMusicState?.page ?? 0,
        hoverIndex: inst.titleMusicState?.hoverIndex ?? -1,
        selectedIndex: inst.titleMusicState?.selectedIndex ?? -1,
        selectedAssetName: inst.titleMusicState?.selectedAssetName ?? "",
        lastAction: inst.titleMusicState?.lastAction ?? "",
        lastPlayOk: inst.titleMusicState?.lastPlayOk ?? 0,
        lastPlayReason: inst.titleMusicState?.lastPlayReason ?? "",
        visibleCount: typeof window.sakuraTitleMusicTracks === "function"
          ? window.sakuraTitleMusicTracks().length
          : 0,
      } : null,
      dialog: inst ? {
        stage: inst.stage ?? "",
        open: inst.dialogState?.open === true,
        kind: inst.dialogState?.kind ?? "",
        source: inst.dialogState?.source ?? "",
        hover: inst.dialogState?.hover ?? null,
        lastAction: inst.dialogState?.lastAction ?? "",
        result: inst.dialogState?.result ?? "",
        menuLastAction: inst.titleLastAction ?? "",
      } : null,
      scenarioConfig: inst?.player ? {
        open: inst.player.configState?.open === true,
        hover: inst.player.configState?.hover ?? null,
        lastAction: inst.player.configState?.lastAction ?? "",
        safeOpen: inst.player.safeState?.configOpen ?? 0,
        safeHover: inst.player.safeState?.configHover ?? "",
        safeLastAction: inst.player.safeState?.configLastAction ?? "",
        textSpeed: inst.player.safeState?.configTextSpeed ?? 0,
        autoSpeed: inst.player.safeState?.configAutoSpeed ?? 0,
        windowOpacity: inst.player.safeState?.configWindowOpacity ?? 0,
        masterVolume: inst.player.safeState?.configMasterVolume ?? 0,
        bgmVolume: inst.player.safeState?.configBgmVolume ?? 0,
        sfxVolume: inst.player.safeState?.configSfxVolume ?? 0,
        voiceVolume: inst.player.safeState?.configVoiceVolume ?? 0,
        screenModeFullscreen: inst.player.safeState?.configScreenModeFullscreen ?? 0,
        screenModeApplied: inst.player.safeState?.configScreenModeApplied ?? 0,
        screenModeReasonLength: inst.player.safeState?.configScreenModeReasonLength ?? 0,
        characterVoices: Array.isArray(inst.player.configState?.settings?.characterVoices)
          ? inst.player.configState.settings.characterVoices.slice(0, 8)
          : [],
      } : null,
      graphHistory: hq ? { ready: hq.ready, recorded: hq.recorded, count: (hq.events ?? []).length, events: (hq.events ?? []).map(slim) } : null,
      canvas: canvas ? {
        width: canvas.width, height: canvas.height,
        center: sample(canvas.width >> 1, canvas.height >> 1),
        edgeTopLeft: sample(0, 0),
        edgeTop: sample(canvas.width >> 1, 0),
        edgeRight: sample(Math.max(0, canvas.width - 1), canvas.height >> 1),
        edgeBottom: sample(canvas.width >> 1, Math.max(0, canvas.height - 1)),
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

  const result = {
    ready,
    asyncErrorStage: stage,
    state,
    saveLoad,
    quickSaveLoad,
    quickSaveStorageFailure,
    cloudState,
    seededSave,
    seededDummySave,
    seededTitleClear,
    seededConfigVoiceOff: seededConfigVoiceOffResult,
    startedRoute,
    openedTitleScene,
    clickedTitleScene,
    clickedTitleGraphic,
    clickedTitleGraphicButtons,
    clickedTitleGraphicViewer: clickedTitleGraphicViewerResult,
    clickedTitleMusic,
    pressedLeftCtrl,
    engineManagerClick,
    routeSmoke,
    routeChapterSmoke,
    fullRouteSmoke,
    console: consoleLines.slice(-60),
  };
  if (opts.png) await page.screenshot({ path: opts.png });
  if (opts.moviePng) {
    const moviePng = await page.evaluate(() => {
      const movies = window.__sakuraActiveInstall?.player?.scene?.movies?.objects;
      const canvas = movies?.values?.().next?.().value?.canvas ?? null;
      return canvas?.toDataURL?.("image/png") ?? null;
    });
    if (typeof moviePng !== "string" || !moviePng.startsWith("data:image/png;base64,")) {
      throw new Error("active scenario movie canvas is unavailable");
    }
    await writeFile(opts.moviePng, Buffer.from(moviePng.split(",", 2)[1], "base64"));
  }
  if (opts.json) await writeFile(opts.json, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ready, asyncErrorStage: stage, canvas: state.canvas, dataset: pickDataset(state.dataset), runtimeError: state.runtimeError }));
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill("SIGTERM");
}

async function advanceRuntime(page, count, delayMs) {
  for (let index = 0; index < count; index += 1) {
    await page.evaluate(() => {
      const scenarioPreview = new URLSearchParams(window.location.search)
        .get("scenarioPreview") === "1";
      if (scenarioPreview) {
        window.sakuraAdvanceScenario?.();
      } else if (!window.sakuraAdvanceBoot?.()) {
        window.sakuraAdvanceScenario?.();
      }
    });
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function waitForTitle(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stage = await page.evaluate(() => window.__sakuraActiveInstall?.stage ?? "");
    if (stage === "title") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("title stage did not become ready");
}

async function clickTitleMenu(page, itemName) {
  const point = await page.evaluate((name) => {
    const canvas = document.getElementById("stage");
    const inst = window.__sakuraActiveInstall ?? null;
    const image = inst?.titleImage ?? null;
    if (!canvas || inst?.stage !== "title" || !image) {
      return null;
    }
    const controls = typeof window.sakuraTitleMenuControls === "function"
      ? window.sakuraTitleMenuControls()
      : [];
    const numeric = Number.parseInt(String(name), 10);
    if (controls.length > 0) {
      const wanted = String(name).toLowerCase();
      const index = Number.isInteger(numeric) && String(numeric) === String(name).trim()
        ? numeric
        : controls.findIndex((control) => String(control.label).toLowerCase() === wanted
          || String(control.action).toLowerCase() === wanted
          || String(control.routeId).toLowerCase() === wanted);
      const control = controls[index] ?? null;
      if (!control) {
        return null;
      }
      const sprite = inst.titleButtonSprites?.[control.label] ?? null;
      const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
      const w = Math.round(image.width * scale);
      const h = Math.round(image.height * scale);
      const x = Math.floor((canvas.width - w) / 2);
      const y = Math.floor((canvas.height - h) / 2);
      const rect = canvas.getBoundingClientRect();
      const width = (sprite?.stateWidth ?? 114) * scale;
      const height = (sprite?.stateHeight ?? 64) * scale;
      return {
        clientX: rect.left + (x + (control.x * scale) + (width / 2)) * rect.width / canvas.width,
        clientY: rect.top + (y + (control.y * scale) + (height / 2)) * rect.height / canvas.height,
      };
    }
    const labels = ["start", "load", "config", "exit"];
    const index = Number.isInteger(numeric) && String(numeric) === String(name).trim()
      ? numeric
      : labels.indexOf(String(name).toLowerCase());
    if (index < 0 || index >= labels.length) {
      return null;
    }
    const titleMenuX = [0.224, 0.405, 0.588, 0.768];
    const titleMenuY = 0.812;
    const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
    const w = Math.round(image.width * scale);
    const h = Math.round(image.height * scale);
    const x = Math.floor((canvas.width - w) / 2);
    const y = Math.floor((canvas.height - h) / 2);
    const rect = canvas.getBoundingClientRect();
    return {
      clientX: rect.left + (x + w * titleMenuX[index]) * rect.width / canvas.width,
      clientY: rect.top + (y + h * titleMenuY) * rect.height / canvas.height,
    };
  }, itemName);
  if (!point) {
    throw new Error(`title menu ${itemName} is not clickable`);
  }
  await page.mouse.click(point.clientX, point.clientY);
  await page.waitForTimeout(150);
}

async function openTitleScene(page) {
  const result = await page.evaluate(() => {
    if (typeof window.sakuraOpenTitleSceneSelect !== "function") {
      return { ok: false, reason: "api_missing" };
    }
    return window.sakuraOpenTitleSceneSelect();
  });
  if (!result?.ok) {
    throw new Error(`open title scene failed: ${result?.reason ?? "unknown"}`);
  }
  await page.waitForTimeout(100);
  return result;
}

async function clickTitleScene(page, index) {
  const result = await page.evaluate(async (sceneIndex) => {
    if (typeof window.sakuraSelectTitleScene !== "function") {
      return { ok: false, reason: "api_missing" };
    }
    return await window.sakuraSelectTitleScene(sceneIndex);
  }, index);
  if (!result?.ok) {
    throw new Error(`click title scene ${index} failed: ${result?.reason ?? "unknown"}`);
  }
  await page.waitForTimeout(150);
  return result;
}

async function clickTitleGraphic(page, index) {
  const result = await page.evaluate(async (graphicIndex) => {
    if (typeof window.sakuraSelectTitleGraphic !== "function") {
      return { ok: false, reason: "api_missing" };
    }
    return await window.sakuraSelectTitleGraphic(graphicIndex);
  }, index);
  if (!result?.ok || result?.assetReady !== 1) {
    throw new Error(`click title graphic ${index} failed: ${result?.reason ?? "unknown"}`);
  }
  await page.waitForTimeout(150);
  return result;
}

async function clickTitleGraphicButton(page, action) {
  const normalized = String(action ?? "").trim().toLowerCase();
  const aliases = new Map([
    ["prev", "previous"],
    ["previous", "previous"],
    ["next", "next"],
    ["top", "top"],
    ["first", "top"],
    ["last", "last"],
    ["back", "back"],
  ]);
  const button = aliases.get(normalized);
  const centers = {
    previous: [36 + 69.5, 650 + 21.5],
    next: [36 + 148 + 69.5, 650 + 21.5],
    top: [36 + (148 * 2) + 69.5, 650 + 21.5],
    last: [36 + (148 * 3) + 69.5, 650 + 21.5],
    back: [36 + (148 * 4) + 69.5, 650 + 21.5],
  };
  if (!button) {
    throw new Error(`unknown title graphic button ${action}`);
  }
  await clickStagePoint(page, centers[button][0], centers[button][1]);
  await page.waitForTimeout(180);
  const result = await page.evaluate((clickedAction) => {
    const state = window.__sakuraActiveInstall?.titleGraphicState ?? null;
    return {
      action: clickedAction,
      open: state?.open === true,
      page: state?.page ?? -1,
      viewerOpen: state?.viewerOpen === true,
      lastAction: state?.lastAction ?? "",
      menuLastAction: window.__sakuraActiveInstall?.titleLastAction ?? "",
    };
  }, button);
  if (button !== "back" && result.open !== true) {
    throw new Error(`title graphic button ${button} unexpectedly closed the gallery`);
  }
  return result;
}

async function clickTitleGraphicViewer(page) {
  const before = await page.evaluate(() => {
    const state = window.__sakuraActiveInstall?.titleGraphicState ?? null;
    return {
      open: state?.open === true,
      viewerOpen: state?.viewerOpen === true,
      viewerAssetName: state?.viewerAssetName ?? "",
    };
  });
  if (!before.viewerOpen) {
    throw new Error("title graphic viewer is not open");
  }
  await clickStagePoint(page, 640, 360);
  await page.waitForTimeout(180);
  const after = await page.evaluate((prior) => {
    const state = window.__sakuraActiveInstall?.titleGraphicState ?? null;
    return {
      action: "viewer",
      open: state?.open === true,
      viewerOpen: state?.viewerOpen === true,
      viewerAssetName: prior.viewerAssetName,
      lastAction: state?.lastAction ?? "",
      menuLastAction: window.__sakuraActiveInstall?.titleLastAction ?? "",
    };
  }, before);
  if (after.viewerOpen) {
    throw new Error("title graphic viewer did not close after click");
  }
  return after;
}

async function clickStagePoint(page, x, y) {
  const point = await page.evaluate(({ stageX, stageY }) => {
    const canvas = document.querySelector("#stage") ?? document.querySelector("canvas");
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    return {
      clientX: rect.left + (stageX * rect.width / canvas.width),
      clientY: rect.top + (stageY * rect.height / canvas.height),
    };
  }, { stageX: x, stageY: y });
  if (!point) {
    throw new Error("stage canvas is not available");
  }
  await page.mouse.click(point.clientX, point.clientY);
}

async function clickTitleMusic(page, index) {
  const result = await page.evaluate(async (musicIndex) => {
    if (typeof window.sakuraSelectTitleMusic !== "function") {
      return { ok: false, reason: "api_missing" };
    }
    return await window.sakuraSelectTitleMusic(musicIndex);
  }, index);
  if (!result?.ok && result?.assetReady !== 1) {
    throw new Error(`click title music ${index} failed: ${result?.reason ?? "unknown"}`);
  }
  await page.waitForTimeout(150);
  return result;
}

async function startScenarioRoute(page, route, scenarioName) {
  const result = await page.evaluate(
    async ({ routeId, name }) => {
      if (typeof window.sakuraStartScenarioRoute !== "function") {
        return { ok: false, reason: "api_missing" };
      }
      return await window.sakuraStartScenarioRoute(routeId, name);
    },
    { routeId: route, name: scenarioName ?? "" },
  );
  if (!result?.ok) {
    throw new Error(`start route ${route} failed: ${result?.reason ?? "unknown"}`);
  }
  return result;
}

async function smokeRouteEndings(page, timeoutMs, delayMs) {
  const results = [];
  for (const route of scenarioRouteChoices()) {
    const started = await startScenarioRoute(page, route.routeId, route.endingScenario);
    if (started.scenarioIndex !== route.scenarioCount - 1) {
      throw new Error(
        `route ${route.routeId} started ${route.endingScenario} at index ${started.scenarioIndex}; expected ${route.scenarioCount - 1}`,
      );
    }
    const observed = await waitForRouteScenario(
      page,
      route.routeId,
      route.endingScenario,
      timeoutMs,
    );
    const content = await advanceRouteUntilContentSignal(
      page,
      route.routeId,
      route.endingScenario,
      Math.min(Math.max(20, delayMs), 50),
      { requireVisual: true },
    );
    results.push({
      routeId: route.routeId,
      label: route.label,
      endingScenario: route.endingScenario,
      scenarioCount: route.scenarioCount,
      started,
      observed,
      content,
    });
  }
  return { ok: true, count: results.length, results };
}

async function smokeRouteChapters(page, timeoutMs, delayMs) {
  const results = [];
  for (const route of scenarioRouteChoices()) {
    const chapters = scenarioChapterChoices(route.routeId);
    const chapterResults = [];
    for (const chapter of chapters) {
      const started = await startScenarioRoute(page, route.routeId, chapter.scenarioName);
      if (started.scenarioIndex !== chapter.scenarioIndex) {
        throw new Error(
          `route ${route.routeId} started ${chapter.scenarioName} at index ${started.scenarioIndex}; expected ${chapter.scenarioIndex}`,
        );
      }
      const observed = await waitForRouteScenario(
        page,
        route.routeId,
        chapter.scenarioName,
        timeoutMs,
      );
      const content = await advanceRouteUntilContentSignal(
        page,
        route.routeId,
        chapter.scenarioName,
        Math.min(Math.max(20, delayMs), 50),
        { requireVisual: true },
      );
      chapterResults.push({
        scenarioName: chapter.scenarioName,
        scenarioIndex: chapter.scenarioIndex,
        started,
        observed,
        content,
      });
    }
    results.push({
      routeId: route.routeId,
      label: route.label,
      scenarioCount: route.scenarioCount,
      chapterCount: chapterResults.length,
      chapters: chapterResults,
    });
  }
  return {
    ok: true,
    routeCount: results.length,
    chapterCount: results.reduce((sum, route) => sum + route.chapterCount, 0),
    results,
  };
}

async function smokeFullRoutes(page, timeoutMs, delayMs, routeFilter = "") {
  const allRoutes = scenarioRouteChoices();
  const requested = String(routeFilter ?? "").trim().toLowerCase();
  const requestedRoute = requested
    ? allRoutes.find((route) => route.routeId === requested)
    : null;
  if (requested && !requestedRoute) {
    throw new Error(`unknown full-route smoke target ${requested}`);
  }
  const routes = requestedRoute ? [requestedRoute] : allRoutes;
  const results = [];
  for (const route of routes) {
    console.error(
      `full_route_smoke_start route=${route.routeId} first=${route.firstScenario} ending=${route.endingScenario} scenarios=${route.scenarioCount}`,
    );
    const started = await startScenarioRoute(page, route.routeId, route.firstScenario);
    if (started.scenarioIndex !== 0) {
      throw new Error(
        `route ${route.routeId} started ${route.firstScenario} at index ${started.scenarioIndex}; expected 0`,
      );
    }
    const observed = await waitForRouteScenario(
      page,
      route.routeId,
      route.firstScenario,
      timeoutMs,
    );
    await enableFullRouteFastMode(page);
    const traversed = await waitForFullRouteEnding(page, route, timeoutMs, delayMs);
    console.error(
      `full_route_smoke_done route=${route.routeId} visited=${traversed.visitedCount}/${traversed.expectedCount} advances=${traversed.advances}`,
    );
    results.push({
      routeId: route.routeId,
      label: route.label,
      scenarioCount: route.scenarioCount,
      firstScenario: route.firstScenario,
      endingScenario: route.endingScenario,
      started,
      observed,
      traversed,
    });
  }
  return {
    ok: true,
    routeCount: results.length,
    scenarioCount: results.reduce((sum, route) => sum + route.traversed.expectedCount, 0),
    observedScenarioCount: results.reduce((sum, route) => sum + route.traversed.visitedCount, 0),
    results,
  };
}

async function enableFullRouteFastMode(page) {
  return await page.evaluate(() => {
    const player = window.__sakuraActiveInstall?.player ?? null;
    if (!player) {
      return { ok: false, reason: "no_player" };
    }
    if (typeof player.startAutomatic === "function" && !player.__fullRouteOriginalStartAutomatic) {
      player.__fullRouteOriginalStartAutomatic = player.startAutomatic;
      player.startAutomatic = () => {};
    }
    player.autoMode = false;
    player.skipMode = false;
    player.automaticStopRequested = false;
    if (player.automaticRunning === true) {
      player.automaticSkip = true;
      player.automaticWake?.();
    }
    return {
      ok: true,
      automaticRunning: Number(player.automaticRunning === true),
      scenarioName: player.safeState?.scenarioName ?? "",
      eventKind: player.event?.kind ?? 0,
      eventCount: player.event?.eventCount ?? 0,
    };
  });
}

async function waitForFullRouteEnding(page, route, timeoutMs, delayMs) {
  const deadline = Date.now() + timeoutMs;
  const visited = new Map();
  let last = null;
  let maxScenarioIndex = -1;
  let maxEventCount = -1;
  let loggedScenarioIndex = -1;
  let advances = 0;
  const sleepMs = Math.min(Math.max(10, delayMs), 50);
  while (Date.now() < deadline) {
    last = await captureRouteScenario(page);
    if (last.route !== route.routeId) {
      throw new Error(
        `full-route smoke drifted from ${route.routeId} to ${last.route}/${last.name}`,
      );
    }
    if (last.runtimeNotifyErrors > 0) {
      throw new Error(
        `full-route smoke saw runtime notify errors on ${route.routeId}/${last.name}: ${last.runtimeNotifyErrors}`,
      );
    }
    if (last.eventKind === 2) {
      throw new Error(`full-route smoke reached unexpected choice on ${route.routeId}/${last.name}`);
    }
    if (last.name && Number.isInteger(last.index) && last.index >= 0) {
      visited.set(last.index, last.name);
    }
    maxScenarioIndex = Math.max(maxScenarioIndex, last.index);
    maxEventCount = Math.max(maxEventCount, last.eventCount);
    if (last.index !== loggedScenarioIndex) {
      loggedScenarioIndex = last.index;
      console.error(
        `full_route_smoke_progress route=${route.routeId} index=${last.index}/${route.scenarioCount - 1} name=${last.name} event=${last.eventCount}`,
      );
    }
    if (
      last.index === route.scenarioCount - 1
      && last.name === route.endingScenario
      && last.eventKind === 4
      && !last.loading
    ) {
      return {
        routeId: route.routeId,
        endingScenario: route.endingScenario,
        visitedCount: visited.size,
        expectedCount: route.scenarioCount,
        visited: Array.from(visited.entries())
          .sort((left, right) => left[0] - right[0])
          .map(([index, name]) => ({ index, name })),
        maxScenarioIndex,
        maxEventCount,
        scenarioTransitions: last.scenarioTransitions,
        advances,
        final: last,
      };
    }
    if (!last.loading) {
      const chunk = await fastForwardFullRouteChunk(page, route.routeId, 2048);
      advances += chunk.steps ?? 0;
      if (chunk.choice === true) {
        throw new Error(
          `full-route smoke reached unexpected choice on ${route.routeId}/${chunk.scenarioName}`,
        );
      }
      if (chunk.drift === true) {
        throw new Error(
          `full-route smoke drifted from ${route.routeId} to ${chunk.route}/${chunk.scenarioName}`,
        );
      }
      if ((chunk.steps ?? 0) <= 0 && !chunk.loading && !chunk.halted && !chunk.automaticRunning) {
        throw new Error(`full-route smoke made no progress on ${route.routeId}; chunk=${JSON.stringify(chunk)}`);
      }
    }
    await page.waitForTimeout(sleepMs);
  }
  throw new Error(
    `full-route smoke timed out on ${route.routeId}; last=${JSON.stringify(last)}`,
  );
}

async function fastForwardFullRouteChunk(page, routeId, maxSteps) {
  return await page.evaluate(({ expectedRoute, stepLimit }) => {
    const player = window.__sakuraActiveInstall?.player ?? null;
    if (!player) {
      return { ok: false, reason: "no_player" };
    }
    if (player.automaticRunning === true) {
      player.skipAutomatic?.();
      return {
        ok: true,
        steps: 0,
        messages: 0,
        automatic: 0,
        choice: false,
        drift: false,
        loading: player.scenarioLoading === true,
        halted: player.event?.kind === 4,
        automaticRunning: true,
        route: player.safeState?.scenarioRoute ?? "",
        scenarioName: player.safeState?.scenarioName ?? "",
        scenarioIndex: player.safeState?.scenarioIndex ?? -1,
        scenarioCount: player.safeState?.scenarioCount ?? 0,
        eventKind: player.event?.kind ?? 0,
        eventCount: player.event?.eventCount ?? 0,
      };
    }
    player.cancelAutoSkip?.();
    let steps = 0;
    let messages = 0;
    let automatic = 0;
    let choice = false;
    let drift = false;
    for (; steps < stepLimit; steps += 1) {
      if (player.scenarioLoading === true || player.automaticRunning === true) {
        break;
      }
      const route = player.safeState?.scenarioRoute ?? "";
      if (route !== expectedRoute) {
        drift = true;
        break;
      }
      const kind = player.event?.kind ?? 0;
      if (kind === 4) {
        break;
      }
      if (kind === 2) {
        choice = true;
        break;
      }
      let ok = false;
      if (kind === 1) {
        ok = player.advanceMessage?.() === 1 && player.step?.() === true;
        messages += 1;
      } else {
        ok = player.step?.() === true;
        automatic += 1;
      }
      if (!ok) {
        break;
      }
    }
    return {
      ok: true,
      steps,
      messages,
      automatic,
      choice,
      drift,
      loading: player.scenarioLoading === true,
      halted: player.event?.kind === 4,
      automaticRunning: player.automaticRunning === true,
      route: player.safeState?.scenarioRoute ?? "",
      scenarioName: player.safeState?.scenarioName ?? "",
      scenarioIndex: player.safeState?.scenarioIndex ?? -1,
      scenarioCount: player.safeState?.scenarioCount ?? 0,
      eventKind: player.event?.kind ?? 0,
      eventCount: player.event?.eventCount ?? 0,
    };
  }, { expectedRoute: routeId, stepLimit: Math.max(1, maxSteps) });
}

async function advanceRouteUntilContentSignal(page, routeId, scenarioName, delayMs, options = {}) {
  const requireVisual = options.requireVisual === true;
  const maxAdvances = 96;
  let last = null;
  for (let advances = 0; advances <= maxAdvances; advances += 1) {
    last = await captureRouteScenario(page);
    if (last.route !== routeId || last.name !== scenarioName) {
      throw new Error(
        `route smoke drifted from ${routeId}/${scenarioName} to ${last.route}/${last.name}`,
      );
    }
    if (last.loading) {
      await page.waitForTimeout(delayMs);
      continue;
    }
    if (requireVisual ? last.visualSignal : last.contentSignal) {
      return { ...last, advances };
    }
    if (last.eventKind === 4) {
      break;
    }
    await advanceRuntime(page, 1, delayMs);
  }
  throw new Error(
    `route ${routeId} scenario ${scenarioName} did not reach a ${requireVisual ? "visual" : "content"} signal; last=${JSON.stringify(last)}`,
  );
}

async function waitForRouteScenario(page, routeId, scenarioName, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const observed = await captureRouteScenario(page);
    if (
      observed.route === routeId
      && observed.name === scenarioName
      && observed.loading === false
      && observed.eventKind > 0
    ) {
      return observed;
    }
    await page.waitForTimeout(20);
  }
  const actual = await page.evaluate(() => {
    const player = window.__sakuraActiveInstall?.player ?? null;
    return {
      route: player?.safeState?.scenarioRoute ?? "",
      name: player?.safeState?.scenarioName ?? "",
      index: player?.safeState?.scenarioIndex ?? -1,
      loading: player?.scenarioLoading === true,
      eventKind: player?.event?.kind ?? 0,
      eventCount: player?.event?.eventCount ?? 0,
    };
  });
  throw new Error(
    `route ${routeId} scenario ${scenarioName} did not become active; actual=${JSON.stringify(actual)}`,
  );
}

async function captureRouteScenario(page) {
  return await page.evaluate(() => {
    const player = window.__sakuraActiveInstall?.player ?? null;
    const canvas = document.getElementById("stage");
    const ctx = canvas?.getContext?.("2d", { willReadFrequently: true }) ?? null;
    const canvasMaxLuma = ctx ? (() => {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let max = 0;
      for (let index = 0; index < data.length; index += 4) {
        const luma = data[index] + data[index + 1] + data[index + 2];
        if (luma > max) {
          max = luma;
        }
      }
      return max;
    })() : null;
    const visualSignal = canvasMaxLuma > 0;
    const contentSignal = Boolean(
      visualSignal
      || player?.scene?.currentName
      || (player?.safeState?.bgmAssetReady ?? 0) > 0
      || (player?.safeState?.sceneObjectAssetReady ?? 0) > 0
      || (player?.safeState?.sceneMovieCount ?? 0) > 0
      || player?.event?.kind === 1
    );
    return {
      route: player?.safeState?.scenarioRoute ?? "",
      name: player?.safeState?.scenarioName ?? "",
      index: player?.safeState?.scenarioIndex ?? -1,
      count: player?.safeState?.scenarioCount ?? 0,
      loading: player?.scenarioLoading === true,
      eventKind: player?.event?.kind ?? 0,
      eventCount: player?.event?.eventCount ?? 0,
      backgroundName: player?.scene?.currentName ?? null,
      bgmAssetReady: player?.safeState?.bgmAssetReady ?? 0,
      sceneObjectAssetReady: player?.safeState?.sceneObjectAssetReady ?? 0,
      sceneObjectCount: player?.scene?.sprites?.sceneObjects?.size ?? 0,
      movieCount: player?.safeState?.sceneMovieCount ?? 0,
      scenarioTransitions: player?.safeState?.scenarioTransitions ?? 0,
      canvasMaxLuma,
      contentSignal,
      visualSignal,
    };
  });
}

async function seedSaveSlot(page, slot, timeoutMs) {
  await waitForStableScenario(page, timeoutMs);
  const result = await page.evaluate((slotIndex) => {
    const player = window.__sakuraActiveInstall?.player ?? null;
    return player?.saveToStorage?.(slotIndex) ?? { ok: false, reason: "no_player", bytes: 0 };
  }, slot);
  if (!result?.ok) {
    throw new Error(`save slot ${slot} seed failed: ${result?.reason ?? "unknown"}`);
  }
  return result;
}

async function seedTitleClear(page, routeId) {
  const result = await page.evaluate((route) => {
    const normalized = /^(an|pi|rn|ze|iv|v|vi)$/.test(String(route ?? ""))
      ? String(route)
      : "iv";
    const storage = window.localStorage;
    if (!storage) {
      return { ok: false, reason: "storage_unavailable" };
    }
    const record = {
      version: 1,
      routes: {
        [normalized]: {
          endingScenario: "ed05",
          clearedAt: "2026-06-18 00:00:00",
        },
      },
    };
    storage.setItem("sakura.title.clear.v1", JSON.stringify(record));
    window.__sakuraActiveInstall?.refreshTitleMenu?.();
    return { ok: true, routeId: normalized, record };
  }, routeId);
  if (!result?.ok) {
    throw new Error(`title clear seed failed: ${result?.reason ?? "unknown"}`);
  }
  return result;
}

async function seedConfigVoiceOff(page, index) {
  const settings = normalizedScenarioConfigSettings(defaultScenarioConfigSettings());
  if (Number.isInteger(index) && index >= 0 && index < settings.characterVoices.length) {
    settings.characterVoices[index] = false;
  }
  const result = await page.evaluate(({ key, seededSettings, faceIndex }) => {
    const storage = window.localStorage;
    if (!storage) {
      return { ok: false, reason: "storage_unavailable" };
    }
    storage.setItem(key, JSON.stringify({
      version: 1,
      settings: seededSettings,
    }));
    window.__sakuraActiveInstall?.player?.loadConfigSettings?.();
    return {
      ok: true,
      faceIndex,
      characterVoices: seededSettings.characterVoices,
    };
  }, {
    key: SCENARIO_CONFIG_STORAGE_KEY,
    seededSettings: settings,
    faceIndex: index,
  });
  if (!result?.ok) {
    throw new Error(`config voice seed failed: ${result?.reason ?? "unknown"}`);
  }
  return result;
}

async function seedDummySaveSlot(page, slot) {
  const result = await page.evaluate((slotIndex) => {
    const storage = window.localStorage;
    if (!storage) {
      return { ok: false, reason: "storage_unavailable" };
    }
    const normalized = Math.max(0, Math.min(999, Math.trunc(Number(slotIndex) || 0)));
    const record = {
      version: 14,
      savedAt: "2026-06-14 00:00:00",
      slot: normalized,
      scenarioName: "00_op_01",
      event: {
        eventCount: 45,
        text: "dummy save record for title Load UI validation",
      },
    };
    const encoded = JSON.stringify(record);
    storage.setItem(`sakura.session.slot.${normalized}`, encoded);
    if (normalized === 0) {
      storage.setItem("sakura.session.slot.0", encoded);
    }
    return { ok: true, reason: "ok", slot: normalized };
  }, slot);
  if (!result?.ok) {
    throw new Error(`dummy save slot ${slot} seed failed: ${result?.reason ?? "unknown"}`);
  }
  return result;
}

async function advanceUntilScenario(page, limit, targetScenario, delayMs) {
  if (!targetScenario) {
    throw new Error("--target-scenario is required with --advance-until-scenario");
  }
  let advances = 0;
  while (advances <= limit) {
    const observed = await page.evaluate(() => {
      const player = window.__sakuraActiveInstall?.player ?? null;
      return {
        loading: player?.scenarioLoading === true,
        name: player?.safeState?.scenarioName ?? "",
      };
    });
    if (observed.name.toLowerCase() === targetScenario) {
      return;
    }
    if (observed.loading) {
      await page.waitForTimeout(Math.max(10, delayMs));
      continue;
    }
    if (advances === limit) {
      break;
    }
    await advanceRuntime(page, 1, delayMs);
    advances += 1;
  }
  const actual = await page.evaluate(
    () => window.__sakuraActiveInstall?.player?.safeState?.scenarioName ?? "",
  );
  throw new Error(
    `scenario ${targetScenario} was not reached within ${limit} advances; actual=${actual}`,
  );
}

async function advanceUntilChoice(page, limit, delayMs) {
  for (let advances = 0; advances <= limit; advances += 1) {
    const observed = await page.evaluate(() => {
      const player = window.__sakuraActiveInstall?.player ?? null;
      const event = player?.event ?? null;
      return {
        kind: event?.kind ?? 0,
        optionCount: Array.isArray(event?.options) ? event.options.length : 0,
        eventCount: event?.eventCount ?? 0,
        loading: player?.scenarioLoading === true,
        automaticRunning: player?.automaticRunning === true,
        scenarioName: player?.safeState?.scenarioName ?? "",
      };
    });
    if (observed.kind === 2 && observed.optionCount > 0) {
      return observed;
    }
    if (observed.loading) {
      await page.waitForTimeout(Math.max(10, delayMs));
      continue;
    }
    await advanceRuntime(page, 1, delayMs);
  }
  const actual = await page.evaluate(() => {
    const player = window.__sakuraActiveInstall?.player ?? null;
    return {
      eventCount: player?.event?.eventCount ?? 0,
      scenarioName: player?.safeState?.scenarioName ?? "",
    };
  });
  throw new Error(
    `no scenario choice reached within ${limit} advances; actual event=${actual.eventCount} scenario=${actual.scenarioName}`,
  );
}

async function advanceUntilEvent(page, targetEventCount, delayMs) {
  const limit = Math.max(256, targetEventCount * 4);
  for (let advances = 0; advances <= limit;) {
    const observed = await page.evaluate(() => {
      const player = window.__sakuraActiveInstall?.player ?? null;
      return {
        automaticRunning: player?.automaticRunning === true,
        eventCount: player?.event?.eventCount ?? 0,
        loading: player?.scenarioLoading === true,
        scenarioName: player?.safeState?.scenarioName ?? "",
      };
    });
    if (observed.eventCount === targetEventCount) {
      return;
    }
    if (observed.eventCount > targetEventCount) {
      throw new Error(
        `scenario event ${targetEventCount} was skipped; actual=${observed.eventCount} scenario=${observed.scenarioName}`,
      );
    }
    if (observed.loading) {
      await page.waitForTimeout(Math.max(10, delayMs));
      continue;
    }
    if (observed.automaticRunning) {
      await advanceRuntime(page, 1, delayMs);
      advances += 1;
      continue;
    }
    if (advances === limit) {
      break;
    }
    await advanceRuntime(page, 1, delayMs);
    advances += 1;
  }
  const actual = await page.evaluate(() => {
    const player = window.__sakuraActiveInstall?.player ?? null;
    return {
      eventCount: player?.event?.eventCount ?? 0,
      scenarioName: player?.safeState?.scenarioName ?? "",
    };
  });
  throw new Error(
    `scenario event ${targetEventCount} was not reached within ${limit} advances; actual=${actual.eventCount} scenario=${actual.scenarioName}`,
  );
}

async function advanceUntilMessageControl(page, limit, targetCount, opcode, delayMs) {
  for (let index = 0; index < limit; index += 1) {
    const observed = await page.evaluate(() => {
      const player = window.__sakuraActiveInstall?.player ?? null;
      return {
        count: player?.safeState?.messageControlCount ?? 0,
        opcode: player?.safeState?.messageControlOpcode ?? 0,
      };
    });
    if (observed.count >= targetCount && (opcode === 0 || observed.opcode === opcode)) {
      return;
    }
    await advanceRuntime(page, 1, delayMs);
  }
  throw new Error(
    `message control opcode 0x${opcode.toString(16)} count ${targetCount} did not start within ${limit} advances`,
  );
}

async function captureSaveLoadState(page) {
  return page.evaluate(() => {
    const player = window.__sakuraActiveInstall?.player ?? null;
    if (!player) {
      return null;
    }
    return {
      scenarioName: player.safeState?.scenarioName ?? "",
      scenarioIndex: player.scenarioIndex ?? -1,
      event: player.event ?? null,
      backlog: (player.backlog ?? []).map((entry) => ({ ...entry })),
      backgroundName: player.scene?.currentName ?? null,
      aperture: player.scene?.aperture?.current
        ? { ...player.scene.aperture.current }
        : null,
      rain: player.scene?.rain
        ? {
            active: player.scene.rain.active === true,
            alpha: player.scene.rain.alpha,
            angleDeg: player.scene.rain.angleDeg,
            density: player.scene.rain.density,
            fadeMs: player.scene.rain.fadeMs,
            red: player.scene.rain.red,
            green: player.scene.rain.green,
            blue: player.scene.rain.blue,
            speed: player.scene.rain.speed,
          }
        : null,
      sprites: [...(player.scene?.sprites?.layers ?? [])].map(([slot, layer]) => ({
        slot,
        assetName: layer.assetName,
        alpha: layer.alpha,
        order: layer.order,
        priority: layer.priority,
        x: layer.x,
        y: layer.y,
        z: layer.z,
      })),
      spriteTransitions: [...(player.scene?.sprites?.transitions?.values?.() ?? [])]
        .map((transition) => ({
          slot: transition.slot,
          opcode: transition.opcode,
          eventCount: transition.eventCount,
          mapAssetName: transition.mapAssetName ?? "",
          remainingMs: Math.max(
            0,
            transition.durationMs - (performance.now() - transition.startedAt),
          ),
          remove: transition.remove,
          from: transition.from
            ? {
                assetName: transition.from.assetName,
                alpha: transition.from.alpha,
                order: transition.from.order,
                priority: transition.from.priority,
                x: transition.from.x,
                y: transition.from.y,
                z: transition.from.z,
              }
            : null,
          to: transition.to
            ? {
                assetName: transition.to.assetName,
                alpha: transition.to.alpha,
                order: transition.to.order,
                priority: transition.to.priority,
                x: transition.to.x,
                y: transition.to.y,
                z: transition.to.z,
              }
            : null,
        })),
      motions: [...(player.scene?.sprites?.motions ?? [])].map(([slot, motion]) => ({
        slot,
        amplitudeX: motion.amplitudeX ?? 0,
        amplitudeY: motion.amplitudeY,
        periodMs: motion.periodMs,
        phase: motion.phase ?? 0,
        directionMode: motion.directionMode ?? null,
        speed: motion.speed ?? null,
      })),
      controlMotions: [...(player.scene?.sprites?.controlMotions ?? [])].map(
        ([slot, motion]) => ({
          slot,
          spriteId: motion.spriteId,
          repeatCount: motion.repeatCount,
          elements: motion.elements,
        }),
      ),
      sceneObjects: [...(player.scene?.sprites?.sceneObjects ?? [])].map(([id, object]) => ({
        id,
        assetName: object.assetName,
        x: object.x,
        y: object.y,
        z: object.z,
        anchorX: object.anchorX,
        anchorY: object.anchorY,
        alpha: object.alpha,
        priority: object.priority,
        blendMode: object.blendMode,
        isMovie: object.isMovie === true,
        maskAssetName: object.maskAssetName ?? "",
        hasMaskImage: object.maskImage ? true : false,
        animation: object.animation
          ? {
              frameCount: object.animation.frameCount,
              frameIntervalMs: object.animation.frameIntervalMs,
              sequenceStyle: object.animation.sequenceStyle,
            }
          : null,
        motion: player.scene?.sprites?.sceneObjectMotions?.get(id)
          ? {
              amplitudeX: player.scene.sprites.sceneObjectMotions.get(id).amplitudeX ?? 0,
              amplitudeY: player.scene.sprites.sceneObjectMotions.get(id).amplitudeY ?? 0,
              directionMode: player.scene.sprites.sceneObjectMotions.get(id).directionMode ?? null,
              periodMs: player.scene.sprites.sceneObjectMotions.get(id).periodMs,
              phase: player.scene.sprites.sceneObjectMotions.get(id).phase ?? 0,
              speed: player.scene.sprites.sceneObjectMotions.get(id).speed ?? null,
            }
          : null,
      })),
      filter: player.scene?.filter?.current
        ? { ...player.scene.filter.current }
        : null,
    };
  });
}

async function advanceUntilSceneObject(page, limit, delayMs) {
  for (let index = 0; index < limit; index += 1) {
    const active = await page.evaluate(
      () => (window.__sakuraActiveInstall?.player?.scene?.sprites?.sceneObjects?.size ?? 0) > 0,
    );
    if (active) {
      return;
    }
    await advanceRuntime(page, 1, delayMs);
  }
  throw new Error(`scene object did not appear within ${limit} advances`);
}

async function advanceUntilSpriteTransition(
  page,
  limit,
  opcode,
  targetCount,
  targetEvent,
  targetScenario,
  delayMs,
) {
  const seen = new Set();
  for (let index = 0; index < limit; index += 1) {
    const observed = await page.evaluate(({ wantedOpcode, wantedScenario }) => {
      const player = window.__sakuraActiveInstall?.player;
      const matchesScenario = (
        wantedScenario.length === 0
        || player?.safeState?.scenarioName === wantedScenario
      );
      const transitions = matchesScenario
        ? [...(player?.scene?.sprites?.transitions?.values?.() ?? [])]
            .filter((transition) => (
              wantedOpcode === 0 || transition.opcode === wantedOpcode
            ))
        : [];
      return {
        events: transitions.map((transition) => transition.eventCount),
      };
    }, { wantedOpcode: opcode, wantedScenario: targetScenario });
    for (const event of observed.events) {
      if (event > 0) seen.add(event);
    }
    if (observed.events.length > 0) {
      if (
        (targetEvent > 0 && observed.events.includes(targetEvent))
        || (targetEvent === 0 && seen.size >= targetCount)
      ) {
        return;
      }
    }
    await advanceRuntime(page, 1, delayMs);
  }
  throw new Error(
    `sprite transition scenario ${targetScenario || "*"} opcode 0x${opcode.toString(16)} event ${targetEvent} count ${targetCount} did not start within ${limit} advances; seen=${[...seen].join(",")}`,
  );
}

async function advanceUntilSceneObjectTransition(page, limit, targetEvent, delayMs) {
  const seen = new Set();
  for (let index = 0; index < limit; index += 1) {
    const observed = await page.evaluate(() => {
      const player = window.__sakuraActiveInstall?.player;
      return {
        active: (player?.scene?.sprites?.sceneObjectTransitions?.size ?? 0) > 0,
        event: player?.safeState?.sceneObjectEventCount ?? 0,
      };
    });
    if (observed.active) {
      seen.add(observed.event);
    }
    if (
      (targetEvent > 0 && observed.event === targetEvent)
      || (targetEvent === 0 && observed.active)
    ) {
      return;
    }
    await advanceRuntime(page, 1, delayMs);
  }
  throw new Error(
    `scene object transition event ${targetEvent} did not start within ${limit} advances; seen=${[...seen].join(",")}`,
  );
}

async function advanceUntilSpriteMotion(page, limit, delayMs) {
  for (let index = 0; index < limit; index += 1) {
    const active = await page.evaluate(() => {
      const sprites = window.__sakuraActiveInstall?.player?.scene?.sprites;
      return (
        (sprites?.motions?.size ?? 0) > 0
        || (sprites?.controlMotions?.size ?? 0) > 0
      );
    });
    if (active) {
      return;
    }
    await advanceRuntime(page, 1, delayMs);
  }
  throw new Error(`sprite motion did not start within ${limit} advances`);
}

async function advanceUntilControlMotion(page, limit, delayMs) {
  for (let index = 0; index < limit; index += 1) {
    const active = await page.evaluate(
      () => (
        window.__sakuraActiveInstall?.player?.scene?.sprites?.controlMotions?.size ?? 0
      ) > 0,
    );
    if (active) {
      return;
    }
    await advanceRuntime(page, 1, delayMs);
  }
  throw new Error(`sprite control motion did not start within ${limit} advances`);
}

async function advanceUntilFilter(page, limit, delayMs) {
  for (let index = 0; index < limit; index += 1) {
    const active = await page.evaluate(() => {
      const filter = window.__sakuraActiveInstall?.player?.scene?.filter;
      return filter?.current !== null || filter?.transition !== null;
    });
    if (active) {
      return;
    }
    await advanceRuntime(page, 1, delayMs);
  }
  throw new Error(`scenario filter did not appear within ${limit} advances`);
}

async function advanceUntilFilterClear(page, limit, delayMs) {
  for (let index = 0; index < limit; index += 1) {
    const cleared = await page.evaluate(() => {
      const player = window.__sakuraActiveInstall?.player;
      const filter = player?.scene?.filter;
      return (player?.safeState?.sceneFilterCount ?? 0) >= 2
        && filter?.current === null
        && filter?.transition === null;
    });
    if (cleared) {
      return;
    }
    await advanceRuntime(page, 1, delayMs);
  }
  throw new Error(`scenario filter did not clear within ${limit} advances`);
}

async function advanceUntilPresetShake(page, limit, delayMs) {
  for (let index = 0; index < limit; index += 1) {
    const started = await page.evaluate(
      () => (window.__sakuraActiveInstall?.player?.safeState?.scenePresetShakeCount ?? 0) > 0,
    );
    if (started) {
      return;
    }
    await advanceRuntime(page, 1, delayMs);
  }
  throw new Error(`preset screen shake did not start within ${limit} advances`);
}

async function advanceUntilSfxControl(page, limit, targetCount, delayMs) {
  for (let index = 0; index < limit; index += 1) {
    const handled = await page.evaluate(
      (count) => (window.__sakuraActiveInstall?.player?.safeState?.sfxControlCount ?? 0) >= count,
      targetCount,
    );
    if (handled) {
      return;
    }
    await advanceRuntime(page, 1, delayMs);
  }
  throw new Error(`SFX control count ${targetCount} was not reached within ${limit} advances`);
}

async function advanceUntilVoiceChannels(page, limit, targetCount, delayMs) {
  for (let index = 0; index < limit; index += 1) {
    const active = await page.evaluate(
      (count) => (
        window.__sakuraActiveInstall?.audioMixer?.state?.().voiceActiveChannels ?? 0
      ) >= count,
      targetCount,
    );
    if (active) {
      return;
    }
    await advanceRuntime(page, 1, delayMs);
  }
  throw new Error(
    `voice channel count ${targetCount} was not reached within ${limit} advances`,
  );
}

async function openLogAfterBacklog(page, targetCount, timeoutMs, delayMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await page.evaluate((count) => {
      const player = window.__sakuraActiveInstall?.player ?? null;
      return Boolean(
        player
        &&
        player.backlog.length >= count
        && !player.automaticRunning
        && (player.event?.kind === 1 || player.event?.kind === 2)
      );
    }, targetCount);
    if (ready) {
      const box = await page.locator("#stage").boundingBox();
      if (!box) {
        throw new Error("scenario stage is not visible");
      }
      await page.mouse.click(
        box.x + 740 * box.width / 1280,
        box.y + 542 * box.height / 720,
      );
      await page.waitForFunction(
        () => window.__sakuraActiveInstall?.player?.backlogState?.open === true,
      );
      return;
    }
    await advanceRuntime(page, 1, delayMs);
  }
  throw new Error(`backlog count ${targetCount} was not reached before timeout`);
}

async function clickMessageControl(page, controlIndex) {
  const point = await page.evaluate((index) => {
    const canvas = document.getElementById("stage");
    const player = window.__sakuraActiveInstall?.player ?? null;
    const skin = player?.skin ?? null;
    if (
      !canvas
      || !skin?.panel
      || !Array.isArray(skin.controls)
      || !Number.isInteger(index)
      || index < 0
      || index >= skin.controls.length
    ) {
      return null;
    }
    const scale = 1.04;
    const controlsWidth = skin.controls.reduce(
      (sum, control) => sum + control.stateWidth * scale,
      0,
    );
    let x = Math.round((canvas.width - skin.panel.width) / 2)
      + skin.panel.width
      - controlsWidth
      - 30;
    for (let i = 0; i < index; i += 1) {
      x += skin.controls[i].stateWidth * scale;
    }
    const width = skin.controls[index].stateWidth * scale;
    const height = skin.controls[index].stateHeight;
    const y = canvas.height - skin.panel.height - 23;
    const rect = canvas.getBoundingClientRect();
    return {
      clientX: rect.left + (x + width / 2) * rect.width / canvas.width,
      clientY: rect.top + (y + height / 2) * rect.height / canvas.height,
    };
  }, controlIndex);
  if (!point) {
    throw new Error(`message control ${controlIndex} is not clickable`);
  }
  await page.mouse.click(point.clientX, point.clientY);
  await page.waitForTimeout(100);
}

async function openUserDataWindow(page, mode) {
  const normalized = String(mode).toLowerCase() === "load" ? "load" : "save";
  const ok = await page.evaluate((m) => {
    const player = window.__sakuraActiveInstall?.player ?? null;
    if (!player?.openUserDataWindow) {
      return false;
    }
    player.openUserDataWindow(m);
    player.onOverlayRepaint?.();
    return player.userDataState?.open === true;
  }, normalized);
  if (!ok) {
    throw new Error(`could not open userdata window (${normalized})`);
  }
  // Allow the saved-scene thumbnails to decode and repaint.
  await page.waitForTimeout(700);
}

async function clickUserDataSlot(page, slotIndex) {
  const point = await page.evaluate((slot) => {
    const canvas = document.getElementById("stage");
    const inst = window.__sakuraActiveInstall ?? null;
    const scenarioState = inst?.player?.userDataState ?? null;
    const state = scenarioState?.open === true
      ? scenarioState
      : inst?.titleUserDataState ?? null;
    if (!canvas || !state?.open || !Number.isInteger(slot)) {
      return null;
    }
    const local = slot - state.page * 9;
    if (local < 0 || local >= 9) {
      return null;
    }
    const column = local % 3;
    const row = Math.floor(local / 3);
    const x = [44, 444, 844][column] + 196;
    const y = [110, 284, 458][row] + 80;
    const rect = canvas.getBoundingClientRect();
    return {
      clientX: rect.left + x * rect.width / canvas.width,
      clientY: rect.top + y * rect.height / canvas.height,
    };
  }, slotIndex);
  if (!point) {
    throw new Error(`userdata slot ${slotIndex} is not clickable`);
  }
  await page.mouse.click(point.clientX, point.clientY);
  await page.waitForTimeout(250);
}

async function clickUserDataControl(page, controlName) {
  const point = await page.evaluate((name) => {
    const canvas = document.getElementById("stage");
    const inst = window.__sakuraActiveInstall ?? null;
    const scenarioState = inst?.player?.userDataState ?? null;
    const state = scenarioState?.open === true
      ? scenarioState
      : inst?.titleUserDataState ?? null;
    const skin = scenarioState?.open === true
      ? inst?.player?.userDataSkin
      : inst?.userDataWindow;
    if (!canvas || !state?.open || !skin?.buttons) {
      return null;
    }
    const key = String(name).toLowerCase();
    const top = { top: 44, previous: 196, next: 940, last: 1092 };
    const bottom = { back: 200, exit: 356, delete: 512, move: 668, copy: 824 };
    let x;
    let y;
    let imageKey;
    if (key in top) {
      x = top[key];
      y = 40;
      imageKey = key;
    } else if (key === "load" || key === "save") {
      // The left bottom button is the mode toggle: "load" on the Save screen,
      // "save" on the Load screen.
      const want = state.mode === "save" ? "load" : "save";
      if (key !== want) {
        return null;
      }
      x = 44;
      y = 650;
      imageKey = key;
    } else if (key in bottom) {
      x = bottom[key];
      y = 650;
      imageKey = key;
    } else {
      return null;
    }
    const image = skin.buttons[imageKey] ?? null;
    if (!image) {
      return null;
    }
    const stateWidth = Math.floor(image.width / 4);
    const rect = canvas.getBoundingClientRect();
    return {
      clientX: rect.left + (x + stateWidth / 2) * rect.width / canvas.width,
      clientY: rect.top + (y + image.height / 2) * rect.height / canvas.height,
    };
  }, controlName);
  if (!point) {
    throw new Error(`userdata control ${controlName} is not clickable`);
  }
  await page.mouse.click(point.clientX, point.clientY);
  await page.waitForTimeout(150);
}

async function clickConfigControl(page, controlName) {
  const point = await page.evaluate((name) => {
    const canvas = document.getElementById("stage");
    const inst = window.__sakuraActiveInstall ?? null;
    const scenarioState = inst?.player?.configState ?? null;
    const state = scenarioState?.open === true
      ? scenarioState
      : inst?.titleConfigState ?? null;
    const skin = scenarioState?.open === true
      ? inst?.player?.configSkin
      : inst?.configWindow;
    const namedPoint = {
      "screen-fullscreen": [400, 320],
      "screen-window": [540, 320],
    }[name];
    if (canvas && state?.open && namedPoint) {
      const rect = canvas.getBoundingClientRect();
      return {
        clientX: rect.left + namedPoint[0] * rect.width / canvas.width,
        clientY: rect.top + namedPoint[1] * rect.height / canvas.height,
      };
    }
    const buttonX = { reset: 396, title: 570, back: 744 }[name];
    if (!canvas || !state?.open || !skin?.buttons || buttonX === undefined) {
      return null;
    }
    const image = skin.buttons[name] ?? null;
    if (!image) {
      return null;
    }
    const stateWidth = Math.floor(image.width / 4);
    const rect = canvas.getBoundingClientRect();
    return {
      clientX: rect.left + (buttonX + stateWidth / 2) * rect.width / canvas.width,
      clientY: rect.top + (668 + image.height / 2) * rect.height / canvas.height,
    };
  }, controlName);
  if (!point) {
    throw new Error(`config control ${controlName} is not clickable`);
  }
  await page.mouse.click(point.clientX, point.clientY);
  await page.waitForTimeout(150);
}

async function clickDialogControl(page, controlName) {
  const point = await page.evaluate((name) => {
    const canvas = document.getElementById("stage");
    const inst = window.__sakuraActiveInstall ?? null;
    const state = inst?.dialogState ?? null;
    const skin = inst?.dialogWindow ?? null;
    const action = String(name).toLowerCase();
    if (
      canvas
      && state?.open === true
      && action === "ack"
      && skin?.panels?.[state.kind]
    ) {
      const panel = skin.panels[state.kind];
      const rect = canvas.getBoundingClientRect();
      return {
        clientX: rect.left + (279 + panel.width / 2) * rect.width / canvas.width,
        clientY: rect.top + (239 + panel.height / 2) * rect.height / canvas.height,
      };
    }
    if (
      !canvas
      || state?.open !== true
      || (action !== "yes" && action !== "no")
      || !skin?.buttons?.yes
      || !skin?.buttons?.no
      || !skin?.panels?.[state.kind]
    ) {
      return null;
    }
    const panel = skin.panels[state.kind];
    const yes = skin.buttons.yes;
    const no = skin.buttons.no;
    const stateWidth = Math.floor(yes.width / 4);
    const totalWidth = stateWidth * 2 + 20;
    const yesX = 279 + Math.round((panel.width - totalWidth) / 2);
    const noX = yesX + stateWidth + 20;
    const button = action === "yes" ? yes : no;
    const x = (action === "yes" ? yesX : noX) + stateWidth / 2;
    const y = 392 + button.height / 2;
    const rect = canvas.getBoundingClientRect();
    return {
      clientX: rect.left + x * rect.width / canvas.width,
      clientY: rect.top + y * rect.height / canvas.height,
    };
  }, controlName);
  if (!point) {
    throw new Error(`dialog control ${controlName} is not clickable`);
  }
  await page.mouse.click(point.clientX, point.clientY);
  await page.waitForTimeout(150);
}

async function runQuickSaveLoadSmoke(page, opts) {
  await waitForStableScenario(page, opts.timeoutMs);
  const before = await captureQuickSaveLoadState(page);
  await clickMessageControl(page, 5);
  const afterQuickSave = await captureQuickSaveLoadState(page);
  if (!afterQuickSave.dialogOpen || afterQuickSave.dialogKind !== "quickSave") {
    throw new Error(`quick-save notice did not open: ${JSON.stringify(afterQuickSave)}`);
  }
  await clickDialogControl(page, "ack");
  await waitForStableScenario(page, opts.timeoutMs);
  const afterAck = await captureQuickSaveLoadState(page);
  if (afterAck.dialogOpen) {
    throw new Error(`quick-save notice did not close: ${JSON.stringify(afterAck)}`);
  }
  await advanceRuntime(page, 1, opts.advanceDelayMs);
  await waitForStableScenario(page, opts.timeoutMs);
  const advanced = await captureQuickSaveLoadState(page);
  await clickMessageControl(page, 6);
  const afterQuickLoadRequest = await captureQuickSaveLoadState(page);
  if (!afterQuickLoadRequest.dialogOpen || afterQuickLoadRequest.dialogKind !== "load") {
    throw new Error(`quick-load confirmation did not open: ${JSON.stringify(afterQuickLoadRequest)}`);
  }
  await clickDialogControl(page, "yes");
  await waitForStableScenario(page, opts.timeoutMs);
  const restored = await captureQuickSaveLoadState(page);
  return {
    before,
    afterQuickSave,
    afterAck,
    advanced,
    afterQuickLoadRequest,
    restored,
    quickKeyCreated: afterQuickSave.quickSaveExists === true,
    normalSlot0Untouched: afterQuickSave.normalSlot0Exists === false,
    restoredEventCount: restored.eventCount === afterQuickSave.eventCount,
    loadOk: restored.userDataLastResult === "ok" && restored.userDataLastOk === 1,
  };
}

async function runQuickSaveStorageFailureSmoke(page, opts) {
  await waitForStableScenario(page, opts.timeoutMs);
  await page.evaluate(() => {
    window.localStorage.removeItem("sakura.session.quick");
    window.localStorage.removeItem("sakura.session.slot.0");
    window.localStorage.removeItem("sakura.session.slot");
  });
  const before = await captureQuickSaveLoadState(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(window, "__sakuraBootRuntimeOriginalSetItem", {
      value: original,
      configurable: true,
    });
    Storage.prototype.setItem = function setItemFailure(key, value) {
      if (String(key).startsWith("sakura.session")) {
        throw new DOMException("Injected storage failure", "QuotaExceededError");
      }
      return original.call(this, key, value);
    };
  });
  let afterFailure;
  try {
    await clickMessageControl(page, 5);
    afterFailure = await captureQuickSaveLoadState(page);
  } finally {
    await page.evaluate(() => {
      const original = window.__sakuraBootRuntimeOriginalSetItem;
      if (typeof original === "function") {
        Storage.prototype.setItem = original;
      }
      delete window.__sakuraBootRuntimeOriginalSetItem;
    });
  }
  return {
    before,
    afterFailure,
    failedWithStorageReason: afterFailure.messageControlClickResult === "storage_write_failed",
    noQuickKeyCreated: afterFailure.quickSaveExists === false,
    normalSlot0Untouched: afterFailure.normalSlot0Exists === false,
    noNoticeDialog: afterFailure.dialogOpen === false,
  };
}

async function runEngineManagerClickSmoke(page) {
  return await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const read = () => {
      const manager = document.querySelector(".engine-manager");
      return {
        present: manager !== null,
        open: manager !== null && manager.hidden !== true,
        activeTab: manager?.dataset?.activeTab ?? "",
        statusText: manager?.querySelector(".engine-manager__status")?.textContent ?? "",
      };
    };
    const clickButton = (selector, text = "") => {
      const buttons = Array.from(document.querySelectorAll(selector));
      const target = buttons.find((button) => (
        text === "" || (button.textContent ?? "").trim() === text
      ));
      if (!target) {
        return false;
      }
      target.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
      return true;
    };
    const waitFor = async (predicate, timeoutMs = 5000) => {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        if (predicate()) {
          return true;
        }
        await sleep(50);
      }
      return false;
    };
    const before = read();
    const cloudSaveClicked = clickButton(".engine-manager__action", "Cloud Save");
    const saveSettled = await waitFor(() => /^Saved \d+ keys$/.test(read().statusText));
    const afterCloudSave = read();
    const progressTabClicked = clickButton(".engine-manager__tab", "Progress");
    await sleep(50);
    const afterProgressTab = read();
    const closeClicked = clickButton(".engine-manager__close", "x");
    await sleep(50);
    const afterClose = read();
    window.__sakuraEngineManager?.open?.("cloud");
    await sleep(50);
    return {
      before,
      cloudSaveClicked,
      saveSettled,
      afterCloudSave,
      progressTabClicked,
      afterProgressTab,
      closeClicked,
      afterClose,
      final: read(),
    };
  });
}

async function runCloudStateSmoke(page) {
  return await page.evaluate(async () => {
    const storage = window.localStorage;
    storage.setItem("__sakura_cloud_smoke_progress", "saved");
    storage.setItem("sakura.config.v1", JSON.stringify({
      version: 1,
      settings: { textSpeed: 0.42 },
    }));
    const save = await window.sakuraSaveCloudState?.();
    storage.setItem("__sakura_cloud_smoke_progress", "changed");
    storage.setItem("__sakura_cloud_smoke_extra", "remove-me");
    const beforeLoad = {
      progress: storage.getItem("__sakura_cloud_smoke_progress"),
      extra: storage.getItem("__sakura_cloud_smoke_extra"),
    };
    const load = await window.sakuraLoadCloudState?.({ reload: false });
    return {
      save,
      load,
      beforeLoad,
      afterLoad: {
        progress: storage.getItem("__sakura_cloud_smoke_progress"),
        extra: storage.getItem("__sakura_cloud_smoke_extra"),
        config: storage.getItem("sakura.config.v1"),
      },
    };
  });
}

async function captureQuickSaveLoadState(page) {
  return page.evaluate(() => {
    const player = window.__sakuraActiveInstall?.player ?? null;
    const dialog = window.__sakuraActiveInstall?.dialogState ?? null;
    const mixer = window.__sakuraActiveInstall?.audioMixer?.state?.() ?? null;
    const storage = window.localStorage;
    const decode = (key) => {
      try {
        const encoded = storage.getItem(key);
        return encoded ? JSON.parse(encoded) : null;
      } catch {
        return null;
      }
    };
    const quick = decode("sakura.session.quick");
    const slot0 = decode("sakura.session.slot.0");
    return {
      eventCount: player?.event?.eventCount ?? -1,
      scenarioName: player?.safeState?.scenarioName ?? "",
      dialogOpen: dialog?.open === true,
      dialogKind: dialog?.kind ?? "",
      messageControlClickResult: player?.safeState?.messageControlClickResult ?? "",
      messageControlClickOk: player?.safeState?.messageControlClickOk ?? 0,
      userDataLastResult: player?.safeState?.userDataLastResult ?? "",
      userDataLastOk: player?.safeState?.userDataLastOk ?? 0,
      quickSaveExists: quick !== null,
      quickSaveVersion: quick?.version ?? 0,
      quickSaveEventCount: quick?.event?.eventCount ?? -1,
      quickSaveHasAudio: !!quick?.audio,
      quickSaveBgmName: quick?.audio?.bgm?.name ?? "",
      quickSaveLoopSfxName: quick?.audio?.loopSfx?.name ?? "",
      mixerTrackReady: mixer?.trackReady ?? 0,
      mixerTrackPaused: mixer?.trackPaused === null ? null : mixer?.trackPaused === true,
      mixerTrackLoop: mixer?.trackLoop === null ? null : mixer?.trackLoop === true,
      mixerTrackVolume: Number.isFinite(mixer?.trackVolume) ? mixer.trackVolume : 0,
      normalSlot0Exists: slot0 !== null,
    };
  });
}

async function waitForStableScenario(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stable = await page.evaluate(() => {
      const player = window.__sakuraActiveInstall?.player ?? null;
      return player
        && !player.automaticRunning
        && !player.scenarioLoading
        && (player.event?.kind === 1 || player.event?.kind === 2);
    });
    if (stable) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("scenario did not reach a stable save event");
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
