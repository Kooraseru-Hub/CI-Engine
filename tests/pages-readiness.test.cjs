"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/bootstrap.yml"), "utf8");

function stepScript(name) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.indexOf("      - name: " + name);
  assert.ok(start !== -1, name + " step is missing");
  let reading = false;
  const script = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("      - name: ")) break;
    if (reading) {
      if (lines[i] !== "" && !lines[i].startsWith("          ")) break;
      script.push(lines[i].slice(10));
    } else if (lines[i] === "        run: |") reading = true;
  }
  assert.ok(script.length > 0, name + " is missing shell code");
  return script.join("\n");
}

function exercise(t, visibleAfter, artifactId = "12345", failFirst = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pages-ready-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const count = path.join(dir, "calls");
  fs.writeFileSync(path.join(dir, "gh"), [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "case \"$*\" in *\"repos/test/repo/actions/runs/22/artifacts?per_page=100\"*) ;; *) exit 31 ;; esac",
    "case \"$*\" in *\".id == 12345\"*) ;; *) exit 32 ;; esac",
    'count=0; if [[ -f "$MOCK_COUNT" ]]; then count=$(cat "$MOCK_COUNT"); fi',
    'count=$((count + 1)); echo "$count" > "$MOCK_COUNT"',
    'if [[ "$MOCK_FAIL_FIRST" == true && "$count" == 1 ]]; then exit 1; fi',
    'if (( count >= MOCK_VISIBLE_AFTER )); then echo "$PAGES_ARTIFACT_ID"; fi',
    "",
  ].join("\n"), { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "sleep"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  const result = spawnSync("bash", ["-c", stepScript("Await Pages artifact visibility")], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      ...process.env,
      PATH: dir + path.delimiter + process.env.PATH,
      GH_TOKEN: "test-token",
      PAGES_ARTIFACT_ID: artifactId,
      GITHUB_REPOSITORY: "test/repo",
      GITHUB_RUN_ID: "22",
      MOCK_COUNT: count,
      MOCK_VISIBLE_AFTER: String(visibleAfter),
      MOCK_FAIL_FIRST: String(failFirst),
    },
  });
  return { ...result, calls: fs.existsSync(count) ? Number(fs.readFileSync(count, "utf8")) : 0 };
}

test("Pages deployment waits for the exact ID uploaded by upload-pages-artifact", () => {
  const uploadIndex = workflow.indexOf("      - name: Upload Pages artifact");
  const readinessIndex = workflow.indexOf("      - name: Await Pages artifact visibility");
  const deployIndex = workflow.indexOf("      - name: Deploy Pages");
  assert.ok(uploadIndex >= 0 && uploadIndex < readinessIndex && readinessIndex < deployIndex);
  assert.match(workflow.slice(uploadIndex, readinessIndex), /id: pages_artifact/);
  assert.match(workflow.slice(readinessIndex, deployIndex), /steps\.pages_artifact\.outputs\.artifact_id/);
  assert.match(workflow.slice(readinessIndex, deployIndex), /GH_TOKEN:.*github\.token/);
});

test("Pages readiness retries missing artifacts and transient query failures", t => {
  const attempt = exercise(t, 3, "12345", true);
  assert.equal(attempt.status, 0, attempt.stderr);
  assert.equal(attempt.calls, 3);
  assert.match(attempt.stdout, /is visible to the Actions API/);
});

test("Pages readiness fails closed when artifact remains invisible", t => {
  const attempt = exercise(t, 99);
  assert.equal(attempt.status, 1, attempt.stdout + attempt.stderr);
  assert.equal(attempt.calls, 6);
  assert.match(attempt.stdout, /not visible before the retry limit/);
});

test("Pages readiness rejects malformed IDs without querying the API", t => {
  const attempt = exercise(t, 1, "oops");
  assert.equal(attempt.status, 1);
  assert.equal(attempt.calls, 0);
  assert.match(attempt.stdout, /did not return a valid artifact ID/);
});


test("Pages publication uses Node 24 action versions with the locked transitive uploader", () => {
  const lock = fs.readFileSync(path.join(__dirname, "../.github/workflows/actions.lock"), "utf8");
  assert.match(workflow, /uses: actions\/upload-pages-artifact@v5/);
  assert.match(workflow, /uses: actions\/deploy-pages@v5/);
  assert.match(lock, /actions\/upload-pages-artifact@v5/);
  assert.match(lock, /actions\/deploy-pages@v5/);
  assert.match(lock, /actions\/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f/);
  assert.doesNotMatch(lock, /actions\/(?:upload-pages-artifact|deploy-pages)@v4|ea165f8d65b6e75b540449e92b4886f43607fa02/);
});
