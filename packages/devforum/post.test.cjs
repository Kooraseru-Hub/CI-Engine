"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPublisher, digest, rawImages, publicImageURL } = require("./post.cjs");
const { fingerprint, cachedUpload, upload } = require("./upload.cjs");
const png = Buffer.from([137,80,78,71,13,10,26,10]);
const ref = "upload://abc.png";
const raw = "![Image](" + ref + ")";
const cooked = '<img alt="Image" src="https://devforum.roblox.com/uploads/image.png">';
const config = { destination: { topicId: 42, postId: 7 } };
function transport(initial = raw) {
  let current = initial;
  const calls = [];
  const request = async (url, options) => {
    calls.push({url,options});
    if (url.includes("/uploads/")) {
      assert.equal(options.headers["User-Api-Key"],undefined);
      return new Response(png,{status:206});
    }
    if (url.endsWith("/t/42.json")) return Response.json({id:42,archetype:"regular",post_stream:{posts:[{id:7,post_number:1}]}});
    if (options.method==="PUT") current=JSON.parse(options.body).post.raw;
    return Response.json({id:7,topic_id:42,post_number:1,can_edit:true,raw:current,cooked});
  };
  return {calls,request};
}
test("verify public native uploads, skip unchanged posts, reject stale snapshots",async()=>{
  const t=transport();
  const p=createPublisher(config,"secret","client",t.request);
  assert.deepEqual(await p.prepare(),{digest:digest(raw),validUploads:{[ref]:true}});
  assert.deepEqual(await p.publish(raw,digest(raw)),{changed:false,verified:1});
  await assert.rejects(p.publish(raw,"0".repeat(64)),/changed during generation/);
  assert.ok(!t.calls.some(c=>c.options.method==="PUT"));
  assert.throws(()=>publicImageURL("https://example.com/image.png"),/Unexpected/);
  assert.throws(()=>rawImages(raw+"\n"+raw),/duplicate/);
});
test("publish only the exact configured public post and verify saved content",async()=>{
  const t=transport();
  const p=createPublisher(config,"secret","client",t.request);
  assert.deepEqual(await p.publish("Updated\n"+raw,digest(raw)),{changed:true,verified:1});
  const writes=t.calls.filter(c=>c.options.method==="PUT");
  assert.equal(writes.length,1);
  assert.equal(writes[0].url,"https://devforum.roblox.com/posts/7.json");
  assert.equal(JSON.parse(writes[0].options.body).post.original_text,raw);
});
test("upload rehearsal never calls network; reuse needs digest and public verification",async()=>{
  const digest=fingerprint(png);
  assert.deepEqual(await upload(png,"example.png",{request:()=>{throw Error("network")}}),{digest,rehearsal:true});
  assert.equal(cachedUpload(png,{digest,url:ref},{[ref]:true}),ref);
  assert.equal(cachedUpload(png,{digest,url:ref},{[ref]:false}),null);
  assert.equal(cachedUpload(png,{digest:"old",url:ref},{[ref]:true}),null);
  const result=await upload(png,"example.png",{confirm:true,key:"secret",client:"client",request:async(url,options)=>{
    assert.equal(url,"https://devforum.roblox.com/uploads.json");
    assert.equal(options.redirect,"error");
    assert.equal(options.headers["User-Api-Key"],"secret");
    assert.equal(options.body.get("file").name,"example.png");
    return Response.json({short_url:ref});
  }});
  assert.deepEqual(result,{digest,url:ref,rehearsal:false});
});

test("waits for public cooked URLs without re-editing or requesting unapproved storage",async()=>{
  const t=transport();
  let put=false, reads=0, waits=0;
  const request=async(url,options)=>{
    if(options.method==="PUT") put=true;
    const res=await t.request(url,options);
    if(put && url.endsWith("/posts/7.json") && options.method==="GET" && !options.headers["User-Api-Key"] && ++reads===1){
      const post=await res.json();
      post.cooked='<img alt="Image" src="https://devforum.roblox.com/secure-uploads/example.png">';
      return Response.json(post);
    }
    return res;
  };
  const p=createPublisher(config,"secret","client",request,async ms=>{assert.equal(ms,10000);waits++});
  assert.deepEqual(await p.publish("Updated\n"+raw,digest(raw)),{changed:true,verified:1});
  assert.equal(waits,1);
  assert.equal(t.calls.filter(c=>c.options.method==="PUT").length,1);
  assert.ok(!t.calls.some(c=>c.url.includes("/secure-uploads/")));
});

test("persistent unapproved storage fails closed after bounded polling",async()=>{
  const t=transport();
  let waits=0;
  const request=async(url,options)=>{
    const res=await t.request(url,options);
    if(url.endsWith("/posts/7.json") && options.method==="GET" && !options.headers["User-Api-Key"]){
      const post=await res.json();
      post.cooked='<img alt="Image" src="https://example.com/not-public.png">';
      return Response.json(post);
    }
    return res;
  };
  const p=createPublisher(config,"secret","client",request,async()=>{waits++});
  await assert.rejects(p.publish("Updated\n"+raw,digest(raw)),/failed anonymous verification: Unexpected cooked image storage URL/);
  assert.equal(waits,9);
  assert.equal(t.calls.filter(c=>c.options.method==="PUT").length,1);
  assert.ok(!t.calls.some(c=>c.url.startsWith("https://example.com")));
});
