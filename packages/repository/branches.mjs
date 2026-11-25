import { execFileSync } from "node:child_process";
import { lstat, readdir, cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const branchPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const identity = ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"];

function git(cwd, env, ...args) {
  try {
    return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 }).trim();
  } catch (error) {
    throw new Error("Git " + args[0] + " failed (exit " + (error.status ?? error.code ?? "unknown") + ")");
  }
}

async function inspect(directory) {
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("Expected a regular generated branch directory");
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.toLowerCase() === ".git" || entry.isSymbolicLink()) throw new Error("Unsafe generated entry: " + entry.name);
    if (entry.isDirectory()) await inspect(path.join(directory, entry.name));
    else if (!entry.isFile()) throw new Error("Non-regular generated entry: " + entry.name);
  }
}

// Validate every candidate before modifying any remote. Never force-push.
export async function publishBranches(directory, { remote, defaultBranch, confirm = false, env = process.env } = {}) {
  if (!defaultBranch) throw new Error("A default branch is required");
  git(process.cwd(), env, "check-ref-format", "refs/heads/" + defaultBranch);
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("Expected a generated branches directory");
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (!entry.isDirectory() || !branchPattern.test(entry.name)) throw new Error("Invalid generated branch: " + entry.name);
    await inspect(path.join(directory, entry.name));
  }
  const result = { created: [], updated: [], unchanged: [], skipped: [], rehearsal: !confirm };
  if (confirm && !remote) throw new Error("A remote is required for publication");
  for (const { name } of entries) {
    if (name === defaultBranch) { result.skipped.push(name); continue; }
    if (!confirm) continue;
    const work = await mkdtemp(path.join(os.tmpdir(), "generated-branch-"));
    try {
      await cp(path.join(directory, name), work, { recursive: true, errorOnExist: true, force: false });
      git(work, env, "init", "--quiet");
      git(work, env, "remote", "add", "origin", remote);
      const ref = "refs/heads/" + name;
      const lookup = git(work, env, "ls-remote", "origin", ref);
      let parent;
      if (lookup) {
        const match = /^([a-f0-9]{40})\s+refs\/heads\/[A-Za-z0-9_-]+$/.exec(lookup);
        if (!match) throw new Error("Unexpected branch lookup result");
        git(work, env, "fetch", "--quiet", "--no-tags", "origin", ref);
        parent = git(work, env, "rev-parse", "FETCH_HEAD");
        if (parent !== match[1]) throw new Error("Branch moved while preparing publication: " + name);
      }
      git(work, env, "add", "--force", "--all");
      const tree = git(work, env, "write-tree");
      if (parent && tree === git(work, env, "rev-parse", parent + "^{tree}")) {
        result.unchanged.push(name);
        continue;
      }
      const commit = git(work, env, ...identity, "commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", "Publish generated repository output");
      git(work, env, "push", "origin", commit + ":" + ref);
      result[parent ? "updated" : "created"].push(name);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
  return { ...result, candidates: entries.map(entry => entry.name) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (![6, 7].includes(args.length) || args[0] !== "--directory" || args[2] !== "--repository" || args[4] !== "--default-branch" ||
        (args.length === 7 && args[6] !== "--publish"))
      throw new Error("Usage: node branches.mjs --directory <path> --repository <owner/name> --default-branch <name> [--publish]");
    const [, directory, , repository, , defaultBranch] = args;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid repository");
    const confirm = args.length === 7;
    const token = process.env.GH_TOKEN;
    if (confirm && !token) throw new Error("GH_TOKEN is required for confirmed publication");
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    if (confirm) {
      env.GIT_CONFIG_COUNT = "1";
      env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
      env.GIT_CONFIG_VALUE_0 = "AUTHORIZATION: basic " + Buffer.from("x-access-token:" + token).toString("base64");
    }
    const result = await publishBranches(directory, { remote: "https://github.com/" + repository + ".git", defaultBranch, confirm, env });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error("Generated branch publication failed: " + error.message);
    process.exitCode = 1;
  }
}
