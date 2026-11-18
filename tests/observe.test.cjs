"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {title,discover,observe}=require("../src/adapters/github/observe.cjs");
const sha="a".repeat(40),env={GITHUB_REPOSITORY:"org/repo",CI_OPERATION:"review",REQUEST_SHA:sha,REQUEST_ID:"123-2"};
const target={id:42,event:"repository_dispatch",display_title:title("review",sha,"123-2")};
const tick=()=>Promise.resolve();
test("request correlation ignores another attempt at the same revision",async()=>{
 const result=await discover(env,async()=>({workflow_runs:[{...target,id:41,display_title:title("review",sha,"123-1")},target]}),tick);
 assert.equal(result.run_id,"42");
});
test("discovery rejects ambiguous request identity",async()=>{
 await assert.rejects(discover(env,async()=>({workflow_runs:[target,{...target,id:43}]}),tick),/Ambiguous/);
});
test("phase signals wait for the specific job, not another job or the overall run",async()=>{
 let polls=0;
 const result=await observe("Authorize","42",env,async path=>path.includes("/jobs?")
  ? {jobs:[{id:1,name:"CI Engine / engine / Resolve",status:"completed",conclusion:"success"},{id:2,name:"CI Engine / engine / Authorize",status:++polls===2?"completed":"in_progress",conclusion:"success"}]}
  : {...target,status:"in_progress"},tick);
 assert.deepEqual(result,{conclusion:"success",job_id:"2"});
 assert.equal(polls,2);
});
test("terminal failure and cancellation are propagated only after completion",async()=>{
 for(const conclusion of ["failure","cancelled","success"]){
  let polls=0;
  const result=await observe("Complete","42",env,async()=>({...target,status:++polls===2?"completed":"in_progress",conclusion}),tick);
  assert.equal(result.conclusion,conclusion);assert.equal(polls,2);
 }
});
test("engine failure before a requested phase does not become a successful signal",async()=>{
 await assert.rejects(observe("Authorize","42",env,async path=>path.includes("/jobs?")?{jobs:[]}:{...target,status:"completed",conclusion:"failure"},tick),/before reaching/);
});
