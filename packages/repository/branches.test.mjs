import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { publishBranches } from "./branches.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "branch-publish-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "staged");
  const remote = path.join(root, "remote.git");
  await mkdir(path.join(directory, "main"), { recursive: true });
  await mkdir(path.join(directory, "source"));
  await writeFile(path.join(directory, "main/README.md"), "First");
  await writeFile(path.join(directory, "source/README.md"), "Must not publish");
  git(root, "init", "--bare", remote);
  return { root, directory, remote, run: options => publishBranches(directory, { defaultBranch: "source", remote, ...options }) };
}

test("rehearsal validates candidates without contacting a remote", async t => {
  const f = await fixture(t);
  const result = await f.run({ remote: path.join(f.root, "missing") });
  assert.deepEqual(result.candidates, ["main", "source"]);
  assert.deepEqual(result.skipped, ["source"]);
  assert.equal(git(f.remote, "for-each-ref", "--format=%(refname)"), "");
});

test("creates orphan, skips default branch, preserves history and avoids redundant commits", async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.run({ confirm: true })).created, ["main"]);
  const first = git(f.remote, "rev-parse", "refs/heads/main");
  assert.equal(git(f.remote, "rev-list", "--count", first), "1");
  assert.equal(git(f.remote, "show", first + ":README.md"), "First");
  assert.equal(git(f.remote, "for-each-ref", "--format=%(refname)"), "refs/heads/main");
  assert.deepEqual((await f.run({ confirm: true })).unchanged, ["main"]);
  await writeFile(path.join(f.directory, "main/README.md"), "Second");
  assert.deepEqual((await f.run({ confirm: true })).updated, ["main"]);
  assert.equal(git(f.remote, "rev-parse", "refs/heads/main^"), first);
  assert.equal(git(f.remote, "show", "refs/heads/main:README.md"), "Second");
});

test("rejects embedded Git metadata and symlinks before any branch is written", { skip: process.platform === "win32" }, async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.directory, "source/.git"));
  await assert.rejects(f.run({ confirm: true }), /Unsafe generated entry/);
  await rm(path.join(f.directory, "source/.git"), { recursive: true });
  await symlink("/tmp", path.join(f.directory, "source/link"));
  await assert.rejects(f.run({ confirm: true }), /Unsafe generated entry/);
  assert.equal(git(f.remote, "for-each-ref", "--format=%(refname)"), "");
});

test("expected parent prevents overwriting a concurrent generated branch update",async t=>{
  const f=await fixture(t);
  await f.run({confirm:true});
  const old=git(f.remote,"rev-parse","refs/heads/main");
  await writeFile(path.join(f.directory,"main/README.md"),"Second");
  await f.run({confirm:true,expectedHeads:{main:old}});
  const head=git(f.remote,"rev-parse","refs/heads/main");
  await writeFile(path.join(f.directory,"main/README.md"),"Stale");
  await assert.rejects(f.run({confirm:true,expectedHeads:{main:old}}),/changed after preparation/);
  assert.equal(git(f.remote,"rev-parse","refs/heads/main"),head);
});
