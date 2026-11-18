"use strict";
// Event-side client: observe an independent engine run without loading the engine.
const fs = require("node:fs");
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ID = /^[1-9]\d*$/;
const SHA = /^[a-f0-9]{40}$/;
const REQUEST = /^[1-9]\d*-[1-9]\d*$/;
const PHASE = /^[A-Za-z][A-Za-z0-9-]*$/;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function get(resource, env = process.env) {
  const response = await fetch("https://api.github.com" + resource, {
    headers: {Authorization:"Bearer " + env.GH_TOKEN, Accept:"application/vnd.github+json",
      "X-GitHub-Api-Version":"2022-11-28"}, signal:AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error("GitHub observation HTTP " + response.status);
  return response.json();
}
function base(env) {
  if (!REPO.test(env.GITHUB_REPOSITORY || "")) throw new Error("Invalid observer repository");
  return "/repos/" + env.GITHUB_REPOSITORY + "/actions";
}
function title(operation, sha, request) {
  if (!/^[a-z][a-z0-9-]*$/.test(operation) || !SHA.test(sha) || !REQUEST.test(request))
    throw new Error("Invalid execution request identity");
  return "CI / " + operation + " / " + sha + " / request " + request;
}
async function pages(resource, key, api) {
  const records = [];
  for (let page=1; page<=100; page++) {
    const data = await api(resource + "&page=" + page);
    if (!Array.isArray(data[key])) throw new Error("Invalid workflow observation response");
    records.push(...data[key]);
    if (data[key].length < 100) return records;
  }
  throw new Error("Workflow observation pagination limit exceeded");
}
async function discover(env, api = resource => get(resource, env), delay = sleep, now = Date.now) {
  const wanted = title(env.CI_OPERATION,env.REQUEST_SHA,env.REQUEST_ID);
  const deadline = now()+300000;
  do {
    const rows = await pages(base(env)+"/workflows/bootstrap.yml/runs?event=repository_dispatch&per_page=100", "workflow_runs", api);
    const matching = rows.filter(row => row.event === "repository_dispatch" && row.display_title === wanted);
    if (matching.length > 1) throw new Error("Ambiguous independent CI request");
    if (matching.length === 1) {
      const run = matching[0];
      if (!Number.isSafeInteger(run.id) || !ID.test(String(run.id))) throw new Error("Invalid engine run ID");
      return {run_id:String(run.id),run_url:"https://github.com/"+env.GITHUB_REPOSITORY+"/actions/runs/"+run.id};
    }
    await delay(5000);
  } while (now()<deadline);
  throw new Error("Independent CI request was not scheduled");
}
async function observe(phase, runID, env, api = resource => get(resource,env), delay = sleep, now = Date.now) {
  if (!PHASE.test(phase) || !ID.test(runID)) throw new Error("Invalid phase or engine run ID");
  const root=base(env)+"/runs/"+runID;
  const deadline=now()+100*60*1000;
  do {
    const run=await api(root);
    if (run.id !== Number(runID) || run.event !== "repository_dispatch") throw new Error("Invalid engine run");
    if (phase.toLowerCase() === "complete") {
      if (run.status === "completed") return {conclusion:run.conclusion || "unknown"};
    } else {
      const jobs=await pages(root+"/jobs?filter=latest&per_page=100","jobs",api);
      const matches=jobs.filter(job => typeof job.name==="string" && job.name.split(" / ").at(-1).toLowerCase() === phase.toLowerCase());
      if (matches.length>1) throw new Error("Ambiguous CI phase: "+phase);
      const job=matches[0];
      if (job?.status==="completed") return {conclusion:job.conclusion || "unknown",job_id:String(job.id)};
      if (run.status==="completed") throw new Error("CI finished before reaching "+phase+": "+run.conclusion);
    }
    await delay(10000);
  } while(now()<deadline);
  throw new Error("Timed out waiting for CI Engine "+phase);
}
async function status(runID, env, api = resource => get(resource,env)) {
  if (!ID.test(runID)) throw new Error("Invalid engine run ID");
  const root=base(env)+"/runs/"+runID;
  const run=await api(root);
  if (run.id !== Number(runID) || run.event !== "repository_dispatch") throw new Error("Invalid engine run");
  const jobs=await pages(root+"/jobs?filter=latest&per_page=100","jobs",api);
  const phases=Object.fromEntries(jobs.map(job=>[
    job.name.split(" / ").at(-1).toLowerCase(),
    {job_id:String(job.id),status:job.status,conclusion:job.conclusion || null}
  ]));
  if (Object.keys(phases).length !== jobs.length) throw new Error("Ambiguous CI phases");
  return {run_id:runID,status:run.status,conclusion:run.conclusion || null,phases:JSON.stringify(phases)};
}
function output(result, env=process.env) {
  for (const [key,value] of Object.entries(result)) {
    if (/[\r\n]/.test(value)) throw new Error("Invalid signal output");
    fs.appendFileSync(env.GITHUB_OUTPUT,key+"="+value+"\n");
  }
}
module.exports={title,discover,observe,status};
if(require.main===module)(async()=>{
  const [command,runID,phase="Complete"]=process.argv.slice(2);
  if(command==="connect"){
    const result=await discover(process.env);
    output(result);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,"[Independent CI run]("+result.run_url+")\n");
  }else if(command==="status"){
    output(await status(runID,process.env));
  }else if(command==="wait"){
    const result=await observe(phase,runID,process.env);
    output(result);
    console.log("CI Engine signal: "+phase+" = "+result.conclusion);
    if(result.conclusion!=="success")process.exitCode=1;
  }else{
    throw new Error("Expected connect, status <run-id>, or wait <run-id> [phase]");
  }
})().catch(error=>{console.error(error.message);process.exitCode=1});
