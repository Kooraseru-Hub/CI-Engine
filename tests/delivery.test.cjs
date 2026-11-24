"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {normalize,trusted,reviewTrusted,normalizeReview,bindCredentials}=require("../src/adapters/github/delivery.cjs");
const sha="a".repeat(40),env={ACT:"",GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"repository_dispatch",CI_ORIGIN_TRUSTED:"true",CI_DELIVERY_CONFIRM:"true",CI_ORIGIN_EVENT:"workflow_dispatch",CI_ORIGIN_SHA:sha,GITHUB_SHA:sha,CI_ORIGIN_REF:"refs/heads/source",CI_DEFAULT_BRANCH:"source"};
const job={id:"labels/sync",lane:"issues",environment:"ci-publication",command:["node","publish.cjs"]};
test("delivery requires the confirmed immutable trusted request",()=>{
 assert.doesNotThrow(()=>trusted(env));
 for(const v of [{ACT:"true"},{CI_ORIGIN_TRUSTED:"false"},{CI_DELIVERY_CONFIRM:"false"},{CI_ORIGIN_EVENT:"pull_request"},{GITHUB_SHA:"b".repeat(40)},{CI_ORIGIN_REF:"refs/heads/topic"}])assert.throws(()=>trusted({...env,...v}),/trusted default-branch/);
});
test("delivery plan is typed and scoped to static permission lanes",()=>{
 const plan=normalize({artifact:"build/outputs",destination:"build/outputs",jobs:[job,{...job,id:"pages",lane:"pages",pages_path:"build/site",options_command:["node","options.js"]}]});
 assert.equal(plan.jobs[0].lane,"issues");assert.equal(plan.jobs[1].pages_path,"build/site");assert.equal(plan.jobs[0].bindings.length,0);
 for(const raw of [{jobs:[{...job,lane:"all"}]},{jobs:[job,job]},{jobs:[{...job,env:{GH_TOKEN:"x"}}]},{jobs:[{...job,bindings:[{role:"PATH",source:"secret",name:"KEY"}]}]},{jobs:[job],artifact:"build/../source",destination:"build/out"}])assert.throws(()=>normalize(raw));
});
test("preview preparation and publisher use distinct checkout and artifact paths",()=>{
 const result=normalize({artifact:"build/ci-candidate/build/site",destination:"build/preview-candidate",prepare:{ref:sha,command:["node","build.js"],env:{DOCS_BASE:"/repo/"}},jobs:[{...job,id:"preview",lane:"external",bindings:[{role:"CI_EXTERNAL_TOKEN",source:"secret",name:"EXAMPLE_KEY"}]}]});
 assert.equal(result.prepare.ref,sha);assert.equal(result.jobs[0].bindings[0].name,"EXAMPLE_KEY");
 assert.throws(()=>normalize({jobs:[job],artifact:"build/source",destination:"build/out",prepare:{ref:sha,command:["node","build.js"]}}),/isolated/);
});

test("review authority is distinct and can only publish an isolated external artifact",()=>{
 const review={...env,CI_ORIGIN_EVENT:"pull_request",CI_ORIGIN_TRUSTED:"false",CI_DELIVERY_CONFIRM:"false",CI_REVIEW_PR:"7",GITHUB_REF:"refs/heads/source",GITHUB_SHA:"b".repeat(40)};
 assert.doesNotThrow(()=>reviewTrusted(review));assert.throws(()=>trusted(review));
 for(const v of [{CI_REVIEW_PR:""},{CI_ORIGIN_TRUSTED:"true"},{CI_DELIVERY_CONFIRM:"true"},{GITHUB_REF:"refs/heads/topic"},{CI_ORIGIN_EVENT:"push"}])assert.throws(()=>reviewTrusted({...review,...v}));
 const raw={artifact:"build/ci-candidate/build/site",destination:"build/site",prepare:{ref:sha,command:["node","build.js"]},jobs:[{...job,lane:"external"}]};
 assert.equal(normalizeReview(raw,review).jobs[0].lane,"external");
 assert.throws(()=>normalizeReview({...raw,jobs:[job]},review));assert.throws(()=>normalizeReview({...raw,prepare:{...raw.prepare,ref:"b".repeat(40)}},review));
 assert.throws(()=>normalize({...raw,jobs:[{...job,lane:"external",env:{CI_REVIEW_PR:"9"}}]}));
});


test("delivery binds arbitrary named credentials only to selected roles",()=>{
 const bindings=Array.from({length:8},(_,i)=>({role:"CI_CREDENTIAL_ROLE_"+i,source:i%2?"variable":"secret",name:"EXAMPLE_"+i}));
 const entry=normalize({jobs:[{...job,bindings}]}).jobs[0];
 const values=Object.fromEntries(bindings.map((b,i)=>["CI_BIND_"+b.source.toUpperCase()+"_"+b.name,"fixture-"+i]));
 const child=bindCredentials(entry,{...values,CI_BIND_SECRET_UNRELATED:"never",CI_CREDENTIAL_OTHER:"never",CI_EXTERNAL_OTHER:"never",GH_TOKEN:"job-token"});
 assert.equal(entry.bindings.length,8);
 assert.deepEqual(entry.secret_names,["EXAMPLE_0","EXAMPLE_2","EXAMPLE_4","EXAMPLE_6"]);
 for(let i=0;i<8;i++)assert.equal(child["CI_CREDENTIAL_ROLE_"+i],"fixture-"+i);
 assert.equal(child.GH_TOKEN,"job-token");
 assert.ok(!Object.keys(child).some(k=>k.startsWith("CI_BIND_")||k.endsWith("_OTHER")));
 assert.throws(()=>bindCredentials(entry,{}),/Missing required secret EXAMPLE_0/);
 assert.throws(()=>normalize({jobs:[{...job,env:{CI_BIND_SECRET_EXAMPLE_0:"injected"}}]}),/Invalid delivery environment/);
 assert.throws(()=>normalize({jobs:[{...job,env:{CI_EXTERNAL_OTHER:"injected"}}]}),/Invalid delivery environment/);
 const optional=normalize({jobs:[{...job,bindings:[{...bindings[0],required:false}]}]}).jobs[0];
 assert.equal(bindCredentials(optional,{}).CI_CREDENTIAL_ROLE_0,undefined);
});
test("delivery process executes with selected credentials and fails before invoking a component if required credentials are missing",()=>{
 const {spawnSync}=require("node:child_process");
 const path=require("node:path");
 const bindings=Array.from({length:6},(_,i)=>({role:"CI_EXTERNAL_ROLE_"+i,source:i%2?"variable":"secret",name:"EXAMPLE_"+i}));
 const raw={...job,lane:"external",bindings,command:[process.execPath,"-e",`
  const assert=require("node:assert/strict");
  for(let i=0;i<6;i++)assert.equal(process.env["CI_EXTERNAL_ROLE_"+i],"fixture-"+i);
  assert.ok(!Object.keys(process.env).some(key=>key.startsWith("CI_BIND_")||key==="CI_EXTERNAL_UNUSED"));
  console.log("component invoked");
 `]};
 const values=Object.fromEntries(bindings.map((b,i)=>["CI_BIND_"+b.source.toUpperCase()+"_"+b.name,"fixture-"+i]));
 const transport={...process.env,...env,...values,CI_DELIVERY_LANE:"external",CI_DELIVERY_ENTRY:JSON.stringify(raw),CI_DELIVERY_OPERATION:"publish",CI_BIND_SECRET_UNRELATED:"unused",CI_EXTERNAL_UNUSED:"unused"};
 const script=path.join(__dirname,"../src/adapters/github/delivery.cjs");
 const success=spawnSync(process.execPath,[script,"delivery-run"],{env:transport,encoding:"utf8"});
 assert.equal(success.status,0,success.stderr);
 assert.match(success.stdout,/component invoked/);
 const failure=spawnSync(process.execPath,[script,"delivery-run"],{env:{...transport,CI_BIND_SECRET_EXAMPLE_0:""},encoding:"utf8"});
 assert.equal(failure.status,1);
 assert.match(failure.stderr,/Missing required secret EXAMPLE_0/);
 assert.doesNotMatch(failure.stdout,/component invoked/);
});
