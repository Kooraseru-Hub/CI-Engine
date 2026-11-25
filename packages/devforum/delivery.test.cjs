"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {send,receiptStore}=require("./delivery.cjs");
const {draft}=require("./announcement.cjs");
const repo="owner/repo",tag="2.1.0",commit="a".repeat(40);
const release={id:11,tag_name:tag,draft:false,prerelease:false,published_at:"2026-01-01T00:00:00Z",body:"## Changes\n\nNew features."};
const config={destination:{topicId:42,postId:7},delivery:{receiptBranch:"main",receiptDirectory:"content/readme/receipts"}};
const env={GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_REPOSITORY:repo,
 GITHUB_REF:"refs/heads/source",CI_DEFAULT_BRANCH:"source",GH_TOKEN:"github",DEVFORUM_UPLOAD_KEY:"forum",DEVFORUM_UPLOAD_CLIENT:"client"};
const plan=()=>draft({repository:repo,release,commit,topicId:42,firstPostId:7,authorId:5});
function transport(){
 const calls=[],files=new Map(),posts=new Map();
 const first={id:7,topic_id:42,post_number:1,user_id:5,raw:"Topic",can_edit:true};
 const options={lost:false,wrongActor:false,receiptConflict:false};
 let sequence=1;
 const request=async(url,opts)=>{
   calls.push({url,method:opts.method,headers:opts.headers});
   const u=new URL(url),body=opts.body?JSON.parse(opts.body):null;
   if(u.origin==="https://api.github.com"){
     assert.equal(opts.headers.Authorization,"Bearer github");assert.equal(opts.headers["User-Api-Key"],undefined);
     if(u.pathname.includes("/releases/tags/"))return Response.json(release);
     if(u.pathname.includes("/git/ref/tags/"))return Response.json({object:{type:"commit",sha:commit}});
     if(u.pathname.includes("/git/ref/heads/"))return Response.json({ref:"refs/heads/main",object:{type:"commit",sha:commit}});
     if(u.pathname.includes("/contents/")){
       const key=u.pathname;
       if(opts.method==="GET")return files.has(key)?Response.json(files.get(key)):new Response(null,{status:404});
       const prior=files.get(key);
       if(options.receiptConflict||(!body.sha&&prior)||(body.sha&&prior?.sha!==body.sha))return new Response(null,{status:409});
       const file={type:"file",sha:String(sequence++).padStart(40,"0"),encoding:"base64",content:body.content};
       files.set(key,file);return Response.json({content:file},{status:201});
     }
   }
   assert.equal(u.origin,"https://devforum.roblox.com");assert.equal(opts.headers.Authorization,undefined);
   if(u.pathname==="/t/42.json")return Response.json({id:42,archetype:"regular",posts_count:1+posts.size,post_stream:{stream:[7,...posts.keys()]}});
   if(u.pathname==="/session/current.json"){
     assert.equal(opts.headers["User-Api-Key"],"forum");
     return Response.json({current_user:{id:options.wrongActor?999:5}});
   }
   if(u.pathname==="/posts/7.json")return Response.json(first);
   if(u.pathname==="/posts.json"){
     assert.equal(opts.method,"POST");assert.equal(opts.headers["User-Api-Key"],"forum");
     assert.equal(body.topic_id,42);assert.equal(files.size,1);
     const saved={id:9,topic_id:42,post_number:2,user_id:5,raw:body.raw,can_edit:true};
     posts.set(9,saved);
     if(options.lost)throw Error("response lost");
     return Response.json(saved);
   }
   if(u.pathname==="/posts/9.json"){
     const saved=posts.get(9);
     if(!saved)return new Response(null,{status:404});
     if(opts.method==="PUT"){assert.equal(body.post.original_text,saved.raw);saved.raw=body.post.raw}
     return Response.json(saved);
   }
   throw Error("Unexpected request "+url);
 };
 return {calls,files,posts,options,request};
}
test("approved live adapter reserves durable receipt before posting; never leaks credentials",async()=>{
 const f=transport();
 const result=await send(repo,tag,config,plan().approval,{env,request:f.request,wait:async()=>{}});
 assert.equal(result.postId,9);
 const writes=f.calls.filter(c=>c.method!=="GET");
 assert.deepEqual(writes.map(c=>c.method),["PUT","POST","PUT"]);
 const receipt=JSON.parse(Buffer.from([...f.files.values()][0].content,"base64"));
 assert.equal(receipt.state,"published");assert.equal(receipt.postId,9);
});
test("ambiguous send persists reservation and subsequent attempt reconciles without duplicate",async()=>{
 const f=transport();f.options.lost=true;
 await assert.rejects(send(repo,tag,config,plan().approval,{env,request:f.request,wait:async()=>{}}),/response lost/);
 const record=JSON.parse(Buffer.from([...f.files.values()][0].content,"base64"));assert.equal(record.state,"pending");
 await assert.rejects(send(repo,tag,config,plan().approval,{env,request:f.request,wait:async()=>{}}),/draft changed/);
 const approved=draft({repository:repo,release,commit,topicId:42,firstPostId:7,authorId:5,existing:f.posts.get(9)});
 const result=await send(repo,tag,config,approved.approval,{env,request:f.request,wait:async()=>{}});
 assert.equal(result.postId,9);assert.equal(f.calls.filter(c=>c.method==="POST").length,1);
});
test("wrong actor, stale approval, untrusted run and receipt conflict never create a reply",async()=>{
 const f=transport();f.options.wrongActor=true;
 await assert.rejects(send(repo,tag,config,plan().approval,{env,request:f.request}),/not the topic author/);
 assert.ok(f.calls.every(c=>c.method==="GET"));
 await assert.rejects(send(repo,tag,config,"0".repeat(64),{env,request:f.request}),/draft changed/);
 await assert.rejects(send(repo,tag,config,plan().approval,{env:{...env,GITHUB_EVENT_NAME:"release"},request:f.request}),/trusted default branch/);
 f.options.wrongActor=false;f.options.receiptConflict=true;
 await assert.rejects(send(repo,tag,config,plan().approval,{env,request:f.request}),/reserved/);
 assert.ok(!f.calls.some(c=>c.method==="POST"));
});
