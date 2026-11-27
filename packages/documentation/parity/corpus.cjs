"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto");
const {loadReference,count}=require("./structure.cjs");

function loadCorpus(root,sources){
    assert(Array.isArray(sources)&&sources.length>0,"Configure at least one reference source");
    const seen=new Set(),directories=new Set();
    const workspace=fs.realpathSync(root);
    return sources.map(source=>{
        const {id,url,reference}=source;
        assert(typeof id==="string"&&/^[a-z][a-z0-9-]*$/.test(id)&&!seen.has(id),"Invalid or duplicate reference ID");seen.add(id);
        assert(typeof url==="string"&&new URL(url).protocol==="https:","Reference must use HTTPS");
        assert(typeof reference==="string"&&!path.isAbsolute(reference)&&reference.split("/").every(part=>part&&part!=="."&&part!==".."&&!part.includes("\\")),"Invalid reference path");
        const folder=fs.realpathSync(path.resolve(workspace,reference));
        const relative=path.relative(workspace,folder);
        assert(relative&&!relative.startsWith(".."+path.sep)&&relative!==".."&&!path.isAbsolute(relative),"Reference escaped workspace");
        assert(!directories.has(folder),"Duplicate reference directory");directories.add(folder);
        const provenance=JSON.parse(fs.readFileSync(path.join(folder,"structure-provenance.json"),"utf8"));
        assert.equal(provenance.capture.url,url,"Configured URL differs from captured URL");
        const tree=loadReference(folder);
        return {id,folder,metadata:{...provenance,url,elements:count(tree),uniqueLabels:tree.labels.length,uniqueShapes:tree.nodes.length},tree};
    });
}

// Index exact ordered descendant shapes across independently sourced documents.
// Occurrence counts are per document, never a sum a single candidate must match.
function catalogue(documents){
    const entries=new Map();
    for(const {id,tree} of documents){
        const hashes=[],sizes=[];
        for(const node of tree.nodes){
            hashes.push(createHash("sha256").update(JSON.stringify([tree.labels[node[0]],node.slice(1).map(child=>hashes[child])])).digest("hex"));
            sizes.push(1+node.slice(1).reduce((n,child)=>n+sizes[child],0));
        }
        function visit(index){
            const node=tree.nodes[index],label=tree.labels[node[0]];
            if(label[1].length){
                const key=JSON.stringify(label);
                if(!entries.has(key))entries.set(key,{tag:label[0],classes:label[1],documents:{},shapes:new Map()});
                const entry=entries.get(key);
                entry.documents[id]=(entry.documents[id]||0)+1;
                const hash=hashes[index];
                if(!entry.shapes.has(hash))entry.shapes.set(hash,{hash,elements:sizes[index],documents:{}});
                const shape=entry.shapes.get(hash);
                shape.documents[id]=(shape.documents[id]||0)+1;
            }
            for(const child of node.slice(1))visit(child);
        }
        visit(tree.root);
    }
    return [...entries.values()].map(entry=>({...entry,shapes:[...entry.shapes.values()].sort((a,b)=>a.hash.localeCompare(b.hash))})).sort((a,b)=>JSON.stringify([a.tag,a.classes]).localeCompare(JSON.stringify([b.tag,b.classes])));
}
function coverage(documents,experiments){
    return documents.map(({id,metadata})=>{
        const experiment=experiments.find(x=>x.id===id);
        if(experiment)assert.equal(experiment.spec.reference,metadata.url,"Experiment reference URL differs from corpus");
        return {id,url:metadata.url,elements:metadata.elements,assetRevision:metadata.assetRevision,status:experiment?"direct-comparison":"component-reference"};
    });
}
// Compare a candidate's observed component shapes to the union of registered reference shapes.
// Absence is untested, not failure, unless the caller specifies required identities.
// Occurrence counts in unrelated documents must not be treated as candidate expectations.
function compareCatalogue(references,candidates,policy={}){
    const expected=catalogue(references),actual=catalogue(candidates);
    const key=x=>JSON.stringify([x.tag,[...new Set(x.classes)].sort()]);
    const referenceMap=new Map(expected.map(x=>[key(x),x]));
    const actualMap=new Map(actual.map(x=>[key(x),x]));
    const required=new Set(),excluded=new Map();
    for(const component of policy.required||[]){
        const id=key(component);
        assert(referenceMap.has(id)&&!required.has(id),"Invalid or duplicate required component: "+id);
        required.add(id);
    }
    for(const component of policy.excluded||[]){
        const id=key(component);
        assert((referenceMap.has(id)||actualMap.has(id))&&!required.has(id)&&!excluded.has(id)&&typeof component.reason==="string"&&component.reason.trim(),"Invalid excluded component: "+id);
        excluded.set(id,component.reason);
    }
    const result=expected.map(entry=>{
        const id=key(entry),other=actualMap.get(id);actualMap.delete(id);
        const shapes=new Set(entry.shapes.map(x=>x.hash)),observed=new Set((other?.shapes||[]).map(x=>x.hash));
        const matching=other?.shapes.filter(x=>shapes.has(x.hash))||[];
        const different=other?.shapes.filter(x=>!shapes.has(x.hash))||[];
        const untested=entry.shapes.filter(x=>!observed.has(x.hash));
        return {tag:entry.tag,classes:entry.classes,sources:Object.keys(entry.documents),candidateDocuments:Object.keys(other?.documents||{}),
            status:excluded.has(id)?"excluded":!other?(required.has(id)?"missing":"untested"):different.length?"different":"matching",
            required:required.has(id),...(excluded.has(id)?{reason:excluded.get(id)}:{}),
            matchingShapes:matching,differentShapes:different,untestedShapes:untested,referenceVariants:entry.shapes.length};
    });
    for(const entry of actualMap.values()){
        const id=key(entry);
        result.push({tag:entry.tag,classes:entry.classes,sources:[],candidateDocuments:Object.keys(entry.documents),status:excluded.has(id)?"excluded":"unexpected",required:false,...(excluded.has(id)?{reason:excluded.get(id)}:{}),matchingShapes:[],differentShapes:entry.shapes,untestedShapes:[],referenceVariants:0});
    }
    return result;
}
module.exports={loadCorpus,catalogue,coverage,compareCatalogue};
