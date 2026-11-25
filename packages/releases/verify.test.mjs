import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verify } from "./verify.mjs";

async function fixture(t, stage = "build/artifacts/releases") {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "ci-release-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const index = stage + "/index.json";
  const asset = stage + "/1.0.0/assets/library.zip";
  const notes = "1.0.0/notes.md";
  await mkdir(path.join(cwd, path.dirname(asset)), { recursive: true });
  await writeFile(path.join(cwd, stage, notes), "Release notes");
  await writeFile(path.join(cwd, asset), "artifact");
  const record = {
    onExisting: "skip",
    releases: [{
      tag: "1.0.0", commit: "a".repeat(40), notes,
      assets: [{
        name: "library.zip", path: asset,
        digest: "sha256:" + createHash("sha256").update("artifact").digest("hex")
      }]
    }]
  };
  const save = () => writeFile(path.join(cwd, index), JSON.stringify(record));
  await save();
  return { cwd, index, asset, record, save };
}

test("verifies Registry and Template staged layouts", async t => {
  for (const stage of ["build/artifacts/releases", "build/github/releases", "custom/output"]) {
    const f = await fixture(t, stage);
    assert.deepEqual(await verify(f.index, f.cwd), { releases: 1, assets: 1 });
  }
});

test("rejects altered artifact", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.cwd, f.asset), "tampered");
  await assert.rejects(verify(f.index, f.cwd), /checksum mismatch/);
});

test("rejects traversal and files outside the stage", async t => {
  const f = await fixture(t);
  const asset = f.record.releases[0].assets[0];
  asset.path = "../outside.zip";
  await f.save();
  await assert.rejects(verify(f.index, f.cwd), /safe relative path/);
  await writeFile(path.join(f.cwd, "outside.zip"), "artifact");
  asset.path = "outside.zip";
  await f.save();
  await assert.rejects(verify(f.index, f.cwd), /outside the staged/);
});

test("rejects duplicate tag and duplicate case-insensitive asset name", async t => {
  const f = await fixture(t);
  const release = f.record.releases[0];
  f.record.releases.push(structuredClone(release));
  await f.save();
  await assert.rejects(verify(f.index, f.cwd), /duplicate tag/);
  f.record.releases.pop();
  release.assets.push({ ...release.assets[0], name: "LIBRARY.ZIP" });
  await f.save();
  await assert.rejects(verify(f.index, f.cwd), /duplicate asset name/);
});

test("rejects symlink to an otherwise valid artifact", { skip: process.platform === "win32" }, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.cwd, "outside.zip"), "artifact");
  await rm(path.join(f.cwd, f.asset));
  await symlink(path.join(f.cwd, "outside.zip"), path.join(f.cwd, f.asset));
  await assert.rejects(verify(f.index, f.cwd), /symbolic links/);
});
