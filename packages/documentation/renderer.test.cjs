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

test("signature formatting distinguishes one parameter from multiple parameters",async()=>{
 const {parseSignature,formatSignature,normalizeType}=await import("./build/renderer/src/data/format-signature.mjs");
 assert.deepEqual(parseSignature("Part:Method(x: number, fn: (a: number, b: number) -> boolean): string").args,["x: number","fn: (a: number, b: number) -> boolean"]);
 assert.equal(formatSignature("Part:Method(x: number): boolean"),null);
 assert.deepEqual(formatSignature("Part:Method(a: number, b: string): boolean"),{before:"Part:Method(",args:"a: number, b: string",after:"): boolean"});
 assert.equal(normalizeType("List<float>"),"{number}");
 assert.equal(normalizeType("Material",{Material:{category:"Enum"}}),"Enum.Material");
 assert.equal(normalizeType("Enum.Material",{Material:{category:"Enum"}}),"Enum.Material");
});

test("structured datatype constants are deduplicated, math operations retained, and sample IDs resolved explicitly",()=>{
 const {compileReference}=require("./build/renderer/api-source.cjs");
 const missing=[];
 const result=compileReference({name:"Example",type:"datatype",summary:"Fixture",code_samples:["page"],sampleDefinitions:{page:{code:"print('page')"},member:{code:"print('member')",language:"luau"}},constants:[{name:"Example.zero",type:"Example",code_samples:["member","missing"]}],properties:[{name:"Example.zero",type:"Example"},{name:"Example.X",type:"number"}],math_operations:[{name:"*",operation:"*",type_a:"Example",type_b:"number",return_type:"Example"},{name:"*",operation:"*",type_a:"Example",type_b:"Example",return_type:"Example"}]},undefined,{onMissingSamples:ids=>missing.push(...ids)});
 assert.equal((result.match(/id=\{"zero"\}/g)||[]).length,1);
 assert.match(result,/kind=\{"constant"\}/);
 assert.match(result,/Example \* number: Example/);
 assert.match(result,/id=\{"operator-2"\}/);
 assert.match(result,/slot="samples"/);
 assert.match(result,/print\('member'\)/);
 assert.match(result,/print\('page'\)/);
 assert.deepEqual(missing,["missing"]);
 assert.doesNotMatch(result,/print\('missing'\)/);
});


test("playground samples are explicit, retain source, and do not replace static code",()=>{
 const {compileReference}=require("./build/renderer/api-source.cjs");
 const result=compileReference({name:"Example",type:"library",summary:"Example",properties:[{name:"Example.one",type:"number",summary:"Short summary.",description:"Detailed description.",code_samples:["one","static"]}],sampleDefinitions:{one:{playground:true,title:"One",description:"Interactive",code:"print(1)"},static:{code:"print(2)",language:"luau"}}});
 assert.match(result,/<LuauPlayground code=\{"print\(1\)"\}/);
 assert.match(result,/slot="summary"/);
 assert.match(result,/Short summary\./);
 assert.match(result,/print\(2\)/);
});


test("documentation typography preserves links and code semantics without touching fenced code",async()=>{
 const {default:typography}=await import("./build/renderer/typography.mjs");
 const text=value=>({type:"text",value});
 const el=(tagName,children,properties={})=>({type:"element",tagName,children,properties});
 const tree={type:"root",children:[el("p",[el("code",[text("literal")]),el("a",[el("code",[text("linked")])],{href:"/target"}),el("a",[text("ordinary")],{href:"#heading"})]),el("pre",[el("code",[text("print(1)")])])]};
 typography()(tree);
 const [paragraph,block]=tree.children;
 assert(paragraph.properties.className.includes("Typography-body1-Typography-root-root"));
 const [literal,linked,ordinary]=paragraph.children;
 assert.equal(literal.tagName,"span");assert.equal(literal.properties.role,"code");
 assert(literal.properties.className.includes("inline-code"));
 assert.equal(linked.tagName,"span");assert.equal(linked.children[0].tagName,"a");
 assert.equal(linked.children[0].properties.href,"/target");
 assert(linked.children[0].properties.className.includes("MuiLink-underlineNone"));
 assert(ordinary.properties.className.includes("MuiLink-underlineHover"));
 assert.equal(block.children[0].tagName,"code");
 assert.deepEqual(block.children[0].properties,{});
});
