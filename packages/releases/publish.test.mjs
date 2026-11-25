import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { publish } from "./publish.mjs";

const repository = "fixture/project";
const commit = "a".repeat(40);
const digest = "sha256:" + createHash("sha256").update("artifact").digest("hex");
async function fixture(t, policy = "skip") {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "release-publish-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, "stage"));
  await writeFile(path.join(cwd, "stage/notes.md"), "Authored notes");
  await writeFile(path.join(cwd, "stage/file.zip"), "artifact");
  const record = { onExisting: policy, releases: [{
    tag: "1.0.0", commit, prerelease: false, notes: "notes.md",
    assets: [{ name: "file.zip", path: "stage/file.zip", digest }]
  }] };
  const save = () => writeFile(path.join(cwd, "stage/index.json"), JSON.stringify(record));
  await save();
  return { cwd, record, save, run: options => publish("stage/index.json", repository, { cwd, ...options }) };
}

function mock({ existing = false, badUpload = false, immutable = false } = {}) {
  const calls = [];
  const response = (status, data = null) => ({ status, data });
  return { calls, io: {
    async request(method, route, body) {
      calls.push({ method, route, body });
      if (method === "GET" && route.includes("/releases/tags/"))
        return existing ? response(200, { id: 10, draft: false, immutable }) : response(404);
      if (method === "GET" && route.includes("/git/ref/tags/"))
        return existing ? response(200, { object: { type: "commit", sha: commit } }) : response(404);
      if (method === "GET" && route.includes("/assets?"))
        return response(200, existing ? [{ id: 20, name: "file.zip", digest: "old", state: "uploaded" }] : []);
      if (method === "POST" && route.endsWith("/generate-notes"))
        return response(200, { body: "Generated notes" });
      if (method === "POST" && route.endsWith("/releases")) return response(201, { id: 10 });
      if (method === "PATCH" && route.endsWith("/releases/10")) return response(200, { id: 10 });
      if (method === "DELETE" && route.endsWith("/assets/20")) return response(204);
      if (method === "PATCH" && route.endsWith("/assets/21")) return response(200, { id: 21 });
      throw new Error("Unexpected call " + method + " " + route);
    },
    async upload(repo, releaseId, name, bytes) {
      calls.push({ method: "UPLOAD", repo, releaseId, name, bytes: bytes.toString() });
      return { id: 21, digest: badUpload ? "wrong" : digest, state: "uploaded" };
    }
  } };
}

test("rehearsal and corrupt artifacts never call a remote", async t => {
  const f = await fixture(t);
  const m = mock();
  assert.deepEqual(await f.run({ io: m.io }), { releases: 1, assets: 1, published: 0, rehearsal: true });
  await writeFile(path.join(f.cwd, "stage/file.zip"), "tampered");
  await assert.rejects(f.run({ confirm: true, io: m.io }), /checksum mismatch/);
  assert.deepEqual(m.calls, []);
});

test("publishes a verified draft then finalizes it; historical notes use recorded source", async t => {
  const f = await fixture(t);
  f.record.releases[0].previousTag = "0.9.0";
  await f.save();
  const m = mock();
  const result = await f.run({ confirm: true, io: m.io });
  assert.equal(result.published, 1);
  assert.deepEqual(result.publishedTags, ["1.0.0"]);
  const create = m.calls.find(c => c.method === "POST" && c.route.endsWith("/releases"));
  assert.equal(create.body.target_commitish, commit);
  assert.equal(create.body.body, "Authored notes\n\nGenerated notes");
  assert.equal(create.body.draft, true);
  assert.equal(m.calls.at(-2).method, "UPLOAD");
  assert.deepEqual(m.calls.at(-1).body, { draft: false });
});

test("skip, fail and immutable replace never mutate existing releases", async t => {
  for (const policy of ["skip", "fail", "replace"]) {
    const f = await fixture(t, policy);
    const m = mock({ existing: true, immutable: true });
    if (policy === "skip") assert.equal((await f.run({ confirm: true, io: m.io })).published, 0);
    else await assert.rejects(f.run({ confirm: true, io: m.io }), /already exists|immutable/);
    assert.ok(m.calls.every(c => c.method === "GET"));
  }
});

test("replacement is verified before old asset deletion", async t => {
  const f = await fixture(t, "replace");
  const m = mock({ existing: true });
  await f.run({ confirm: true, io: m.io });
  const upload = m.calls.findIndex(c => c.method === "UPLOAD");
  assert.match(m.calls[upload].name, /^file\.zip\.ci-/);
  assert.equal(m.calls[upload + 1].method, "DELETE");
  assert.deepEqual(m.calls[upload + 2].body, { name: "file.zip" });
  const bad = mock({ existing: true, badUpload: true });
  await assert.rejects(f.run({ confirm: true, io: bad.io }), /uploaded checksum/);
  assert.ok(!bad.calls.some(c => c.method === "DELETE"));
});
