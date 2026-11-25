import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function fail(message) {
  throw new Error(message);
}

function relative(value, label) {
  if (typeof value !== "string" || !value || /[\\:\x00-\x1f\x7f]/.test(value) ||
      value.split("/").some(part => !part || part === "." || part === "..")) {
    fail(label + ": expected a safe relative path");
  }
  return value;
}

function within(root, file) {
  const rel = path.relative(root, file);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}

async function regularFile(root, name, label) {
  const parts = relative(name, label).split("/");
  let file = root;
  for (const [i, part] of parts.entries()) {
    file = path.join(file, part);
    const info = await lstat(file);
    if (info.isSymbolicLink() || (i === parts.length - 1 ? !info.isFile() : !info.isDirectory())) {
      fail(label + ": expected a regular file without symbolic links");
    }
  }
  return file;
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(label + ": expected an object");
  return value;
}

function policy(value, label) {
  if (!["skip", "fail", "replace"].includes(value)) fail(label + ": invalid conflict policy");
}

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return "sha256:" + hash.digest("hex");
}

export async function verify(indexName, cwd = process.cwd()) {
  const root = await realpath(cwd);
  const indexPath = await regularFile(root, indexName, "release index");
  const stage = path.dirname(indexPath);
  const index = object(JSON.parse(await readFile(indexPath, "utf8")), "release index");
  policy(index.onExisting, "release index");
  if (!Array.isArray(index.releases)) fail("release index: expected releases array");

  const tags = new Set();
  let assets = 0;
  for (const value of index.releases) {
    const entry = object(value, "release");
    const tag = entry.tag;
    if (typeof tag !== "string" || !tag || tags.has(tag)) fail("release: missing or duplicate tag");
    tags.add(tag);
    if (typeof entry.commit !== "string" || !/^[a-fA-F0-9]{40}$/.test(entry.commit)) {
      fail(tag + ": invalid source commit");
    }
    if (entry.onExisting !== undefined) policy(entry.onExisting, tag);
    if (entry.notes !== undefined) await regularFile(stage, entry.notes, tag + " notes");
    if (!Array.isArray(entry.assets)) fail(tag + ": expected assets array");
    const names = new Set();
    for (const value of entry.assets) {
      const asset = object(value, tag + " asset");
      const name = asset.name;
      if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$/.test(name) ||
          names.has(name.toLowerCase())) fail(tag + ": unsafe or duplicate asset name");
      names.add(name.toLowerCase());
      const file = await regularFile(root, asset.path, tag + " asset " + name);
      if (!within(stage, file)) fail(tag + ": asset is outside the staged release directory");
      if (typeof asset.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) ||
          await digest(file) !== asset.digest) fail(tag + ": asset checksum mismatch: " + name);
      assets++;
    }
  }
  return { releases: tags.size, assets };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--index") fail("Usage: node verify.mjs --index <relative-path>");
    const result = await verify(args[1]);
    console.log("Verified " + result.releases + " release(s) and " + result.assets + " asset(s).");
  } catch (error) {
    console.error("Release verification failed: " + error.message);
    process.exitCode = 1;
  }
}
