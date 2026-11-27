// Apply the captured documentation typography at compile time, not via DOM mutation.
// The inline-code span retains code semantics and the link remains a real anchor.
const typography=['MuiTypography-root','MuiTypography-inherit'];
const paragraph=[...typography,'MuiTypography-paragraph','Typography-body1-Typography-root-root'];
const link=['MuiTypography-root','MuiLink-root','MuiTypography-inherit','Link-colorPrimary-Link-root'];
const inline=linked=>[...typography,'Typography-code-Typography-colorPrimary-Typography-root-InlineCode-root-'+(linked?'inlineCodeWithLink':'inlineCode'),'inline-code'];
function classes(node,added){
  node.properties ||= {};
  const existing=node.properties.className||[];
  node.properties.className=[...new Set([...(Array.isArray(existing)?existing:String(existing).split(/\s+/)),...added])];
}
export default function documentationTypography(){
  return tree=>{
    function visit(node){
      if(node.type==='element'){
        if(['pre','script','style','svg','math','code'].includes(node.tagName)&&node.tagName!=='code')return;
        if(node.tagName==='p')classes(node,paragraph);
        if(node.tagName==='a'&&node.children?.length===1&&node.children[0].type==='element'&&node.children[0].tagName==='code'){
          const original=node.children[0];
          const anchor={...node,properties:{...node.properties},children:original.children};
          classes(anchor,[...link,'MuiLink-underlineNone']);
          node.tagName='span';node.properties={};classes(node,inline(true));node.children=[anchor];return;
        }
        if(node.tagName==='code'){
          node.tagName='span';node.properties ||= {};node.properties.role='code';classes(node,inline(false));return;
        }
        if(node.tagName==='a')classes(node,[...link,'MuiLink-underlineHover']);
      }
      for(const child of node.children||[])visit(child);
    }
    visit(tree);
  };
}
