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
