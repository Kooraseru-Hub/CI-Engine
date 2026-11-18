"use strict";
// Admission runs before any consumer checkout, with a scoped checks token.
const fs = require("node:fs");
const SHA = /^[a-f0-9]{40}$/;
const REF = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CHECK = "CI Engine / engine / validate";
const output = (key, value) => {
  if (/[\r\n]/.test(String(value))) throw new Error("Invalid workflow output");
  fs.appendFileSync(process.env.GITHUB_OUTPUT, key + "=" + value + "\n");
};
async function api(method, endpoint, body, env) {
  const response = await fetch("https://api.github.com" + endpoint, {
    method, headers: {Authorization:"Bearer " + env.GH_TOKEN, Accept:"application/vnd.github+json",
      "Content-Type":"application/json", "X-GitHub-Api-Version":"2022-11-28"},
    body: body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error("GitHub request " + method + " " + endpoint + ": HTTP " + response.status);
  return response.status === 204 ? null : await response.json();
}
function validate(request, env) {
  if (!request || typeof request !== "object" || Array.isArray(request)
      || !SHA.test(request.sha || "") || !REF.test(request.ref || "")
      || request.ref.includes("..") || request.ref.includes("//")
      || !/^[a-z][a-z0-9-]*$/.test(request.operation || "")
      || typeof request.publish !== "boolean")
    throw new Error("Invalid immutable execution request");
  const event = request.event;
  if (!["push","pull_request","workflow_dispatch","repository_dispatch"].includes(event))
    throw new Error("Unsupported request event");
  if (event === "pull_request" && (request.publish || !Number.isSafeInteger(request.pr) || request.pr < 1))
    throw new Error("PR requests are read-only review");
  if (event === "push" && request.publish)
    throw new Error("Push requests are validation only");
  if (event === "repository_dispatch" && request.publish)
    throw new Error("Remote requests are validation only");
  const trusted = ["push","workflow_dispatch"].includes(event) && request.ref === "refs/heads/" + env.CI_DEFAULT_BRANCH;
  if (!trusted && request.publish) throw new Error("Non-default requests cannot publish");
  return { ...request, trusted };
}
async function admit(env = process.env, requestApi = api) {
  const payload = env.CI_DISPATCH_REQUEST;
  if (!payload) {
    // The engine's own workflow_call smoke test uses the actual event.
    if (env.GITHUB_EVENT_NAME === "repository_dispatch") throw new Error("Dispatch requires a request");
    return {event:env.GITHUB_EVENT_NAME, ref:env.GITHUB_REF, sha:env.GITHUB_SHA, checkout:env.ACT === "true" ? "" : env.GITHUB_SHA, action:"", trusted:false, check:"", inputs:"{}"};
  }
  const r = validate(JSON.parse(payload), env);
  const local = env.ACT === "true";
  if (!local && env.GITHUB_EVENT_NAME !== "repository_dispatch") throw new Error("Hosted requests require repository_dispatch");
  if (!local && env.CI_DISPATCH_SENDER !== "github-actions[bot]") throw new Error("Only repository event dispatchers may submit engine requests");
  if (r.operation !== env.CI_DISPATCH_OPERATION || String(r.publish) !== env.CI_DISPATCH_PUBLISH)
    throw new Error("Request and invocation differ");
  let checkout = r.sha, check = "";
  if (!local) {
    if (!REPO.test(env.GITHUB_REPOSITORY || "")) throw new Error("Invalid repository");
    const base = "/repos/" + env.GITHUB_REPOSITORY;
    if (r.event === "pull_request") {
      const pr = await requestApi("GET", base + "/pulls/" + r.pr, undefined, env);
      if (pr.state !== "open" || pr.head.sha !== r.sha || pr.base.repo.full_name !== env.GITHUB_REPOSITORY
          || pr.base.ref !== env.CI_DEFAULT_BRANCH || r.ref !== "refs/heads/" + pr.head.ref)
        throw new Error("Stale or invalid PR request");
      // Validate the exact head. The fork is reachable via the base repository's PR ref.
      const result = await requestApi("POST", base + "/check-runs", {
        name:CHECK, head_sha:r.sha, status:"in_progress",
        external_id:"ci-engine:" + env.GITHUB_RUN_ID,
        details_url:"https://github.com/" + env.GITHUB_REPOSITORY + "/actions/runs/" + env.GITHUB_RUN_ID
      }, env);
      if (!Number.isSafeInteger(result.id)) throw new Error("Missing check run id");
      check = String(result.id);
    } else {
      const ref = r.ref.slice("refs/".length).split("/").map(encodeURIComponent).join("/");
      const current = await requestApi("GET", base + "/git/ref/" + ref, undefined, env);
      if (current.object.sha !== r.sha) throw new Error("Stale branch request");
      if (r.trusted && r.sha !== env.GITHUB_SHA) throw new Error("Trusted request is not the controller's immutable revision");
    }
  }
  return {event:r.event, ref:r.ref, sha:r.sha, checkout:local ? "" : checkout,
    action:r.event === "repository_dispatch" ? "ci-validation" : "", trusted:r.trusted && !local,
    check, inputs:JSON.stringify(r.inputs || {})};
}
async function finish(env = process.env, requestApi = api) {
  if (!env.CI_CHECK_ID) return;
  if (!/^[1-9]\d*$/.test(env.CI_CHECK_ID) || !REPO.test(env.GITHUB_REPOSITORY || "")) throw new Error("Invalid check identity");
  const base = "/repos/" + env.GITHUB_REPOSITORY + "/check-runs/" + env.CI_CHECK_ID;
  const check = await requestApi("GET", base, undefined, env);
  if (check.external_id !== "ci-engine:" + env.GITHUB_RUN_ID || check.name !== CHECK) throw new Error("Check belongs to another invocation");
  const conclusion = env.CI_CHECK_RESULT === "success" ? "success" : "failure";
  await requestApi("PATCH", base, {status:"completed", conclusion,
    output:{title:"CI Engine " + conclusion, summary:"See the independent execution run for details."}}, env);
}
module.exports = {validate, admit, finish};
if (require.main === module) (async () => {
  if (process.argv[2] === "status") return finish();
  const result = await admit();
  for (const [key,value] of Object.entries(result)) output(key, String(value));
})().catch(e => {console.error(e.message); process.exitCode = 1;});
