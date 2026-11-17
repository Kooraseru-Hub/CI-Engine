"use strict";
const fs = require("node:fs");
const path = require("node:path");
function syncInputs(root, check = false) {
  const config = JSON.parse(fs.readFileSync(path.join(root, "config/ci/operations.json"), "utf8"));
  const names = Object.entries(config.operations).filter(([, op]) => op.events.includes("workflow_dispatch")).map(([name]) => name).sort();
  if (!names.length || names.some(name => !/^[a-z][a-z0-9-]*$/.test(name))) throw new Error("Invalid manual operation inventory");
  const file = path.join(root, ".github/workflows/manual.yml");
  const source = fs.readFileSync(file, "utf8");
  const block = /^      operation:\s*\n(?:        [^\n]*\n)*?        options:\s*\n(?:          - [^\n]*\n)+/m;
  const match = source.match(block);
  if (!match) throw new Error("Expected a manual operation dropdown");
  const selected = match[0].match(/^        default:\s*([a-z][a-z0-9-]*)\s*$/m)?.[1];
  if (!selected || !names.includes(selected)) throw new Error("Manual operation default is not an available operation");
  const next = source.replace(block, match[0].replace(/(?:^          - [^\n]*\n)+/m, names.map(name => "          - " + name).join("\n") + "\n"));
  if (next !== source) {
    if (check) throw new Error("Manual operation choices are stale; run CI Engine sync-inputs");
    fs.writeFileSync(file, next);
  }
}
module.exports = { syncInputs };
