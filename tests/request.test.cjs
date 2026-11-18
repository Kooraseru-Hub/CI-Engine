"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const {admit,finish,validate}=require("../src/adapters/github/request.cjs");
const sha="a".repeat(40), env={CI_DEFAULT_BRANCH:"source",GITHUB_REPOSITORY:"org/repo",GITHUB_RUN_ID:"123",GITHUB_SHA:sha,GITHUB_EVENT_NAME:"repository_dispatch",CI_DISPATCH_SENDER:"github-actions[bot]",CI_DISPATCH_OPERATION:"review",CI_DISPATCH_PUBLISH:"false"};
const req={event:"pull_request",ref:"refs/heads/topic",sha,operation:"review",pr:7,publish:false};
test("PR admission resolves immutable untrusted SHA and creates a scoped check",async()=>{
 const calls=[];
 const api=async(method,path,body)=>{calls.push([method,path,body]);return method==="POST"?{id:42}:{state:"open",head:{sha,ref:"topic"},base:{repo:{full_name:"org/repo"},ref:"source"}}};
 const result=await admit({...env,CI_DISPATCH_REQUEST:JSON.stringify(req)},api);
 assert.equal(result.checkout,sha);assert.equal(result.trusted,false);assert.equal(result.check,"42");
 assert.equal(calls[1][2].head_sha,sha);
});
test("rejects spoofed sender, stale PR and publication",async()=>{
 const payload=JSON.stringify(req);
 await assert.rejects(admit({...env,CI_DISPATCH_REQUEST:payload,CI_DISPATCH_SENDER:"outsider"}),/repository event dispatchers/);
 await assert.rejects(admit({...env,CI_DISPATCH_REQUEST:payload},async()=>({state:"closed",head:{sha,ref:"topic"},base:{repo:{full_name:"org/repo"},ref:"source"}})),/Stale/);
 assert.throws(()=>validate({...req,publish:true},env),/read-only/);
});
test("status reports only for its own engine invocation",async()=>{
 const calls=[];
 const api=async(method,path,body)=>{calls.push([method,path,body]);return {external_id:"ci-engine:123",name:"CI Engine / engine / validate"};};
 await finish({...env,CI_CHECK_ID:"42",CI_CHECK_RESULT:"success"},api);
 assert.equal(calls[1][2].conclusion,"success");
 await assert.rejects(finish({...env,CI_CHECK_ID:"42"},async()=>({external_id:"ci-engine:456"})),/another invocation/);
});
