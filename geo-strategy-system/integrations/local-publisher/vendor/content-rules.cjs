const platforms=require('./content-platforms.json');
const {byId:localAdapters}=require('../platform-adapters/index.cjs');
const contentTypes=['article','video','imageText','audio','wechat','dynamic'];
const typeOf=article=>article?.metadata?.contentType||'article';
const escapeHtml=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plainHtml=value=>String(value||'').split(/\n\s*\n/).map(p=>`<p>${escapeHtml(p).replace(/\n/g,'<br>')}</p>`).join('');
function invalid(message){const e=new Error(message);e.code='INVALID';throw e;}
function publicUrl(value,name='链接'){
 let u;try{u=new URL(value);}catch{invalid(`${name}格式错误`);}
 if(u.protocol!=='https:'||u.username||u.password||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(u.hostname))invalid(`${name}请使用公开 HTTPS 地址`);
 return u.href;
}
function metadata(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))invalid('内容设置格式错误');
 const contentType=input.contentType||'article';if(!contentTypes.includes(contentType))invalid('内容类型无效');
 const out={contentType,digest:String(input.digest||'').slice(0,300),tags:Array.isArray(input.tags)?input.tags.map(x=>String(x).slice(0,40)).slice(0,10):[],original:input.original===true};
 const assetId=value=>{if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value))invalid('素材编号无效');return value;};
 if(input.source!==undefined){
  const source=input.source;if(!source||typeof source!=='object'||Array.isArray(source)||!['file','production'].includes(source.kind))invalid('文章来源格式错误');
  if(typeof source.id!=='string'||!source.id.trim()||source.id.length>500||typeof source.version!=='string'||!source.version.trim()||source.version.length>128)invalid('文章来源编号或版本无效');
  out.source={kind:source.kind,id:source.id,version:source.version};
  for(const key of ['name','clientId','batchId','itemId','variant'])if(typeof source[key]==='string')out.source[key]=source[key].slice(0,key==='name'?200:240);
 }
 if(input.assetIds!==undefined){if(!Array.isArray(input.assetIds)||input.assetIds.length>50)invalid('每条内容最多 50 个素材');out.assetIds=[...new Set(input.assetIds.map(assetId))];}
 if(input.coverAssetId)out.coverAssetId=assetId(input.coverAssetId);
 if(input.coverUrl)out.coverUrl=publicUrl(input.coverUrl,'封面');
 if(input.entries!==undefined){
  if(!Array.isArray(input.entries)||input.entries.length>8)invalid('公众号内容包最多 8 篇');
  out.entries=input.entries.map(entry=>{if(!entry||typeof entry!=='object')invalid('公众号文章格式错误');
   const title=String(entry.title||'').trim(),markdown=String(entry.markdown||'');
   if(!title||title.length>200||!markdown.trim()||markdown.length>300000)invalid('公众号文章标题或正文为空或过长');
   const e={title,markdown,html:typeof entry.html==='string'?entry.html.slice(0,600000):plainHtml(markdown),digest:String(entry.digest||'').slice(0,300),author:String(entry.author||'').slice(0,80)};
   if(entry.coverAssetId)e.coverAssetId=assetId(entry.coverAssetId);if(entry.sourceUrl)e.sourceUrl=publicUrl(entry.sourceUrl,'原文');return e;});
 }
 if(input.platformOptions){
  if(typeof input.platformOptions!=='object'||Array.isArray(input.platformOptions))invalid('平台选项格式错误');
  const allowed=new Set(['categoryId','categoryName','category','columnId','contentSourceUrl','statement','allowComment','notifySubscribers','groupId','country','province','city','album','collection','topics','location','music','challenge','goods','isAiTrack','needOpenComment','needOpenReply','disableRecommend','rewardSettings','linkSetting','allow_save','sync_xigua','sex']);
  const forbidden=new Set(['__proto__','constructor','prototype','cookie','token','authorization','path','localPath','pathOrUrl','url','video','audio','images','covers','contentList','content','title','pubType','visibleType','prePubTime','platformAccount','platformLocalStorage']);
  const check=(value,depth=0)=>{if(depth>8)invalid('平台选项层级过深');if(Array.isArray(value)){value.forEach(v=>check(v,depth+1));return;}if(value&&typeof value==='object'){for(const [key,v]of Object.entries(value)){if(forbidden.has(key))invalid('平台选项包含受保护字段');check(v,depth+1);}}};
  for(const [platform,options]of Object.entries(input.platformOptions)){
   if(!platforms.some(p=>p.id===platform)||!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!allowed.has(k)))invalid('平台选项包含不支持的字段');check(options);
   if(options.contentSourceUrl)publicUrl(options.contentSourceUrl,'原文');
  }
  if(JSON.stringify(input.platformOptions).length>20000)invalid('平台选项过长');out.platformOptions=JSON.parse(JSON.stringify(input.platformOptions));
 }
 return out;
}
function applyOverride(article,override){
 if(!override)return article;
 if(typeof override!=='object'||Array.isArray(override)||Object.keys(override).some(k=>!['title','markdown','html','metadata'].includes(k)))invalid('逐账号内容差异格式错误');
 const out={...article,metadata:{...article.metadata,...Object.fromEntries(Object.entries(override.metadata||{}).filter(([,value])=>value!==''))}};
 if(override.title!==undefined&&String(override.title).trim())out.title=String(override.title).trim();
 if(override.markdown!==undefined){out.markdown=String(override.markdown);out.html=typeof override.html==='string'?override.html:plainHtml(out.markdown);}
 out.metadata=metadata(out.metadata);
 if(!out.title||out.title.length>200||out.markdown.length>300000||out.html.length>600000)invalid('逐账号内容标题或正文无效');
 return out;
}
function platformCapability(platform){if(platform==='DEMO_CSDN')return {id:platform,name:'本地演示平台',contentTypes,draftTypes:contentTypes};return localAdapters[platform]?{...localAdapters[platform],draftOnly:true}:platforms.find(p=>p.id===platform);}
module.exports={platforms,contentTypes,typeOf,metadata,applyOverride,platformCapability,plainHtml};
