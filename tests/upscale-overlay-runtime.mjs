import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const outputDir = new URL("../output/playwright/engine-management-runtime/", import.meta.url);
mkdirSync(outputDir, { recursive: true });
const jsonPath = new URL("left-ctrl-engine-manager.json", outputDir);
const cloudStateDir = mkdtempSync(join(tmpdir(), "sakura-engine-manager-cloud-"));

try {
  const result = spawnSync(
    "node",
    [
      "tools/boot-runtime.mjs",
      "--port",
      "8821",
      "--json",
      jsonPath.pathname,
      "--timeout-ms",
      "120000",
      "--post-ready-ms",
      "500",
      "--advance-until-event",
      "5",
      "--press-left-ctrl",
      "--engine-manager-click-smoke",
      "--cloud-state-smoke",
    ],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        SAKURA_CLOUD_STATE_DIR: cloudStateDir,
      },
      encoding: "utf8",
      timeout: 150_000,
    },
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const boot = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.equal(boot.ready, true);
  assert.equal(boot.state.runtimeError, null);
  assert.equal(boot.pressedLeftCtrl.managerPresent, true);
  assert.equal(boot.pressedLeftCtrl.managerOpen, true);
  assert.equal(boot.pressedLeftCtrl.activeTab, "cloud");
  assert.deepEqual(boot.pressedLeftCtrl.tabLabels, ["Cloud", "Progress", "System", "Upscale"]);
  assert.equal(boot.pressedLeftCtrl.scenarioConfigOpen, false);
  assert.equal(boot.pressedLeftCtrl.safeConfigOpen, 0);
  assert.equal(boot.state.engineManager.present, true);
  assert.equal(boot.state.engineManager.open, true);
  assert.equal(boot.state.engineManager.activeTab, "cloud");
  assert.equal(boot.state.scenarioConfig.open, false);
  assert.equal(boot.state.scenarioConfig.safeOpen, 0);
  assert.equal(boot.state.canvas.width, 1280);
  assert.equal(boot.state.canvas.height, 720);
  assert.equal(boot.engineManagerClick.before.open, true);
  assert.equal(boot.engineManagerClick.cloudSaveClicked, true);
  assert.equal(boot.engineManagerClick.saveSettled, true);
  assert.match(boot.engineManagerClick.afterCloudSave.statusText, /^Saved \d+ keys$/);
  assert.equal(boot.engineManagerClick.progressTabClicked, true);
  assert.equal(boot.engineManagerClick.afterProgressTab.activeTab, "progress");
  assert.equal(boot.engineManagerClick.closeClicked, true);
  assert.equal(boot.engineManagerClick.afterClose.open, false);
  assert.equal(boot.engineManagerClick.final.open, true);
  assert.equal(boot.cloudState.save.ok, true);
  assert.equal(boot.cloudState.load.ok, true);
  assert.equal(boot.cloudState.beforeLoad.progress, "changed");
  assert.equal(boot.cloudState.beforeLoad.extra, "remove-me");
  assert.equal(boot.cloudState.afterLoad.progress, "saved");
  assert.equal(boot.cloudState.afterLoad.extra, null);
} finally {
  rmSync(cloudStateDir, { recursive: true, force: true });
}

console.log("engine_management_runtime=ok");
