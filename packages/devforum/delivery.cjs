// Explicit approved delivery backed by a compare-and-set GitHub receipt.
"use strict";
const fs = require("node:fs");
const { setTimeout: sleep } = require("node:timers/promises");
const { prepare, publishedRelease, inspectTopic, deliver, draft, identity } = require("./announcement.cjs");
const ORIGIN = "https://devforum.roblox.com";
const GITHUB = "https://api.github.com";
const hex = /^[a-f0-9]{40}$/;
function check(ok,message) { if(!ok) throw new Error(message); }
function trusted(env, repository, branch) {
  check(env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.ACT !== "true" && env.GITHUB_REPOSITORY === repository && env.CI_DEFAULT_BRANCH &&
    env.GITHUB_REF === "refs/heads/" + env.CI_DEFAULT_BRANCH && branch !== env.CI_DEFAULT_BRANCH,
    "Live release delivery requires the trusted default branch and a separate generated receipt branch");
}
function receiptStore(repository, config, token, request = fetch) {
  const {receiptBranch,receiptDirectory} = config.delivery || {};
  check(/^[\w.-]+\/[\w.-]+$/.test(repository) &&
    typeof receiptBranch === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(receiptBranch) &&
    typeof receiptDirectory === "string" && receiptDirectory.split("/").every(s=>/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(s)) &&
    token, "Invalid durable receipt location or missing GitHub token");
  const headers={Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",Authorization:"Bearer "+token};
  const route=key=>"/repos/"+repository+"/contents/"+receiptDirectory+"/"+key+".json";
  async function call(method,path,body) {
    const response=await request(GITHUB+path,{method,headers:{...headers,...(body?{"Content-Type":"application/json"}:{})},
      body:body?JSON.stringify(body):undefined,redirect:"error",credentials:"omit",cache:"no-store",signal:AbortSignal.timeout(20000)});
    return response;
  }
  async function read(key) {
    check(/^[a-f0-9]{64}$/.test(key),"Invalid receipt key");
    const response=await call("GET",route(key)+"?ref="+encodeURIComponent(receiptBranch));
    if(response.status===404) return null;
    check(response.ok,"Receipt read failed (HTTP "+response.status+")");
    const file=await response.json();
    check(file.type==="file" && hex.test(file.sha) && file.encoding==="base64" && typeof file.content==="string","Invalid receipt file");
    const record=JSON.parse(Buffer.from(file.content,"base64").toString("utf8"));
    check(record.key===key && ["pending","published"].includes(record.state) &&
      Number.isSafeInteger(record.releaseId) && record.releaseId>0 && hex.test(record.commit) &&
      (record.state!=="published" || Number.isSafeInteger(record.postId)&&record.postId>0),"Invalid stored receipt");
    return {record,sha:file.sha};
  }
  async function put(key,value,sha) {
    const response=await call("PUT",route(key),{
      message:"Record DevForum release announcement",
      branch:receiptBranch,content:Buffer.from(JSON.stringify({key,...value},null,2)+"\n").toString("base64"),
      ...(sha?{sha}:{})
    });
    if(!sha && (response.status===409 || response.status===422)) return false;
    check(response.ok,"Receipt write failed (HTTP "+response.status+")");
    const file=(await response.json()).content;
    check(file?.type==="file" && hex.test(file.sha),"Receipt write not confirmed");
    return true;
  }
  return {
    async verifyBranch(){
      const response=await call("GET","/repos/"+repository+"/git/ref/heads/"+receiptBranch);
      check(response.ok,"Receipt branch must already exist");
      const ref=await response.json();
      check(ref.ref==="refs/heads/"+receiptBranch && ref.object?.type==="commit" && hex.test(ref.object.sha),"Invalid receipt branch");
    },
    async load(key){return (await read(key))?.record || null},
    async reserve(key,value){return put(key,value)},
    async complete(key,value){
      const previous=await read(key);
      check(!previous || previous.record.releaseId===value.releaseId,"Release identity changed in receipt");
      check(!previous?.record.postId || previous.record.postId===value.postId,"Receipt points to another post");
      check(await put(key,value,previous?.sha),"Receipt was modified concurrently; reconcile before retrying");
    }
  };
}
function forumTransport(config, repository, {key,client,token,request=fetch,wait=sleep} = {}) {
  check(key && client && !/[\r\n]/.test(key+client),"Missing DevForum credentials");
  const store=receiptStore(repository,config,token,request);
  async function api(method,route,body,authenticated=true) {
    const headers={Accept:"application/json",...(authenticated?{"User-Api-Key":key,"User-Api-Client-Id":client}:{})};
    if(body)headers["Content-Type"]="application/json";
    const response=await request(ORIGIN+route,{method,headers,body:body?JSON.stringify(body):undefined,
      redirect:"error",credentials:"omit",cache:"no-store",signal:AbortSignal.timeout(20000)});
    check(response.ok,"DevForum "+method+" failed (HTTP "+response.status+")");
    return response.json();
  }
  return {
    ...store,
    async validate(plan) {
      check(plan.repository===repository && plan.topicId===config.destination.topicId &&
        plan.firstPostId===config.destination.postId,"Approved destination mismatch");
      const current=await publishedRelease(repository,plan.tag,{token,request});
      const expected=draft({repository,...current,topicId:plan.topicId,firstPostId:plan.firstPostId,authorId:plan.authorId});
      check(expected.raw===plan.raw && expected.releaseId===plan.releaseId && expected.commit===plan.commit,"Published release changed after approval");
      await store.verifyBranch();
      // Verify the authenticated actor, not merely permission to edit someone else's post.
      const session=await api("GET","/session/current.json");
      check(session.current_user?.id===plan.authorId,"Forum API key is not the topic author");
      const first=await api("GET","/posts/"+plan.firstPostId+".json");
      check(first.id===plan.firstPostId && first.topic_id===plan.topicId && first.post_number===1 &&
        first.user_id===plan.authorId && first.can_edit===true,"Cannot verify configured first-post ownership");
    },
    async find(plan){
      const result=await inspectTopic(config.destination,repository,plan.tag,request);
      check(result.authorId===plan.authorId,"Topic author changed");
      return result.existing?[result.existing]:[];
    },
    async create(topicId,raw){
      check(topicId===config.destination.topicId,"Wrong reply topic");
      const result=await api("POST","/posts.json",{topic_id:topicId,raw});
      return result.post || result;
    },
    async edit(id,raw,previous){
      check(id!==config.destination.postId && Number.isSafeInteger(id) && id>0,"Refusing to edit first post as a release reply");
      const current=await api("GET","/posts/"+id+".json");
      check(current.id===id && current.topic_id===config.destination.topicId && current.post_number>1 &&
        current.can_edit===true && current.raw===previous,"Reply changed or cannot be edited");
      await api("PUT","/posts/"+id+".json",{post:{raw,original_text:previous,edit_reason:"Synchronize release announcement"}});
    },
    async verify(id,plan){
      let last;
      for(let i=0;i<6;i++){
        if(i)await wait(5000);
        try {
          const p=await api("GET","/posts/"+id+".json",undefined,false);
          if(p.id===id && p.topic_id===plan.topicId && p.user_id===plan.authorId &&
            p.post_number>1 && typeof p.raw==="string" && p.raw.trimEnd()===plan.raw.trimEnd())return p;
        } catch(error){last=error.message}
      }
      throw Error("Public reply verification unresolved"+(last?": "+last:""));
    }
  };
}
async function send(repository, tag, config, approval, {env=process.env,request=fetch,wait=sleep} = {}) {
  check(/^[a-f0-9]{64}$/.test(approval || ""),"Exact reviewed approval SHA-256 required");
  identity(repository,config.destination.topicId,tag);
  trusted(env,repository,config.delivery?.receiptBranch);
  // Rebuild from current public state before any GitHub or forum mutation.
  const plan=await prepare(repository,tag,config,{token:env.GH_TOKEN,request});
  check(plan.approval===approval,"Release draft changed; review a new draft");
  return deliver(plan,{approval,io:forumTransport(config,repository,{key:env.DEVFORUM_UPLOAD_KEY,
    client:env.DEVFORUM_UPLOAD_CLIENT,token:env.GH_TOKEN,request,wait})});
}
module.exports={receiptStore,forumTransport,send};
if(require.main===module){
  (async()=>{
    const [repository,tag,configPath,approval,...extra]=process.argv.slice(2);
    check(repository&&tag&&configPath&&approval&&!extra.length,
      "Usage: delivery.cjs <owner/repo> <tag> <config.json> <approved-sha256>");
    const config=JSON.parse(fs.readFileSync(configPath,"utf8"));
    console.log(JSON.stringify(await send(repository,tag,config,approval)));
  })().catch(error=>{console.error("DevForum release delivery: "+error.message);process.exitCode=1});
}
