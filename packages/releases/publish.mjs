import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verify } from "./verify.mjs";

function requireSuccess(response, operation) {
  if (response.status < 200 || response.status >= 300)
    throw new Error(operation + ": HTTP " + response.status);
  return response.data;
}

function checkUploaded(uploaded, asset) {
  if (!Number.isSafeInteger(uploaded?.id) || uploaded.digest !== asset.digest || uploaded.state !== "uploaded")
    throw new Error("GitHub did not confirm the uploaded checksum for " + asset.name);
}

function id(value) {
  if (!Number.isSafeInteger(value?.id) || value.id < 1) throw new Error("Invalid GitHub ID");
  return value.id;
}

function validateTag(tag) {
  execFileSync("git", ["check-ref-format", "refs/tags/" + tag], { stdio: "ignore" });
}

// Keep the existing asset until its replacement is uploaded and verified.
async function syncAssets(repo, releaseId, assets, io, cwd) {
  if (!assets.length) return;
  const prefix = "repos/" + repo + "/releases";
  const existing = new Map();
  for (let page = 1; ; page++) {
    const list = requireSuccess(await io.request("GET", prefix + "/" + releaseId + "/assets?per_page=100&page=" + page), "List assets");
    if (!Array.isArray(list)) throw new Error("Invalid asset list");
    for (const item of list) existing.set(item.name, item);
    if (list.length < 100) break;
  }
  for (const asset of assets) {
    const previous = existing.get(asset.name);
    if (previous?.digest === asset.digest && previous.state === "uploaded") continue;
    const temporary = asset.name + ".ci-" + asset.digest.slice(7);
    const pending = existing.get(temporary);
    const replacing = !!(previous || pending);
    const uploaded = pending || await io.upload(repo, releaseId, replacing ? temporary : asset.name, await readFile(path.join(cwd, asset.path)));
    checkUploaded(uploaded, asset);
    if (replacing) {
      if (previous) requireSuccess(await io.request("DELETE", prefix + "/assets/" + id(previous)), "Delete old verified replacement target");
      requireSuccess(await io.request("PATCH", prefix + "/assets/" + id(uploaded), { name: asset.name }), "Rename verified replacement asset");
    }
  }
}

async function publishEntry(repo, entry, policy, io, cwd, stage) {
  const prefix = "repos/" + repo;
  const tag = encodeURIComponent(entry.tag);
  const release = await io.request("GET", prefix + "/releases/tags/" + tag);
  const ref = await io.request("GET", prefix + "/git/ref/tags/" + tag);
  const existing = release.status === 404 ? null : requireSuccess(release, "Look up release");
  const reference = ref.status === 404 ? null : requireSuccess(ref, "Look up tag");
  if (existing || reference) {
    if (policy === "skip") return false;
    if (policy === "fail") throw new Error("Release/tag already exists: " + entry.tag);
    if (existing?.immutable) throw new Error("Cannot replace immutable release: " + entry.tag);
  }
  let body = entry.notes ? await readFile(path.join(stage, entry.notes), "utf8") : "";
  if (entry.previousTag) {
    const generated = requireSuccess(await io.request("POST", prefix + "/releases/generate-notes", {
      tag_name: entry.tag, target_commitish: entry.commit, previous_tag_name: entry.previousTag
    }), "Generate release notes");
    if (typeof generated.body !== "string") throw new Error("Invalid generated release notes");
    body += "\n\n" + generated.body;
  }
  if (reference) {
    let object = reference.object;
    for (let depth = 0; object?.type === "tag"; depth++) {
      if (depth >= 10 || !/^[a-f0-9]{40}$/i.test(object.sha)) throw new Error("Invalid annotated tag chain");
      object = requireSuccess(await io.request("GET", prefix + "/git/tags/" + object.sha), "Resolve annotated tag").object;
    }
    if (object?.type !== "commit" || !/^[a-f0-9]{40}$/i.test(object.sha)) throw new Error("Tag does not identify a commit");
    if (object.sha !== entry.commit)
      requireSuccess(await io.request("PATCH", prefix + "/git/refs/tags/" + tag, { sha: entry.commit, force: true }), "Replace tag");
  }
  const payload = {
    tag_name: entry.tag, target_commitish: entry.commit, name: entry.tag, body,
    prerelease: entry.prerelease === true,
    draft: entry.assets.length > 0 && (!existing || existing.draft === true)
  };
  const published = requireSuccess(await io.request(existing ? "PATCH" : "POST",
    prefix + "/releases" + (existing ? "/" + id(existing) : ""), payload), "Publish release");
  const releaseId = id(published);
  await syncAssets(repo, releaseId, entry.assets, io, cwd);
  if (payload.draft) requireSuccess(await io.request("PATCH", prefix + "/releases/" + releaseId, { draft: false }), "Finalize release");
  return true;
}

// The caller owns authorization. No network or credential is needed for a rehearsal.
export async function publish(indexName, repository, { cwd = process.cwd(), io, confirm = false } = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid repository");
  const result = await verify(indexName, cwd);
  const indexPath = path.join(cwd, indexName);
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  for (const entry of index.releases) {
    validateTag(entry.tag);
    if (entry.previousTag !== undefined) validateTag(entry.previousTag);
    if (typeof entry.prerelease !== "boolean") throw new Error("Expected boolean prerelease: " + entry.tag);
  }
  if (!confirm) return { ...result, published: 0, rehearsal: true };
  if (!io) throw new Error("Publication requires authorized GitHub transport");
  let published = 0;
  for (const entry of index.releases) {
    if (await publishEntry(repository, entry, entry.onExisting ?? index.onExisting, io, cwd, path.dirname(indexPath))) published++;
  }
  return { ...result, published, rehearsal: false };
}

function github(token) {
  if (!token) throw new Error("GH_TOKEN is required for confirmed publication");
  const headers = {
    Authorization: "Bearer " + token, Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "CI-release-package"
  };
  async function call(url, method, body, contentType) {
    const res = await fetch(url, {
      method, headers: { ...headers, "Content-Type": contentType }, body,
      redirect: "error", signal: AbortSignal.timeout(120000)
    });
    const raw = await res.text();
    let data;
    try { data = raw ? JSON.parse(raw) : null; } catch { throw new Error("Invalid GitHub API response (HTTP " + res.status + ")"); }
    return { status: res.status, data };
  }
  return {
    request: (method, route, body) => call("https://api.github.com/" + route, method,
      body === undefined ? undefined : JSON.stringify(body), "application/json"),
    upload: async (repo, releaseId, name, bytes) => requireSuccess(await call(
      "https://uploads.github.com/repos/" + repo + "/releases/" + releaseId + "/assets?name=" + encodeURIComponent(name),
      "POST", bytes, "application/octet-stream"), "Upload asset")
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (![4, 5].includes(args.length) || args[0] !== "--index" || args[2] !== "--repository" ||
        (args.length === 5 && args[4] !== "--publish"))
      throw new Error("Usage: node publish.mjs --index <path> --repository <owner/name> [--publish]");
    const confirm = args.length === 5;
    const result = await publish(args[1], args[3], { confirm, io: confirm ? github(process.env.GH_TOKEN) : undefined });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error("Release publication failed: " + error.message);
    process.exitCode = 1;
  }
}
