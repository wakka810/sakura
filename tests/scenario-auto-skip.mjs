import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 10_700 + Math.floor(Math.random() * 1000);
const server = spawn(process.execPath, ["tools/local-server.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SAKURA_HOST: "127.0.0.1",
    SAKURA_PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk.toString("utf8");
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString("utf8");
});

let browser = null;
try {
  await waitFor(() => output.includes("sakura_local_server=ready"), 15_000);
  browser = await chromium.launch({
    args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-webgl"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  await openOpeningPreview(page);
  const skipBefore = await advanceToOpeningMessage(page);
  await page.evaluate(() => {
    const player = window.__sakuraActiveInstall?.player ?? null;
    if (player) {
      player.configState.settings.skipMode = "read";
    }
  });
  const readSkipOn = await page.evaluate(() => window.sakuraToggleSkip?.());
  assert.deepEqual(readSkipOn, { autoMode: 0, skipMode: 1 });
  await page.waitForTimeout(700);
  assert.equal(
    await currentEventCount(page),
    skipBefore,
    "read-only skip advanced unread messages",
  );
  const readSkipOff = await page.evaluate(() => window.sakuraToggleSkip?.());
  assert.deepEqual(readSkipOff, { autoMode: 0, skipMode: 0 });

  await page.evaluate(() => {
    const player = window.__sakuraActiveInstall?.player ?? null;
    if (player) {
      player.configState.settings.skipMode = "all";
    }
  });
  const skipOn = await page.evaluate(() => window.sakuraToggleSkip?.());
  assert.deepEqual(skipOn, { autoMode: 0, skipMode: 1 });
  await page.waitForTimeout(1800);
  const skipAfter = await currentEventCount(page);
  assert.ok(
    skipAfter >= skipBefore + 10,
    `skip did not advance enough messages: before=${skipBefore} after=${skipAfter}`,
  );
  const skipOff = await page.evaluate(() => window.sakuraToggleSkip?.());
  assert.deepEqual(skipOff, { autoMode: 0, skipMode: 0 });
  const held = await currentEventCount(page);
  await page.waitForTimeout(300);
  assert.equal(await currentEventCount(page), held, "skip kept advancing after toggled off");

  await openOpeningPreview(page);
  const keySkipBefore = await advanceToOpeningMessage(page);
  await page.evaluate(() => {
    const player = window.__sakuraActiveInstall?.player ?? null;
    if (player) {
      player.configState.settings.skipMode = "all";
    }
  });
  await page.keyboard.down("Control");
  await page.waitForTimeout(1800);
  const keySkipHeld = await currentEventCount(page);
  assert.ok(
    keySkipHeld >= keySkipBefore + 10,
    `held Ctrl skip did not advance enough messages: before=${keySkipBefore} after=${keySkipHeld}`,
  );
  await page.keyboard.up("Control");
  const keySkipReleased = await currentEventCount(page);
  await page.waitForTimeout(300);
  assert.equal(
    await currentEventCount(page),
    keySkipReleased,
    "held Ctrl skip kept advancing after keyup",
  );
  const modesAfterKeyup = await page.evaluate(() => {
    const state = window.__sakuraActiveInstall?.player?.safeState ?? {};
    return {
      autoMode: state.autoMode ?? -1,
      skipMode: state.skipMode ?? -1,
    };
  });
  assert.deepEqual(modesAfterKeyup, { autoMode: 0, skipMode: 0 });

  await openOpeningPreview(page);
  const autoBefore = await advanceToOpeningMessage(page);
  const autoOn = await page.evaluate(() => window.sakuraToggleAuto?.());
  assert.deepEqual(autoOn, { autoMode: 1, skipMode: 0 });
  await page.waitForTimeout(5000);
  const autoAfter = await currentEventCount(page);
  assert.ok(
    autoAfter >= autoBefore + 1,
    `auto did not advance: before=${autoBefore} after=${autoAfter}`,
  );
  await page.evaluate(() => window.sakuraAdvanceScenario?.());
  const modesAfterManualInput = await page.evaluate(() => {
    const state = window.__sakuraActiveInstall?.player?.safeState ?? {};
    return {
      autoMode: state.autoMode ?? -1,
      skipMode: state.skipMode ?? -1,
    };
  });
  assert.deepEqual(modesAfterManualInput, { autoMode: 0, skipMode: 0 });

  await openOpeningPreview(page);
  await advanceToOpeningMessage(page);
  const voiceCarryOn = await page.evaluate(() => {
    const player = window.__sakuraActiveInstall?.player ?? null;
    if (!player?.audioMixer) return { ok: 0, calls: -1, stopped: -1 };
    const original = player.audioMixer.stopVoices;
    let calls = 0;
    player.audioMixer.stopVoices = () => { calls += 1; return true; };
    player.configState.settings.carryVoiceOnClick = true;
    window.sakuraAdvanceScenario?.();
    player.audioMixer.stopVoices = original;
    return {
      ok: 1,
      calls,
      stopped: player.safeState.voiceStoppedOnClick ?? -1,
    };
  });
  assert.deepEqual(voiceCarryOn, { ok: 1, calls: 0, stopped: 0 });

  await openOpeningPreview(page);
  await advanceToOpeningMessage(page);
  const voiceCarryOff = await page.evaluate(() => {
    const player = window.__sakuraActiveInstall?.player ?? null;
    if (!player?.audioMixer) return { ok: 0, calls: -1, stopped: -1 };
    const original = player.audioMixer.stopVoices;
    let calls = 0;
    player.audioMixer.stopVoices = () => { calls += 1; return true; };
    player.configState.settings.carryVoiceOnClick = false;
    window.sakuraAdvanceScenario?.();
    player.audioMixer.stopVoices = original;
    return {
      ok: 1,
      calls,
      stopped: player.safeState.voiceStoppedOnClick ?? -1,
    };
  });
  assert.deepEqual(voiceCarryOff, { ok: 1, calls: 1, stopped: 1 });

  await openOpeningPreview(page);
  await advanceToOpeningMessage(page);
  assert.deepEqual(await page.evaluate(() => window.sakuraToggleAuto?.()), { autoMode: 1, skipMode: 0 });
  const modesAfterBacklogOpen = await page.evaluate(() => {
    const player = window.__sakuraActiveInstall?.player ?? null;
    player?.openBacklog?.();
    const state = player?.safeState ?? {};
    return {
      autoMode: state.autoMode ?? -1,
      skipMode: state.skipMode ?? -1,
      backlogOpen: state.backlogOpen ?? -1,
    };
  });
  assert.deepEqual(modesAfterBacklogOpen, { autoMode: 0, skipMode: 0, backlogOpen: 1 });

  console.log("scenario_auto_skip=ok");
} finally {
  await browser?.close().catch(() => {});
  server.kill("SIGTERM");
  await once(server, "exit").catch(() => {});
}

async function openOpeningPreview(page) {
  await page.goto(
    `http://127.0.0.1:${port}/?scenarioPreview=1&scenarioName=00_op_01&noauto=1`,
    { waitUntil: "load", timeout: 20_000 },
  );
  await page.waitForFunction(
    () => document.documentElement.dataset.runtimeReady === "1",
    { timeout: 20_000 },
  );
}

async function advanceToOpeningMessage(page) {
  for (let index = 0; index < 21; index += 1) {
    await page.evaluate(() => window.sakuraAdvanceScenario?.());
    await page.waitForTimeout(15);
  }
  return await currentEventCount(page);
}

async function currentEventCount(page) {
  return await page.evaluate(() => (
    window.__sakuraActiveInstall?.player?.event?.eventCount ?? -1
  ));
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for local server\n${output}`);
}
