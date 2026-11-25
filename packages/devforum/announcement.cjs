// Release replies are deliberately separate from first-post synchronization.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { digest } = require("./post.cjs");
const ORIGIN = "https://devforum.roblox.com";
const GITHUB = "https://api.github.com";
const integer = n => Number.isSafeInteger(n) && n > 0;
const hash = s => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
function check(ok, message) { if (!ok) throw new Error(message); }
function same(a, b) { return a.trimEnd() === b.trimEnd(); }

function identity(repository, topicId, tag) {
  check(/^[\w.-]+\/[\w.-]+$/.test(repository) && integer(topicId) &&
    typeof tag === "string" && tag.length > 0 && tag.length <= 200 && !/[\x00-\x20\x7f]/.test(tag), "Invalid announcement identity");
  return digest(repository.toLowerCase() + "\n" + topicId + "\n" + tag);
}
function marker(key) { return "<!-- ci-release:" + key + " -->"; }
function releaseURL(repo, tag) {
  return "https://github.com/" + repo + "/releases/tag/" + encodeURIComponent(tag);
}
function planHash(plan) {
  const { approval, ...body } = plan;
  return digest(JSON.stringify(body));
}
function validReply(reply, plan) {
  return reply && integer(reply.id) && integer(reply.post_number) && reply.post_number > 1 &&
    reply.topic_id === plan.topicId && reply.user_id === plan.authorId &&
    typeof reply.raw === "string" && reply.raw.split(marker(plan.key)).length === 2;
}

// A stable identity follows a version, not the contents of the release notes.
function draft({ repository, release, commit, topicId, firstPostId, authorId, existing = null }) {
  check(integer(topicId) && integer(firstPostId) && integer(authorId), "Invalid forum destination");
  check(release && integer(release.id) && release.draft === false && release.prerelease === false &&
    typeof release.published_at === "string" && Number.isFinite(Date.parse(release.published_at)), "Only a published non-prerelease release may be announced");
  check(/^[a-f0-9]{40}$/.test(commit), "Invalid published tag commit");
  check(typeof release.body === "string" && release.body.trim() && release.body.length <= 30000 &&
    !release.body.includes("<!-- ci-release:"), "Invalid authored release notes");
  const tag = release.tag_name;
  const key = identity(repository, topicId, tag);
  const url = releaseURL(repository, tag);
  const raw = release.body.trimEnd() + "\n\n[GitHub release](" + url + ")\n\n" + marker(key) + "\n";
  const plan = { version:1, kind:"release", repository, topicId, firstPostId, authorId, tag,
    releaseId:release.id, commit, key, raw, expectedPost:null };
  if (existing) {
    check(validReply(existing, plan), "Existing reply identity mismatch");
    plan.expectedPost = { id:existing.id, digest:digest(existing.raw) };
  }
  return { ...plan, approval:planHash(plan) };
}

// The caller must implement reserve as a durable atomic create-if-absent and serialize
// sends per topic. A receipt survives runner cancellation and deleted workflow history.
// No automatic retries of POST, even when the transport returns an error.
async function deliver(plan, { approval, io } = {}) {
  check(plan?.version === 1 && plan.kind === "release" && hash(approval) &&
    approval === plan.approval && approval === planHash(plan), "Exact draft approval required");
  check(plan.key === identity(plan.repository, plan.topicId, plan.tag) &&
    integer(plan.firstPostId) && integer(plan.authorId) && integer(plan.releaseId) &&
    /^[a-f0-9]{40}$/.test(plan.commit) && typeof plan.raw === "string" &&
    plan.raw.split(marker(plan.key)).length === 2, "Invalid approved draft");
  check(io && ["validate","find","load","reserve","complete","create","edit","verify"].every(k=>typeof io[k]==="function"),
    "A durable receipt store and explicit delivery transport are required");
  await io.validate(plan); // revalidate release identity, content, destination and author
  const receipt = await io.load(plan.key);
  check(!receipt || receipt.releaseId === plan.releaseId, "Stored receipt refers to a different GitHub release");
  const matches = await io.find(plan);
  check(Array.isArray(matches) && matches.length <= 1, "Ambiguous announcement; refusing delivery");
  let existing = matches[0];
  if (existing) {
    check(validReply(existing, plan), "Existing reply identity mismatch");
    check(!receipt?.postId || receipt.postId === existing.id, "Receipt and existing reply disagree");
    if (!same(existing.raw, plan.raw)) {
      check(plan.expectedPost?.id === existing.id && plan.expectedPost.digest === digest(existing.raw),
        "Existing reply changed since draft; prepare a new draft");
      await io.edit(existing.id, plan.raw, existing.raw);
    }
  } else {
    check(!receipt && !plan.expectedPost, "Previous delivery or reply is unresolved; do not create another");
    check(await io.reserve(plan.key, { state:"pending", approval, releaseId:plan.releaseId, commit:plan.commit }),
      "Another delivery has reserved this announcement");
    // This is the only call site allowed to create a reply.
    const created = await io.create(plan.topicId, plan.raw);
    check(created && integer(created.id), "Uncertain reply creation; retain pending receipt");
    existing = { id:created.id };
  }
  const verified = await io.verify(existing.id, plan);
  check(validReply(verified, plan) && verified.id === existing.id && same(verified.raw, plan.raw),
    "Reply was not anonymously verified; retain receipt for reconciliation");
  const result = { state:"published", postId:verified.id, postNumber:verified.post_number,
    approval, releaseId:plan.releaseId, commit:plan.commit,
    url:ORIGIN + "/t/" + plan.topicId + "/" + verified.post_number };
  await io.complete(plan.key, result);
  return result;
}

// Public read-only discovery. If we cannot enumerate the topic, do not infer absence.
async function getJSON(base, route, headers, request) {
  const r = await request(base + route, { method:"GET", headers, redirect:"error", credentials:"omit",
    cache:"no-store", signal:AbortSignal.timeout(20000) });
  check(r.ok, "Read-only lookup failed (HTTP " + r.status + ")");
  return r.json();
}
async function inspectTopic(destination, repository, tag, request = fetch) {
  const { topicId, postId } = destination;
  check(integer(topicId) && integer(postId), "Invalid topic destination");
  const key = identity(repository, topicId, tag);
  const get = route => getJSON(ORIGIN, route, {Accept:"application/json"}, request);
  const topic = await get("/t/" + topicId + ".json");
  check(topic.id === topicId && topic.archetype === "regular", "Not a public regular topic");
  const ids = topic.post_stream?.stream;
  check(Array.isArray(ids) && ids.length > 0 && ids.length <= 2000 &&
    ids.every(integer) && new Set(ids).size === ids.length && ids[0] === postId &&
    (!integer(topic.posts_count) || topic.posts_count === ids.length), "Cannot enumerate complete public topic");
  const first = await get("/posts/" + postId + ".json");
  check(first.id === postId && first.topic_id === topicId && first.post_number === 1 && integer(first.user_id), "First post identity mismatch");
  const matches = [];
  for (const id of ids.slice(1)) {
    const reply = await get("/posts/" + id + ".json");
    check(reply.id === id && reply.topic_id === topicId && integer(reply.post_number) && reply.post_number > 1 &&
      integer(reply.user_id) && typeof reply.raw === "string", "Incomplete public reply lookup");
    if (reply.raw.includes(marker(key))) {
      check(reply.user_id === first.user_id && reply.raw.split(marker(key)).length === 2, "Conflicting announcement marker");
      matches.push(reply);
    } else if (reply.user_id === first.user_id && reply.raw.includes(releaseURL(repository, tag))) {
      throw new Error("Possible manually authored announcement; adopt its post ID explicitly before sending");
    }
  }
  check(matches.length <= 1, "Multiple matching release replies");
  return { authorId:first.user_id, existing:matches[0] || null };
}
async function publishedRelease(repository, tag, { token, request = fetch } = {}) {
  identity(repository, 1, tag);
  const headers = { Accept:"application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28",
    ...(token ? {Authorization:"Bearer " + token} : {}) };
  const get = route => getJSON(GITHUB, "/repos/" + repository + route, headers, request);
  const release = await get("/releases/tags/" + encodeURIComponent(tag));
  check(release.tag_name === tag && release.draft === false && release.prerelease === false &&
    release.published_at, "Release is not published");
  let ref = (await get("/git/ref/tags/" + encodeURIComponent(tag))).object;
  for (let depth=0; ref?.type==="tag"; depth++) {
    check(depth < 10 && /^[a-f0-9]{40}$/.test(ref.sha), "Invalid annotated tag");
    ref = (await get("/git/tags/" + ref.sha)).object;
  }
  check(ref?.type === "commit" && /^[a-f0-9]{40}$/.test(ref.sha), "Release tag does not identify a commit");
  return {release,commit:ref.sha};
}
async function prepare(repository, tag, config, options = {}) {
  const {release,commit} = await publishedRelease(repository, tag, options);
  const {authorId,existing} = await inspectTopic(config.destination, repository, tag, options.request);
  return draft({repository,release,commit,topicId:config.destination.topicId,
    firstPostId:config.destination.postId,authorId,existing});
}
module.exports = { identity, draft, deliver, inspectTopic, publishedRelease, prepare, planHash };
if (require.main === module) {
  // There is deliberately no live CLI until a consumer supplies the durable
  // atomic receipt store. A draft cannot accidentally become a post.
  (async () => {
    const [mode, repository, tag, configPath, output, ...extra] = process.argv.slice(2);
    check(mode === "draft" && repository && tag && configPath && output && !extra.length,
      "Usage: announcement.cjs draft <owner/repo> <tag> <config.json> <output-directory>");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const plan = await prepare(repository, tag, config, {token:process.env.GH_TOKEN});
    fs.mkdirSync(output, {recursive:true});
    fs.writeFileSync(path.join(output, "announcement.json"), JSON.stringify(plan,null,2)+"\n");
    fs.writeFileSync(path.join(output, "announcement.md"), plan.raw);
    console.log("Release draft approval: " + plan.approval);
  })().catch(error=>{console.error("DevForum draft: "+error.message);process.exitCode=1});
}
