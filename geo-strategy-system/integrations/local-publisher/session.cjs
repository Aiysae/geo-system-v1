const {CookieJar,Cookie}=require('tough-cookie');

// Preserve browser-only storage and enforce cookie domain/path/expiry rules.
function sessionJar(session){
  const jar=new CookieJar();
  for(const c of session?.cookies||[]){
    if(c.partitionKey)continue; // Partitioned cookies remain browser-owned.
    const host=c.domain?.replace(/^\./,'');if(!host)continue;
    const cookie=new Cookie({key:c.name,value:c.value,domain:host,hostOnly:!c.domain.startsWith('.'),path:c.path||'/',secure:!!c.secure,httpOnly:!!c.httpOnly,sameSite:c.sameSite?.toLowerCase(),expires:c.expires>0?new Date(c.expires*1000):'Infinity'});
    jar.setCookieSync(cookie,`${c.secure?'https':'http'}://${host}${c.path||'/'}`,{ignoreError:true});
  }
  return jar;
}
function jarSession(jar,original){
  const cookies=jar.serializeSync().cookies.map(c=>({...c,expiry:Cookie.fromJSON(c).expiryTime()})).filter(c=>c.expiry>Date.now()).map(c=>({
    name:c.key,value:c.value,domain:(c.hostOnly?'':'.')+c.domain,path:c.path||'/',secure:!!c.secure,httpOnly:!!c.httpOnly,
    expires:Number.isFinite(c.expiry)?c.expiry/1000:-1,
    sameSite:({strict:'Strict',lax:'Lax',none:'None'})[c.sameSite]||'Lax',
  }));
  return {...original,cookies:[...cookies,...(original.cookies||[]).filter(c=>c.partitionKey)]};
}
async function captureSession(context,previous={}){
  const state=await context.storageState({indexedDB:true});
  const origins=new Map((previous.origins||[]).map(o=>[o.origin,o]));
  for(const origin of state.origins)origins.set(origin.origin,origin);
  state.origins=[...origins.values()];state.sessionStorage={...previous.sessionStorage};
  for(const page of context.pages())try{
    const data=await page.evaluate(()=>({origin:location.origin,items:Object.fromEntries(Object.keys(sessionStorage).map(k=>[k,sessionStorage.getItem(k)]))}));
    if(data.origin!=='null')state.sessionStorage[data.origin]=data.items;
  }catch{}
  return state;
}
module.exports={sessionJar,jarSession,captureSession};
