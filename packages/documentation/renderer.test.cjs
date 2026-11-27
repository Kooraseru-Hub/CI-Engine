"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {prepareSite,copyAssets,stageFavicon}=require("./build/renderer/build.cjs");
const {compareStructure,count}=require("./parity/structure.cjs");
const {compareCatalogue}=require("./parity/corpus.cjs");
test("renderer stages caller-owned content and theme",t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"docs-package-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const docs=path.join(root,"input"),staged=path.join(root,"staged"),theme=path.join(root,"theme.css"),stagedTheme=path.join(root,"project.css"),favicon=path.join(root,"favicon.png"),stagedFavicon=path.join(root,"public/favicon.png");
 fs.mkdirSync(path.join(docs,"repository"),{recursive:true});fs.writeFileSync(path.join(docs,"index.md"),"---\ntitle: Fixture\n---\n");fs.writeFileSync(path.join(docs,"repository","README.md"),"not a page");
 fs.writeFileSync(theme,":root{--fixture:1}");fs.writeFileSync(favicon,Buffer.from("iVBORw0KGgo=","base64"));
 prepareSite({docs,stagedDocs:staged,theme,stagedTheme,favicon,stagedFavicon});
 assert.deepEqual(fs.readdirSync(staged),["index.md"]);assert.equal(fs.readFileSync(stagedTheme,"utf8"),":root{--fixture:1}");
 assert.deepEqual(fs.readFileSync(stagedFavicon),fs.readFileSync(favicon));
});
test("generic comparison distinguishes a matching, missing and unexpected component",()=>{
 const tree=(label)=>({labels:[["main",[]],["div",[label]]],nodes:[[1],[0,0]],root:1});
 const a=tree("shared"),b=tree("other"),c=tree("unexpected");
 assert.equal(count(a),2);assert.equal(compareStructure(a,a).differences.length,0);
 assert.equal(compareStructure(a,c).counts.missing,1);
 const result=compareCatalogue([{id:"a",tree:a},{id:"b",tree:b}],[{id:"candidate",tree:a},{id:"different",tree:c}]);
 assert.deepEqual(Object.fromEntries(result.map(x=>[x.classes[0],x.status])),{other:"untested",shared:"matching",unexpected:"unexpected"});
});

test("explicit component policy distinguishes missing, untested, and excluded identities",()=>{
 const tree=(label)=>({labels:[["main",[]],["div",[label]]],nodes:[[1],[0,0]],root:1});
 const references=["required","optional","excluded","present"].map(id=>({id,tree:tree(id)}));
 const policy={required:[{tag:"div",classes:["required"]}],excluded:[{tag:"div",classes:["excluded"],reason:"Not within the consumer scope"}]};
 const result=compareCatalogue(references,[{id:"candidate",tree:tree("present")}],policy);
 assert.deepEqual(Object.fromEntries(result.map(x=>[x.classes[0],x.status])),{excluded:"excluded",optional:"untested",present:"matching",required:"missing"});
 assert.throws(()=>compareCatalogue(references,[],{required:[{tag:"div",classes:["unknown"]}]}),/Invalid or duplicate/);
});
test("one observed variant does not certify all reference variants",()=>{
 const tree=(tag)=>({labels:[["div",["container"]],[tag,[]]],nodes:[[1],[0,0]],root:1});
 const result=compareCatalogue([{id:"a",tree:tree("span")},{id:"b",tree:tree("button")}],[{id:"candidate",tree:tree("span")}]);
 assert.equal(result[0].status,"matching");assert.equal(result[0].matchingShapes.length,1);assert.equal(result[0].untestedShapes.length,1);
});

test("structured API source compiles through the shared renderer without pre-rendered HTML",()=>{
 const {compileReference}=require("./build/renderer/api-source.cjs");
 const result=compileReference({name:"Example",type:"class",summary:"A fixture.",methods:[{name:"Example:Call",parameters:[{name:"x",type:"number",summary:"Input"}],returns:[{type:"boolean",summary:"Result"}],description:"Uses a `Class.Example|fixture`."}]});
 assert.match(result,/<ApiSummary /);assert.match(result,/<ApiMember /);assert.match(result,/Example:Call\(x: number\): boolean/);
 assert.match(result,/Uses a `fixture`\./);assert.doesNotMatch(result,/Class\.Example\|fixture/);
});
test("paired corpus coverage is registered independently of screenshot scenarios",()=>{
 const {coverage}=require("./parity/corpus.cjs");
 assert.equal(coverage([{id:"a",metadata:{url:"https://example.org/a"}}],[],[{id:"a"}])[0].status,"direct-comparison");
});

test("external documentation assets must be pinned and verified",async t=>{
 const {stageAssets,validateManifest}=require("./build/renderer/reference-assets.cjs");
 const {createHash}=require("node:crypto");
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"docs-assets-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const bytes=Buffer.from("asset"),entry={path:"nested/image.png",url:"https://example.org/image.png",sha256:createHash("sha256").update(bytes).digest("hex"),size:bytes.length};
 const manifest=path.join(root,"assets.json");fs.writeFileSync(manifest,JSON.stringify([entry]));
 assert.throws(()=>validateManifest([{...entry,path:"../escape"}]));
 assert.throws(()=>validateManifest([entry,entry]));
 await stageAssets(manifest,path.join(root,"out"),path.join(root,"cache"),async()=>new Response(bytes));
 assert.deepEqual(fs.readFileSync(path.join(root,"out/nested/image.png")),bytes);
 await stageAssets(manifest,path.join(root,"second"),path.join(root,"cache"),async()=>{throw Error("must use verified cache");});
 fs.writeFileSync(manifest,JSON.stringify([{...entry,sha256:"0".repeat(64)}]));
 await assert.rejects(stageAssets(manifest,path.join(root,"out"),path.join(root,"cache"),async()=>new Response(bytes)),/integrity mismatch/);
});
