"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { encode, readTree } = require("./model.cjs");

function chunks(buffer) {
  assert.equal(buffer.subarray(0,8).toString(),"<roblox!");
  const classes=buffer.readUInt32LE(16), count=buffer.readUInt32LE(20);
  let offset=32;
  const result=[];
  while(offset<buffer.length){
    const name=buffer.subarray(offset,offset+4).toString();
    assert.equal(buffer.readUInt32LE(offset+4),0);
    const length=buffer.readUInt32LE(offset+8);
    const payload=buffer.subarray(offset+16,offset+16+length);
    assert.equal(payload.length,length);
    result.push({name,payload});
    offset+=16+length;
  }
  assert.equal(offset,buffer.length);
  assert.equal(result.at(-1).name,"END\0");
  return {classes,count,result};
}
test("binary model contains module, folder, source and parent chunks",()=>{
  const root={name:"Example",source:Buffer.from("return 1"),children:new Map([["Folder",{name:"Folder",children:new Map([["Child",{name:"Child",source:Buffer.from("return 2"),children:new Map()}]])}]])};
  const data=encode(root);
  const parsed=chunks(data);
  assert.equal(parsed.classes,2);
  assert.equal(parsed.count,3);
  assert.equal(parsed.result.filter(x=>x.name==="INST").length,2);
  assert.equal(parsed.result.filter(x=>x.name==="PROP").length,3);
  assert.ok(parsed.result.some(x=>x.name==="PRNT"));
  for(const str of ["Example","Folder","Child","return 1","return 2"])assert.ok(data.includes(str));
  assert.deepEqual(encode(root),data);
});
test("historical source is read from Git instead of modified working tree", t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"rbxm-test-"));
  const cwd=process.cwd();
  t.after(()=>{process.chdir(cwd);fs.rmSync(root,{recursive:true,force:true})});
  process.chdir(root);
  const git=(...args)=>execFileSync("git",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  git("init","--quiet");
  fs.mkdirSync("lib/sub",{recursive:true});
  fs.writeFileSync("lib/init.luau","return 1");
  fs.writeFileSync("lib/sub/child.luau","return 2");
  git("add",".");
  git("-c","user.name=Test","-c","user.email=test@example.invalid","commit","-m","fixture");
  const sha=git("rev-parse","HEAD");
  fs.writeFileSync("lib/init.luau","return 999");
  const model=readTree(sha,"lib","Example");
  assert.equal(model.name,"Example");
  assert.equal(model.source.toString(),"return 1");
  assert.equal(model.children.get("sub").children.get("child").source.toString(),"return 2");
  assert.throws(()=>readTree(sha,"../lib","Example"),/safe repository-relative/);
  const one=readTree(sha,"lib/init.luau","Single");
  assert.equal(chunks(encode(one)).count,1);
});
