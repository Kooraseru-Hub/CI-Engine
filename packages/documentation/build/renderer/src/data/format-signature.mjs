// Parse top-level callable arguments; nested types and callback tuples remain intact.
export function splitArguments(value) {
  const result=[];let start=0;const stack=[];
  const pairs={")":"(","}":"{","]":"[",">":"<"};
  for(let i=0;i<value.length;i++){
    const c=value[i];
    if("({[<".includes(c))stack.push(c);
    else if(pairs[c]&&stack.at(-1)===pairs[c])stack.pop();
    else if(c===","&&!stack.length){result.push(value.slice(start,i).trim());start=i+1;}
  }
  if(value.slice(start).trim())result.push(value.slice(start).trim());
  return result;
}
export function parseSignature(signature){
  const open=signature.indexOf("(");
  if(open>=0&&!/:\s*$/.test(signature.slice(0,open))){
    let depth=0;
    for(let i=open;i<signature.length;i++){
      if(signature[i]==="(")depth++;
      else if(signature[i]===")"&&--depth===0){
        const after=signature.slice(i+1).trim();
        return {name:signature.slice(0,open).trim(),callable:true,args:splitArguments(signature.slice(open+1,i)),returns:after.replace(/^:\s*/,"")};
      }
    }
  }
  const property=signature.match(/^(.*?)\s*:\s*(.+)$/);
  return property?{name:property[1].trim(),callable:false,args:[],returns:property[2].trim()}:{name:signature.trim(),callable:false,args:[],returns:""};
}
export function formatSignature(signature){
  const parsed=parseSignature(signature);
  if(!parsed.callable||parsed.args.length<2)return null;
  return {before:parsed.name+"(",args:parsed.args.join(", "),after:")"+(parsed.returns?": "+parsed.returns:"")};
}
export function normalizeType(type, references={}){
  return type.trim().replace(/\bList<([^<>]+)>/g,"{$1}").replace(/\b(?:float|int)\b/g,"number").replace(/\bFunction\b/g,"function").replace(/\b[A-Za-z_][A-Za-z_0-9]*\b/g,(name,offset,source)=>references[name]?.category==="Enum"&&source.slice(Math.max(0,offset-5),offset)!=="Enum."?"Enum."+name:name);
}
export function nameParts(name){return name.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[.:])(?=[A-Za-z_])/);}
