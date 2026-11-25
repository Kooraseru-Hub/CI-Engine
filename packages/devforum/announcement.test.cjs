"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {draft,deliver,inspectTopic,prepare} = require("./announcement.cjs");
const {digest} = require("./post.cjs");
const base={repository:"owner/repo",topicId:42,firstPostId:7,authorId:5,commit:"a".repeat(40),
 release:{id:12,tag_name:"2.1.0",draft:false,prerelease:false,published_at:"2026-01-01T00:00:00Z",body:"## Changes\n\nNew functionality."}};
function fixture(){
 const calls=[],receipts=new Map(),posts=[];
 const reply=(raw,id=9)=>({id,post_number:2,topic_id:42,user_id:5,raw});
 const io={async validate(){calls.push("validate")},async find(){return posts.slice()},
 async load(key){return receipts.get(key)},async reserve(key,value){calls.push("reserve");if(receipts.has(key))return false;receipts.set(key,value);return true},
 async complete(key,value){calls.push("complete");receipts.set(key,value)},
 async create(topic,raw){calls.push("create");assert.equal(topic,42);const p=reply(raw);posts.push(p);return p},
 async edit(id,raw,previous){calls.push("edit");const p=posts.find(p=>p.id===id);assert.equal(p.raw,previous);p.raw=raw},
 async verify(id){calls.push("verify");return posts.find(p=>p.id===id)}};
 return {io,calls,receipts,posts,reply};
}
test("draft is deterministic, release-specific and does not permit unpublished releases",()=>{
 const a=draft(base),b=draft({...base,release:{...base.release,body:"Updated notes"}});
 assert.equal(a.key,b.key);assert.notEqual(a.approval,b.approval);assert.deepEqual(a,draft(base));
 assert.notEqual(a.key,draft({...base,release:{...base.release,tag_name:"2.2.0"}}).key);
 for(const release of [{...base.release,draft:true},{...base.release,prerelease:true},{...base.release,published_at:null}])
  assert.throws(()=>draft({...base,release}),/published non-prerelease/);
});
test("no approval or tampered body means no remote operations",async()=>{
 const p=draft(base),f=fixture();
 await assert.rejects(deliver(p,{io:f.io}),/approval/);
 await assert.rejects(deliver({...p,raw:p.raw+"changed"},{approval:p.approval,io:f.io}),/approval/);
 assert.deepEqual(f.calls,[]);
});
test("reserve before a single create, then reconcile and edit existing reply",async()=>{
 const p=draft(base),f=fixture();
 const first=await deliver(p,{approval:p.approval,io:f.io});
 assert.equal(first.postId,9);assert.deepEqual(f.calls,["validate","reserve","create","verify","complete"]);
 await deliver(p,{approval:p.approval,io:f.io});
 const update=draft({...base,release:{...base.release,body:"Corrected notes"},existing:f.posts[0]});
 await deliver(update,{approval:update.approval,io:f.io});
 assert.equal(f.calls.filter(x=>x==="create").length,1);
 assert.equal(f.calls.filter(x=>x==="edit").length,1);
 assert.equal(f.posts[0].raw,update.raw);
});
test("lost response after successful create never duplicates; reconcile by marker",async()=>{
 const p=draft(base),f=fixture(),create=f.io.create;
 f.io.create=async(...args)=>{await create(...args);throw Error("Lost response")};
 await assert.rejects(deliver(p,{approval:p.approval,io:f.io}),/Lost response/);
 assert.equal(f.receipts.get(p.key).state,"pending");
 await deliver(p,{approval:p.approval,io:f.io});
 assert.equal(f.calls.filter(x=>x==="create").length,1);
});
test("unknown attempt, missing existing post and ambiguous matches fail closed",async()=>{
 const p=draft(base),f=fixture();
 f.io.create=async()=>{f.calls.push("create");throw Error("timeout")};
 await assert.rejects(deliver(p,{approval:p.approval,io:f.io}),/timeout/);
 await assert.rejects(deliver(p,{approval:p.approval,io:f.io}),/unresolved/);
 assert.equal(f.calls.filter(x=>x==="create").length,1);
 f.posts.push(f.reply(p.raw),f.reply(p.raw,10));
 await assert.rejects(deliver(p,{approval:p.approval,io:f.io}),/Ambiguous/);
});
test("manual edits since draft and receipt mismatches stop without creating or editing",async()=>{
 const p=draft(base),f=fixture();
 f.posts.push(f.reply(p.raw));
 const changed=draft({...base,release:{...base.release,body:"Updated"},existing:f.posts[0]});
 f.posts[0].raw+="\nHuman correction";
 await assert.rejects(deliver(changed,{approval:changed.approval,io:f.io}),/changed since draft/);
 assert.ok(!f.calls.includes("create")&&!f.calls.includes("edit"));
});
test("read-only preparation reads published tag and existing topic without writes or forum credentials",async()=>{
 const p=draft(base),requests=[];
 const request=async(url,options)=>{
  requests.push(url);assert.equal(options.method,"GET");assert.equal(options.redirect,"error");
  if(url.startsWith("https://devforum.roblox.com")) assert.equal(options.headers.Authorization,undefined);
  if(url.includes("/releases/tags/"))return Response.json(base.release);
  if(url.includes("/git/ref/tags/"))return Response.json({object:{type:"commit",sha:base.commit}});
  if(url.endsWith("/t/42.json"))return Response.json({id:42,archetype:"regular",posts_count:2,post_stream:{stream:[7,9]}});
  if(url.endsWith("/posts/7.json"))return Response.json({id:7,topic_id:42,post_number:1,user_id:5,raw:"Topic"});
  if(url.endsWith("/posts/9.json"))return Response.json({id:9,topic_id:42,post_number:2,user_id:5,raw:p.raw});
  throw Error("Unexpected URL");
 };
 const planned=await prepare(base.repository,base.release.tag_name,{destination:{topicId:42,postId:7}},{token:"read-token",request});
 assert.deepEqual(planned.expectedPost,{id:9,digest:digest(p.raw)});
 assert.equal(requests.length,5);
 await assert.rejects(inspectTopic({topicId:42,postId:7},base.repository,base.release.tag_name,async(url,options)=>{
  if(url.endsWith("/posts/9.json"))return Response.json({id:9,topic_id:42,post_number:2,user_id:5,raw:"Manual https://github.com/owner/repo/releases/tag/2.1.0"});
  return request(url,options);
 }),/manually authored/);
});

test("editable project announcement overrides notes without changing release identity",()=>{
 const original=draft(base);
 const custom=draft({...base,body:"Late announcement!\n\nNew lookup API."});
 assert.equal(custom.key,original.key);
 assert.notEqual(custom.approval,original.approval);
 assert.match(custom.raw,/^Late announcement!/);
 assert.equal(custom.releaseNotesDigest,original.releaseNotesDigest);
 const changed=draft({...base,body:"Late announcement!\n\nNew lookup API.",release:{...base.release,body:"Changed release notes"}});
 assert.notEqual(custom.approval,changed.approval);
 assert.throws(()=>draft({...base,body:"<!-- ci-release:invalid -->"}),/Invalid announcement Markdown/);
 const {announcementBody}=require("./announcement.cjs");
 assert.match(announcementBody({announcementFiles:{"2.1.0":"packages/devforum/README.md"}},"2.1.0"),/DevForum/);
 assert.equal(announcementBody({announcementFiles:{}},"2.1.0"),undefined);
 assert.throws(()=>announcementBody({announcementFiles:{"2.1.0":"../outside.md"}},"2.1.0"),/Invalid announcement file path/);
});
