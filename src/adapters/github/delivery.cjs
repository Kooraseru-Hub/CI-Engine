"use strict";
// A trusted plan selects jobs; the static workflow owns their permissions.
const fs=require("node:fs"), path=require("node:path"), {spawnSync}=require("node:child_process");
const LANES=["contents","issues","credential","pages","external"];
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,127}$/;
const NAME=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const ENV=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SHA=/^[a-f0-9]{40}$/;
function safePath(value) {
  return typeof value==="string" && /^build\/[A-Za-z0-9_.\/-]+$/.test(value) && !value.split("/").some(x=>x==="."||x===".."||!x);
}
function vector(value){
  if(!Array.isArray(value)||!value.length||value.some(x=>typeof x!=="string"||!x||/[\0\r\n]/.test(x)))throw Error("Invalid delivery command");
  return value;
}
function map(value={}){
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid delivery environment");
  for(const [k,v] of Object.entries(value)){
    if(!NAME.test(k)||typeof v!=="string"||/[\0\r\n]/.test(v)||/^(GITHUB_|ACTIONS_|RUNNER_|GH_TOKEN$|PATH$|NODE_OPTIONS$|CI_ORIGIN_|CI_REVIEW_|CI_DELIVERY_|CI_CREDENTIAL_|CI_PUBLICATION_)/.test(k))throw Error("Invalid delivery environment binding");
  }
  return value;
}
function trusted(env){
  if(env.ACT==="true"||env.GITHUB_ACTIONS!=="true"||env.GITHUB_EVENT_NAME!=="repository_dispatch"||
    env.CI_ORIGIN_TRUSTED!=="true"||env.CI_DELIVERY_CONFIRM!=="true"||
    env.CI_ORIGIN_EVENT!=="workflow_dispatch"||!SHA.test(env.CI_ORIGIN_SHA||"")||
    env.CI_ORIGIN_SHA!==env.GITHUB_SHA||
    env.CI_ORIGIN_REF!=="refs/heads/"+env.CI_DEFAULT_BRANCH)throw Error("Delivery requires confirmed trusted default-branch admission");
}
// Review delivery is a separate, opt-in authority. It cannot enable normal publication.
function reviewTrusted(env){
  if(env.ACT==="true"||env.GITHUB_ACTIONS!=="true"||env.GITHUB_EVENT_NAME!=="repository_dispatch"||
    env.CI_ORIGIN_EVENT!=="pull_request"||env.CI_ORIGIN_TRUSTED!=="false"||
    env.CI_DELIVERY_CONFIRM!=="false"||!SHA.test(env.CI_ORIGIN_SHA||"")||
    !/^[1-9][0-9]*$/.test(env.CI_REVIEW_PR||"")||
    !env.CI_DEFAULT_BRANCH||env.GITHUB_REF!=="refs/heads/"+env.CI_DEFAULT_BRANCH)
    throw Error("Review delivery requires admitted same-repository PR and trusted controller");
}
function normalizeReview(raw,env){
  reviewTrusted(env);
  const plan=normalize(raw);
  if(plan.jobs.length!==1||plan.jobs[0].lane!=="external"||!plan.prepare||
    plan.prepare.ref!==env.CI_ORIGIN_SHA||!plan.artifact||!plan.destination)
    throw Error("Review delivery requires one isolated external static-artifact job");
  return plan;
}
function authorizeDelivery(env){
  if(env.CI_ORIGIN_EVENT==="pull_request")reviewTrusted(env);
  else trusted(env);
}
function normalize(raw){
  if(!raw||typeof raw!=="object"||!Array.isArray(raw.jobs)||raw.jobs.length<1||raw.jobs.length>64)throw Error("Invalid delivery plan");
  const artifact=raw.artifact||"",destination=raw.destination||"";
  if(Boolean(artifact)!==Boolean(destination)||artifact&&(!safePath(artifact)||!safePath(destination)))throw Error("Unsafe delivery artifact paths");
  let prepare=raw.prepare||null;
  if(prepare){
    if(!SHA.test(prepare.ref||"")||!artifact.startsWith("build/ci-candidate/"))throw Error("Invalid isolated preparation");
    prepare={ref:prepare.ref,command:vector(prepare.command),env:map(prepare.env)};
  }
  const seen=new Set(), jobs=raw.jobs.map(job=>{
    if(!job||!ID.test(job.id||"")||job.id.split("/").includes("..")||seen.has(job.id)||!LANES.includes(job.lane)||!ENV.test(job.environment||""))throw Error("Invalid delivery job");
    seen.add(job.id);
    const result={id:job.id,lane:job.lane,environment:job.environment,command:vector(job.command),
      env:map(job.env),bindings:[],options_command:[],pages_path:""};
    if(job.bindings!==undefined){
      if(!Array.isArray(job.bindings)||job.bindings.length>3)throw Error("At most three explicit credential bindings per delivery job");
      const roles=new Set();
      for(const b of job.bindings){
        if(!b||!NAME.test(b.role||"")||!NAME.test(b.name||"")||!["secret","variable"].includes(b.source)||roles.has(b.role))throw Error("Invalid credential binding");
        if(!/^CI_CREDENTIAL_[A-Z0-9_]+$/.test(b.role)&&!/^CI_EXTERNAL_[A-Z0-9_]+$/.test(b.role)) throw Error("Invalid credential binding role");
        roles.add(b.role);result.bindings.push(b);
      }
    }
    while(result.bindings.length<3)result.bindings.push({name:"",role:"",source:""});
    if(job.lane==="pages"){
      if(!safePath(job.pages_path))throw Error("Invalid Pages artifact path");
      result.pages_path=job.pages_path;result.options_command=vector(job.options_command);
      if(result.bindings.some(b=>b.name))throw Error("Pages credentials must be job-scoped OIDC");
    }else if(job.options_command||job.pages_path)throw Error("Native Pages options require Pages lane");
    return result;
  });
  return {artifact,destination,prepare,jobs};
}
function output(name,value,env=process.env){
  if(typeof value!=="string")value=JSON.stringify(value);
  if(/[\r\n]/.test(value))throw Error("Invalid delivery output");
  fs.appendFileSync(env.GITHUB_OUTPUT,name+"="+value+"\n");
}
function execute(command,env,cwd=process.cwd(),capture=false){
  vector(command);
  const result=spawnSync(command[0],command.slice(1),{cwd,env,encoding:"utf8",stdio:capture?["ignore","pipe","inherit"]:"inherit",timeout:capture?600000:3600000,shell:false,maxBuffer:16*1024*1024});
  if(result.error||result.status!==0)throw Error("Delivery command failed: "+(result.error?.message||result.status));
  return result.stdout;
}
function planner(env=process.env){
  authorizeDelivery(env);
  const review=env.CI_ORIGIN_EVENT==="pull_request";
  let command;
  if(review){
    // This file and its executable are read only from the trusted controller checkout.
    const file="config/ci/review-delivery.json";
    if(!fs.existsSync(file))return;
    const route=JSON.parse(fs.readFileSync(file,"utf8"));
    if(route.operation!==env.CI_DELIVERY_OPERATION)return;
    command=vector(route.command);
  }else{
    const config=JSON.parse(fs.readFileSync("config/ci/operations.json","utf8"));
    const route=config.operations?.[env.CI_DELIVERY_OPERATION];
    if(route?.mode!=="staged"||route.publication!==true)throw Error("Expected a staged publication operation");
    command=route.delivery.command;
  }
  const directory=fs.mkdtempSync(path.join(require("node:os").tmpdir(),"ci-delivery-"));
  let plan;
  try {
    const file=path.join(directory,"plan.json");
    execute(command,{...env,CI_DELIVERY_PLAN_FILE:file});
    const raw=JSON.parse(fs.readFileSync(file,"utf8"));
    if(review&&Array.isArray(raw.jobs)&&raw.jobs.length===0)return;
    plan=review?normalizeReview(raw,env):normalize(raw);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
  output("artifact",plan.artifact,env);output("destination",plan.destination,env);
  output("prepare_ref",plan.prepare?.ref||"",env);
  output("prepare_command",plan.prepare?.command||[],env);output("prepare_env",plan.prepare?.env||{},env);
  for(const lane of LANES){
    const entries=plan.jobs.filter(j=>j.lane===lane);
    output(lane,{include:entries},env);output("has_"+lane,entries.length?"true":"false",env);
  }
}
function prepare(env=process.env){
  authorizeDelivery(env);
  const command=vector(JSON.parse(env.CI_DELIVERY_PREPARE_COMMAND)), bindings=map(JSON.parse(env.CI_DELIVERY_PREPARE_ENV));
  const child={...env,...bindings};
  for(const name of Object.keys(child))if(/^(GH_TOKEN$|GITHUB_TOKEN$|ACTIONS_ID_TOKEN_|CI_CREDENTIAL_|CI_SLOT_|CI_COMPONENT_CREDENTIALS|CI_NATIVE_)/.test(name))delete child[name];
  execute(command,child,path.resolve("build/ci-candidate"));
}
function run(env=process.env,options=false){
  authorizeDelivery(env);
  const raw=JSON.parse(env.CI_DELIVERY_ENTRY);
  // Matrix entries already contain empty placeholders; remove them before revalidation.
  const entry=normalize({jobs:[{...raw,bindings:raw.bindings.filter(b=>b.name),
    ...(raw.lane==="pages"?{}:{options_command:undefined,pages_path:undefined})}]}).jobs[0];
  if(entry.lane!==env.CI_DELIVERY_LANE)throw Error("Delivery permission lane mismatch");
  if(env.CI_ORIGIN_EVENT==="pull_request"&&(entry.lane!=="external"||options))throw Error("Review delivery permits only external publication");
  const child={...env,...entry.env};
  for(let i=0;i<3;i++){
    const b=entry.bindings[i];const value=env["CI_SLOT_"+i];
    if(b.role&&value)child[b.role]=value;
    delete child["CI_SLOT_"+i];
  }
  if(entry.bindings.some(b=>b.role.startsWith("CI_CREDENTIAL_"))) child.CI_CREDENTIAL_ENVIRONMENT=entry.environment;
  if(entry.lane!=="pages"){
    delete child.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete child.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  }
  // The native adapter's contract is immutable across build and publication.
  Object.assign(child,{CI_EVENT:"push",CI_OPERATION:env.CI_DELIVERY_OPERATION,CI_PHASE:"publish",CI_GRAPH_RUN:"true",CI_SOURCE_SHA:env.CI_ORIGIN_SHA,CI_PUBLICATION_ENABLED:"true",CI_ENGINE_OPERATION:env.CI_DELIVERY_OPERATION});
  execute(options?entry.options_command:entry.command,child);
}
module.exports={normalize,trusted,reviewTrusted,normalizeReview,safePath};
if(require.main===module)try{
  const command=process.argv[2];
  if(command==="delivery-plan")planner();
  else if(command==="delivery-prepare")prepare();
  else if(command==="delivery-run")run();
  else if(command==="delivery-options")run(process.env,true);
  else throw Error("Unknown delivery phase");
}catch(e){console.error("CI Engine: "+e.message);process.exitCode=1}
