"use strict";
const groups=[["constructors","constructor"],["constants","constant"],["properties","property"],["methods","method"],["functions","function"],["events","event"],["callbacks","callback"],["operators","operator"],["math_operations","operator"]];
const display=x=>String(x??"").replace(/\r\n/g,"\n").trim();
const json=x=>JSON.stringify(x);
const label=key=>key.split("_").map(word=>word[0].toUpperCase()+word.slice(1)).join(" ");
const text=x=>display(x).replace(/`(?:Class|Datatype|Enum|Library|Global)\.([^`]+)`/g,(_,name)=>"`"+name.split("|").at(-1)+"`");
function markdown(value,sourceUrl){
    const segments=text(value).split(/(`{3,}[\s\S]*?`{3,}|`[^`\n]+`)/g);
    return segments.map((part,i)=>{
        if(i%2)return part;
        return part.replace(/\]\(([^)\s]+)\)/g,(whole,href)=>{
            if(!sourceUrl||/^(?:[a-z]+:|#|\/\/)/i.test(href))return whole;
            const url=new URL(href,sourceUrl);url.pathname=url.pathname.replace(/\/index\.md$/,"/").replace(/\.md$/,"");return "]("+url.href+")";
        }).replace(/[{}<>]/g,x=>({"<":"&lt;",">":"&gt;","{":"&#123;","}":"&#125;"}[x]));
    }).join("");
}
function entry(member,kind,sourceUrl){
    const name=display(member.name),short=kind==="operator"?name:name.split(/[.:]/).at(-1);
    const parameters=(member.parameters||[]).map(x=>({name:display(x.name),type:display(x.type),description:text(x.summary),...(x.default!==null&&x.default!==undefined?{defaultValue:display(x.default)}:{})}));
    const returns=(member.returns||[]).map(x=>({name:display(x.name),type:display(x.type),description:text(x.summary)}));
    const callable=["constructor","method","function","callback","operator","event"].includes(kind);
    const returnType=returns.map(x=>x.type).join(", ");
    const args=parameters.map(x=>x.name+": "+x.type).join(", ");
    const operation=kind==="operator"&&member.operation&&member.type_a&&member.type_b?display(member.type_a)+" "+display(member.operation)+" "+display(member.type_b)+": "+display(member.return_type):null;
    const signature=operation||(callable?name+"("+args+")"+(returnType?": "+returnType:""):name+": "+display(member.type));
    const summarySignature=operation||(kind==="event"?short+": RBXScriptSignal":callable?short+"("+args+")"+(returnType?": "+returnType:""):short+": "+display(member.type));
    return {name:operation?operation.split(":")[0]:short,kind,signature,summarySignature,description:markdown(member.description||member.summary,sourceUrl),summary:text(member.summary),parameters,returns,deprecated:(member.tags||[]).includes("Deprecated"),deprecation:display(member.deprecation_message),metadata:[...(member.tags||[]).filter(x=>!["Deprecated","None"].includes(x)).map(value=>({label:"Tag",value})),...(member.thread_safety?[{label:"Thread safety",value:member.thread_safety}]:[])],samples:member.code_samples||[]};
}
function appendSamples(lines,samples,definitions,missing){
    for(const sample of samples||[]){
        const item=typeof sample==="string"?(Object.hasOwn(definitions,sample)?definitions[sample]:undefined):sample;
        if(!item||typeof item.code!=="string"){missing.add(typeof sample==="string"?sample:"<invalid sample>");continue;}
        const code=item.code.replace(/\r\n/g,"\n");
        const fence="`".repeat(Math.max(3,...[...code.matchAll(/`+/g)].map(m=>m[0].length+1)));
        const language=/^[a-zA-Z0-9_+-]+$/.test(item.language||"")?item.language:"luau";
        if(item.title)lines.push("**"+markdown(item.title)+"**","");
        lines.push(fence+language,""+code,fence,"");
    }
}
function compileReference(data,componentPrefix="../../components/",options={}){
    if(!data||typeof data.name!=="string"||!data.name.trim())throw Error("API source requires a name");
    const title=data.name,summary=markdown(data.summary,data.sourceUrl),description=markdown(data.description,data.sourceUrl),types=data.typeReferences||{};
    const definitions=data.sampleDefinitions||{},missing=new Set();
    const lines=["---","title: "+json(title),"description: "+json(text(data.summary).replace(/\s+/g," ").slice(0,500)||title),"---","", "import ApiSummary from "+json(componentPrefix+"ApiSummary.astro")+";","import ApiMember from "+json(componentPrefix+"ApiMember.astro")+";","import ApiInteractions from "+json(componentPrefix+"ApiInteractions.astro")+";","","export const types = "+json(types)+";","",summary,""];
    if(data.tags?.length){lines.splice(7,0,"import ApiTags from "+json(componentPrefix+"ApiTags.astro")+";");lines.push('<div className="api-class-status" aria-label="Class tags"><ApiTags labels={'+json(data.tags.map(x=>String(x).replace(/([a-z])([A-Z])/g,"$1 $2")))+'} /></div>',"");}
    if(data.items?.length){
        lines.push("## Summary","","### Items","","<ApiEnumTable items={"+json(data.items.map(x=>({name:x.name,value:x.value,description:text(x.summary),deprecated:(x.tags||[]).includes("Deprecated")})))+"} />","","## Usage","",description,"");
        lines.splice(7,0,"import ApiEnumTable from "+json(componentPrefix+"ApiEnumTable.astro")+";");
    }else{
        const ordering=data.type==="library"?[["functions","function"],...groups.filter(([k])=>k!=="functions")]:groups;
        const constants=new Set((data.constants||[]).map(x=>x.name));
        const used=new Map(),sections=ordering.map(([key,kind])=>[key,kind,(Array.isArray(data[key])?data[key]:[]).filter(x=>key!=="properties"||!constants.has(x.name))]).filter(([, ,members])=>members.length).map(([key,kind,members])=>[key,members.map(x=>{
            const m=entry(x,kind,data.sourceUrl);const slug=kind==="operator"?"operator":m.name.toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-|-$/g,"")||kind;
            const occurrence=(used.get(slug)||0)+1;used.set(slug,occurrence);m.id=slug+(occurrence>1?"-"+occurrence:"");return m;
        })]);
        if(sections.length)lines.push("## Summary","");
        for(const [key,members] of sections)lines.push("### "+label(key),"","<ApiSummary types={types} members={"+json(members.map(m=>({kind:m.kind,signature:m.summarySignature,href:"#"+m.id,deprecated:m.deprecated,description:m.summary})))+"} />","");
        if(description&&description!==summary)lines.push(description,"");
        const pageSamples=[];appendSamples(pageSamples,data.code_samples,definitions,missing);
        if(pageSamples.length)lines.push("## Code Samples","",...pageSamples);
        for(const [key,members] of sections){
            lines.push("## "+label(key)+" Reference","");
            for(const m of members){
                const props={id:m.id,name:m.name,kind:m.kind,signature:m.signature,deprecated:m.deprecated,deprecation:m.deprecation,metadata:m.metadata,parameters:m.parameters,returns:m.returns};
                lines.push("### "+m.id,"","<ApiMember "+Object.entries(props).map(([k,value])=>k+"={"+json(value)+"}").join(" ")+" types={types}>","");
                if(m.description)lines.push('<div slot="body">',"",m.description,"","</div>","");
                const sampleLines=[];appendSamples(sampleLines,m.samples,definitions,missing);
                if(sampleLines.length)lines.push('<div slot="samples" className="docs-code-sample">' ,"",...sampleLines,"</div>","");
                lines.push("</ApiMember>","");
            }
        }
    }
    if(missing.size){const warn=options.onMissingSamples||((ids)=>console.warn("Documentation: "+title+" has unresolved code samples: "+ids.join(", ")));warn([...missing]);}
    lines.push("<ApiInteractions />","");
    return lines.join("\n");
}
module.exports={compileReference,markdown,entry};
