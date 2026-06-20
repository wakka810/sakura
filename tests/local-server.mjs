import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const port = 9787 + Math.floor(Math.random() * 1000);
const installDir = await mkdtemp(join(tmpdir(), "sakura-install-"));
const upscaleCacheDir = await mkdtemp(join(tmpdir(), "sakura-upscale-cache-"));
const cloudStateDir = await mkdtemp(join(tmpdir(), "sakura-cloud-state-"));
const fontDir = await mkdtemp(join(tmpdir(), "sakura-fonts-"));
await writeFile(join(installDir, "BGI.exe"), new Uint8Array([0x4d, 0x5a]));
await writeFile(join(installDir, "BGI.gdb"), bytes("BURIKO GDB 3.00\0fixture"));
await writeFile(join(installDir, "synthetic.arc"), buildArc20([
  ["fixture.bin", new Uint8Array([1, 2, 3, 4, 5])],
]).data);
await writeFile(join(fontDir, "msgothic.ttc"), new Uint8Array([0, 1, 2, 3]));
await writeFile(join(fontDir, "msmincho.ttc"), new Uint8Array([4, 5, 6, 7]));

const server = spawn(process.execPath, ["tools/local-server.mjs"], {
  cwd: resolve("."),
  env: {
    ...process.env,
    SAKURA_PORT: String(port),
    SAKURA_HOST: "127.0.0.1",
    SAKURA_INSTALL_DIR: installDir,
    SAKURA_UPSCALE_CACHE_DIR: upscaleCacheDir,
    SAKURA_CLOUD_STATE_DIR: cloudStateDir,
    SAKURA_MS_GOTHIC_FONT: join(fontDir, "msgothic.ttc"),
    SAKURA_MS_MINCHO_FONT: join(fontDir, "msmincho.ttc"),
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

try {
  await waitFor(() => output.includes("sakura_local_server=ready"), 15_000);
  if (!output.includes(`url=http://127.0.0.1:${port}/`)) {
    throw new Error(`server did not advertise localhost URL\n${output}`);
  }
  const catalogResponse = await fetch(`http://127.0.0.1:${port}/api/install/catalog`);
  if (!catalogResponse.ok) {
    throw new Error(`catalog request failed ${catalogResponse.status}`);
  }
  const catalog = await catalogResponse.json();
  if (
    catalog.version !== 1
    || catalog.exeCount !== 1
    || catalog.archiveCount !== 1
    || catalog.sidecarCount !== 1
  ) {
    throw new Error(`unexpected catalog summary ${JSON.stringify({
      version: catalog.version,
      exeCount: catalog.exeCount,
      archiveCount: catalog.archiveCount,
      sidecarCount: catalog.sidecarCount,
    })}`);
  }
  const first = catalog.archives.find((archive) => archive.entries.length > 0);
  if (!first) {
    throw new Error("server catalog has no entries");
  }
  if (typeof first.nameHex !== "string" || first.nameHex.length === 0) {
    throw new Error("server catalog archive basename is missing");
  }
  const firstEntry = first.entries[0];
  const payloadResponse = await fetch(
    `http://127.0.0.1:${port}/api/install/payload?archive=${firstEntry.archiveIndex}&entry=${firstEntry.entryIndex}&offset=0&length=${Math.min(firstEntry.size, 16)}`,
  );
  if (!payloadResponse.ok) {
    throw new Error(`payload request failed ${payloadResponse.status}`);
  }
  const payload = new Uint8Array(await payloadResponse.arrayBuffer());
  if (payload.byteLength !== Math.min(firstEntry.size, 16)) {
    throw new Error("payload length mismatch");
  }
  const archivePayloadResponse = await fetch(
    `http://127.0.0.1:${port}/api/install/payload?archive=0&offset=0&length=16`,
  );
  if (!archivePayloadResponse.ok) {
    throw new Error(`archive payload request failed ${archivePayloadResponse.status}`);
  }
  const archivePayload = new Uint8Array(await archivePayloadResponse.arrayBuffer());
  if (new TextDecoder("ascii").decode(archivePayload.slice(0, 12)) !== "BURIKO ARC20") {
    throw new Error("archive basename payload fetch returned wrong bytes");
  }
  const sidecarPayloadResponse = await fetch(
    `http://127.0.0.1:${port}/api/install/sidecar?sidecar=0&offset=0&length=15`,
  );
  if (!sidecarPayloadResponse.ok) {
    throw new Error(`sidecar payload request failed ${sidecarPayloadResponse.status}`);
  }
  const sidecarPayload = new Uint8Array(await sidecarPayloadResponse.arrayBuffer());
  if (new TextDecoder("ascii").decode(sidecarPayload) !== "BURIKO GDB 3.00") {
    throw new Error("sidecar payload fetch returned wrong bytes");
  }
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  if (!html.includes("Sakura BGI Browser Runtime")) {
    throw new Error("static runtime page missing");
  }
  const fontStatus = await (await fetch(`http://127.0.0.1:${port}/api/fonts/status`)).json();
  if (
    fontStatus.faces?.["ms-gothic"]?.found !== true
    || fontStatus.faces?.["ms-mincho"]?.found !== true
    || fontStatus.faces?.["ms-gothic"]?.basename !== "msgothic.ttc"
    || fontStatus.faces?.["ms-mincho"]?.basename !== "msmincho.ttc"
  ) {
    throw new Error(`unexpected font status ${JSON.stringify(fontStatus)}`);
  }
  const gothicFont = new Uint8Array(
    await (await fetch(`http://127.0.0.1:${port}/api/fonts/ms-gothic`)).arrayBuffer(),
  );
  if (gothicFont.byteLength !== 4 || gothicFont[1] !== 1) {
    throw new Error("gothic font endpoint returned wrong bytes");
  }
  const missingCloud = await fetch(`http://127.0.0.1:${port}/api/cloud-state`);
  if (missingCloud.status !== 404) {
    throw new Error(`missing cloud state returned ${missingCloud.status}`);
  }
  const cloudPayload = {
    version: 1,
    savedAt: "2026-06-18 12:00:00",
    origin: `http://127.0.0.1:${port}`,
    localStorage: {
      "sakura.session.slot.0": "slot-data",
      "sakura.config.v1": JSON.stringify({ version: 1 }),
      "external.key": "mirrored",
    },
  };
  const cloudSave = await fetch(`http://127.0.0.1:${port}/api/cloud-state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cloudPayload),
  });
  if (!cloudSave.ok) {
    throw new Error(`cloud save failed ${cloudSave.status}: ${await cloudSave.text()}`);
  }
  const cloudSaveBody = await cloudSave.json();
  if (cloudSaveBody.metadata?.keyCount !== 3 || cloudSaveBody.metadata?.byteLength <= 0) {
    throw new Error(`unexpected cloud save metadata ${JSON.stringify(cloudSaveBody)}`);
  }
  const cloudLoad = await (await fetch(`http://127.0.0.1:${port}/api/cloud-state`)).json();
  if (
    cloudLoad.version !== 1
    || cloudLoad.localStorage?.["sakura.session.slot.0"] !== "slot-data"
    || cloudLoad.localStorage?.["external.key"] !== "mirrored"
    || cloudLoad.metadata?.keyCount !== 3
  ) {
    throw new Error(`unexpected cloud load ${JSON.stringify(cloudLoad)}`);
  }
  const invalidCloud = await fetch(`http://127.0.0.1:${port}/api/cloud-state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: 1, localStorage: { bad: 1 } }),
  });
  if (invalidCloud.status !== 400) {
    throw new Error(`invalid cloud state returned ${invalidCloud.status}`);
  }
  const upscaleCapabilities = await (await fetch(`http://127.0.0.1:${port}/api/upscale/capabilities`)).json();
  if (
    upscaleCapabilities.defaultScale !== 2
    || upscaleCapabilities.cache?.kind !== "ram+disk"
    || upscaleCapabilities.cache?.diskPath !== upscaleCacheDir
    || !upscaleCapabilities.supportedScales.includes(2)
  ) {
    throw new Error(`unexpected upscale capabilities ${JSON.stringify(upscaleCapabilities)}`);
  }
  const safeRuntime = await import("../web/safe-summary.js");
  const safeSummary = safeRuntime.safeInstallSummary({
    arcCount: 1,
    localRuntimeAudioQueued: 7,
    localRuntimeAudioPrepareErrors: 1,
    localRuntimeAudioPostErrors: 2,
    localRuntimeAudioPostStage: 3,
    localRuntimeAudioScheduleErrors: 1,
    localRuntimeAudioFinalizeVersion: 2,
    localRuntimeAudioProbeOggBytes: 123,
    localSystemRuntimeNotifyErrors: 3,
    localSystemRuntimeEntryGraphQueueRecorded: 4,
    localSystemRuntimeEntryGraphQueueFirstId: 0x68,
    localSystemRuntimeReady: 1,
    localSystemRuntimeHostServiceCount: 38,
    localSystemUserScriptDispatchTop: "ff:1",
  });
  if (
    safeSummary.arcCount !== 1 ||
    safeSummary.localRuntimeAudioQueued !== 7 ||
    safeSummary.localRuntimeAudioPrepareErrors !== 1 ||
    safeSummary.localRuntimeAudioPostErrors !== 2 ||
    safeSummary.localRuntimeAudioPostStage !== 3 ||
    safeSummary.localRuntimeAudioScheduleErrors !== 1 ||
    safeSummary.localRuntimeAudioFinalizeVersion !== 2 ||
    safeSummary.localRuntimeAudioProbeOggBytes !== 123 ||
    safeSummary.localSystemRuntimeNotifyErrors !== 3 ||
    safeSummary.localSystemRuntimeEntryGraphQueueRecorded !== 4 ||
    safeSummary.localSystemRuntimeEntryGraphQueueFirstId !== 0x68 ||
    safeSummary.localSystemRuntimeReady !== 1 ||
    safeSummary.localSystemRuntimeHostServiceCount !== 38 ||
    Object.hasOwn(safeSummary, "localSystemUserScriptDispatchTop")
  ) {
    throw new Error(`unexpected safe summary ${JSON.stringify(safeSummary)}`);
  }
  await readFile("web/pkg/sakura_core.wasm");
  console.log("local_server_smoke=ok");
} finally {
  server.kill("SIGTERM");
  await once(server, "exit").catch(() => {});
  await rm(installDir, { recursive: true, force: true });
  await rm(upscaleCacheDir, { recursive: true, force: true });
  await rm(cloudStateDir, { recursive: true, force: true });
  await rm(fontDir, { recursive: true, force: true });
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

function buildArc20(files) {
  const headerLength = 16;
  const entryLength = 128;
  const nameLength = 96;
  const prefixLength = headerLength + files.length * entryLength;
  const payloadLength = files.reduce((total, [, payload]) => total + payload.byteLength, 0);
  const data = new Uint8Array(prefixLength + payloadLength);
  const view = new DataView(data.buffer);
  data.set(bytes("BURIKO ARC20"), 0);
  view.setUint32(12, files.length, true);

  let payloadOffset = 0;
  for (const [index, [name, payload]] of files.entries()) {
    const entryOffset = headerLength + index * entryLength;
    data.set(bytes(name), entryOffset);
    view.setUint32(entryOffset + nameLength, payloadOffset, true);
    view.setUint32(entryOffset + nameLength + 4, payload.byteLength, true);
    data.set(payload, prefixLength + payloadOffset);
    payloadOffset += payload.byteLength;
  }

  return { data };
}

function bytes(value) {
  return new TextEncoder().encode(value);
}
