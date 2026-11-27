"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto");
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
function validateManifest(entries){
    assert(Array.isArray(entries),"Asset manifest must be an array");
    const seen=new Set();
    for(const entry of entries){
        assert(typeof entry.path==="string"&&entry.path.split("/").every(part=>part&&part!=="."&&part!==".."&&!/[\\:\0]/.test(part))&&!seen.has(entry.path),"Invalid or duplicate asset path");
        seen.add(entry.path);
        assert(new URL(entry.url).protocol==="https:","Asset URL must use HTTPS");
        assert(/^[a-f0-9]{64}$/.test(entry.sha256)&&Number.isSafeInteger(entry.size)&&entry.size>0&&entry.size<=64*1024*1024,"Invalid asset integrity metadata");
    }
    return entries;
}
async function stageAssets(manifest,output,cache,fetcher=fetch){
    const entries=validateManifest(JSON.parse(fs.readFileSync(manifest,"utf8")));
    fs.mkdirSync(cache,{recursive:true});
    await Promise.all(entries.map(async entry=>{
        const cached=path.join(cache,entry.sha256);
        let bytes=fs.existsSync(cached)?fs.readFileSync(cached):null;
        if(!bytes||bytes.length!==entry.size||hash(bytes)!==entry.sha256){
            const response=await fetcher(entry.url,{signal:AbortSignal.timeout(90000)});
            assert(response.ok,"Asset download failed: "+entry.path+" ("+response.status+")");
            bytes=Buffer.from(await response.arrayBuffer());
            assert(bytes.length===entry.size&&hash(bytes)===entry.sha256,"Asset integrity mismatch: "+entry.path);
            fs.writeFileSync(cached,bytes);
        }
        const destination=path.join(output,...entry.path.split("/"));
        fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes);
    }));
    console.log("Verified documentation assets: "+entries.length);
}
module.exports={stageAssets,validateManifest};
