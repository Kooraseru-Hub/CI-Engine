"use strict";
const fs = require("node:fs");
const path = require("node:path");

const PIN = /^\s*uses:\s+(?<repository>[\w.-]+\/[\w.-]+)\/\.github\/workflows\/(?<workflow>[\w.-]+\.ya?ml)@(?<sha>[a-f0-9]{40})(?:[ \t]+#[^\r\n]*)?[ \t]*$/gm;
function prepareStagedWorkflow(file, packageRoot, entry = "manual.yml") {
  const source = fs.readFileSync(file, "utf8");
  const matches = [...source.matchAll(PIN)];
  if (matches.length !== 1) throw new Error("Expected exactly one pinned reusable CI Engine workflow");
  const { repository, workflow, sha } = matches[0].groups;
  const revision = JSON.parse(fs.readFileSync(path.join(packageRoot, ".dependency-revision.json"), "utf8"));
  if (revision.repository !== repository || revision.sha !== sha || revision.workflow !== workflow)
    throw new Error("Managed engine revision does not match bootstrap; rerun dependency setup");
  const workspace = path.resolve(path.dirname(file), "../..");
  const stage = path.join(workspace, ".ci-engine-act");
  if (fs.existsSync(stage)) throw new Error("Unexpected staged engine directory");
  fs.cpSync(packageRoot, stage, { recursive: true });
  let engine = fs.readFileSync(path.join(packageRoot, ".github/workflows", workflow), "utf8");
  if (!/^\s*(?:-\s*)?uses:\s*\$\//m.test(engine)) throw new Error("Engine workflow has no action self-reference");
  engine = engine.replace(/^(\s*(?:-\s*)?uses:\s*)\$\/([\w./-]*)\s*$/gm,
    (_, prefix, directory) => prefix + "./.ci-engine-act" + (directory ? "/" + directory : ""));
  engine = engine.replaceAll("actions/upload-artifact@v7", "actions/upload-artifact@v4")
    .replaceAll("actions/download-artifact@v8", "actions/download-artifact@v4");
  const name = "_act-ci-engine.yml";
  fs.writeFileSync(path.join(path.dirname(file), name), engine);
  fs.writeFileSync(path.join(path.dirname(file), "_act-bootstrap.yml"), source.replace(matches[0][0].trim(), "uses: ./.github/workflows/" + name));
  const caller = path.join(path.dirname(file), entry);
  const reference = "uses: ./.github/workflows/" + path.basename(file);
  const body = fs.readFileSync(caller, "utf8");
  if (!body.includes(reference)) throw new Error("Caller does not use the authoritative bootstrap");
  fs.writeFileSync(path.join(path.dirname(file), "_act-entry.yml"), body.replaceAll(reference, "uses: ./.github/workflows/_act-bootstrap.yml"));
  return true;
}
module.exports = { prepareStagedWorkflow };
