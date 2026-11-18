"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {normalize,trusted,reviewTrusted,normalizeReview}=require("../src/adapters/github/delivery.cjs");
const sha="a".repeat(40),env={ACT:"",GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"repository_dispatch",CI_ORIGIN_TRUSTED:"true",CI_DELIVERY_CONFIRM:"true",CI_ORIGIN_EVENT:"workflow_dispatch",CI_ORIGIN_SHA:sha,GITHUB_SHA:sha,CI_ORIGIN_REF:"refs/heads/source",CI_DEFAULT_BRANCH:"source"};
const job={id:"labels/sync",lane:"issues",environment:"ci-publication",command:["node","publish.cjs"]};
test("delivery requires the confirmed immutable trusted request",()=>{
 assert.doesNotThrow(()=>trusted(env));
 for(const v of [{ACT:"true"},{CI_ORIGIN_TRUSTED:"false"},{CI_DELIVERY_CONFIRM:"false"},{CI_ORIGIN_EVENT:"pull_request"},{GITHUB_SHA:"b".repeat(40)},{CI_ORIGIN_REF:"refs/heads/topic"}])assert.throws(()=>trusted({...env,...v}),/trusted default-branch/);
});
test("delivery plan is typed and scoped to static permission lanes",()=>{
 const plan=normalize({artifact:"build/outputs",destination:"build/outputs",jobs:[job,{...job,id:"pages",lane:"pages",pages_path:"build/site",options_command:["node","options.js"]}]});
 assert.equal(plan.jobs[0].lane,"issues");assert.equal(plan.jobs[1].pages_path,"build/site");assert.equal(plan.jobs[0].bindings.length,3);
 for(const raw of [{jobs:[{...job,lane:"all"}]},{jobs:[job,job]},{jobs:[{...job,env:{GH_TOKEN:"x"}}]},{jobs:[{...job,bindings:[{role:"PATH",source:"secret",name:"KEY"}]}]},{jobs:[job],artifact:"build/../source",destination:"build/out"}])assert.throws(()=>normalize(raw));
});
test("preview preparation and publisher use distinct checkout and artifact paths",()=>{
 const result=normalize({artifact:"build/ci-candidate/build/site",destination:"build/preview-candidate",prepare:{ref:sha,command:["node","build.js"],env:{DOCS_BASE:"/repo/"}},jobs:[{...job,id:"preview",lane:"external",bindings:[{role:"CI_EXTERNAL_TOKEN",source:"secret",name:"CLOUDFLARE_API_TOKEN"}]}]});
 assert.equal(result.prepare.ref,sha);assert.equal(result.jobs[0].bindings[0].name,"CLOUDFLARE_API_TOKEN");
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
