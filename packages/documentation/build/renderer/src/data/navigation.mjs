export const routeFor=id=>id==='index'?'':id.replace(/^\/+|\/+$/g,'');
export function buildOutline(headings){
  const root=[{slug:'_top',text:'Overview',children:[]}],stack=[];
  for(const h of headings){
    if(h.depth<2||h.depth>4)continue;
    const item={slug:h.slug,text:h.text,children:[]};
    while(stack.length&&stack.at(-1).depth>=h.depth)stack.pop();
    (stack.length?stack.at(-1).item.children:root).push(item);
    stack.push({depth:h.depth,item});
  }
  return root;
}
