"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const nativeRoot = path.join(__dirname, "src/native");
const loader = "dependencies/packages/core/dependencyLoader/index.ts";
function execute(program, values) {
  const result = spawnSync(program, values, { stdio: "inherit", cwd: process.cwd(), windowsHide: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
async function main() {
  const command = args[0];
  const scripts = {
    "native-validate": "run.sh",
    "native-test": "test.sh",
    "native-lint": "bootstrap/check-workflows.sh",
    "native-logged": "github/workflows/run-logged.sh",
  };
  if (Object.hasOwn(scripts, command)) {
    execute("bash", [path.join(nativeRoot, scripts[command]), ...args.slice(1)]);
  } else if (command === "native" || command === "native-plan") {
    const target = command === "native" ? "entry.luau" : "bootstrap/deliveryPlan.luau";
    execute(process.execPath, [loader, "--exec", "luau.lute", "run", path.join(nativeRoot, target), ...args.slice(1)]);
  } else if (command === "component-script") {
    const renderer = args[1];
    if (!renderer || !/^\.github\/components\/[a-zA-Z0-9/_-]+\.cjs$/.test(renderer)) throw new Error("Expected a repository-owned native renderer");
    const root = fs.realpathSync(path.join(process.cwd(), ".github/components"));
    const file = fs.realpathSync(path.resolve(renderer));
    if (!file.startsWith(root + path.sep)) throw new Error("Native renderer escapes the component directory");
    execute(process.execPath, [file, ...args.slice(2)]);
  } else if (command === "sync-workflow") {
    require("./src/adapters/local/workflow.cjs").syncWorkflow(process.cwd(), __dirname, args.includes("--check"));
  } else if (command === "sync-inputs") {
    require("./src/adapters/local/inputs.cjs").syncInputs(process.cwd(), args.includes("--check"));
  } else {
    if (command === "run") {
      args.shift();
      if (args[0] && !args[0].startsWith("-")) args.splice(0, 1, "--input", "operation=" + args[0]);
    }
    process.exitCode = await require("./src/adapters/local/run.cjs").main(args);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
