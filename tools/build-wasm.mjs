import { copyFile, mkdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "target/wasm32-unknown-unknown/release/sakura_core.wasm");
const out = resolve(root, "web/pkg/sakura_core.wasm");

try {
  execFileSync(
    "cargo",
    ["build", "-p", "sakura-core", "--target", "wasm32-unknown-unknown", "--release"],
    { cwd: root, stdio: "inherit" },
  );
  await stat(target);
  await mkdir(dirname(out), { recursive: true });
  await copyFile(target, out);
  console.log(`wasm=${out}`);
} catch (error) {
  if (error?.code === "ENOENT") {
    console.error("missing cargo or wasm32-unknown-unknown target");
  }
  throw error;
}
