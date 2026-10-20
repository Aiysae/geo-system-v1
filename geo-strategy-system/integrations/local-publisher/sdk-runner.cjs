const { fork }=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');

function runSdk(input,options={}){
  const workDir=path.join(options.directory,'sdk-work');fs.mkdirSync(workDir,{recursive:true,mode:0o700});
  // Deliberately do not forward platform, AI, production database or proxy credentials.
  const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,
    NODE_ENV:process.env.NODE_ENV||'development',PUBLISH_RISK_RESUME_ENABLED:'false'};
  if(options.fixtureUrl)env.LOCAL_PUBLISHER_FIXTURE_URL=options.fixtureUrl;
  const child=fork(path.join(__dirname,'sdk-child.cjs'),[],{env,execArgv:[],cwd:workDir,stdio:['ignore','ignore','ignore','ipc']});
  return new Promise(resolve=>{
    let settled=false;
    const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);child.kill();resolve(result);};
    const timer=setTimeout(()=>finish({ok:false,code:'TIMEOUT',message:'平台响应超时，提交结果需核对'}),options.timeoutMs||120000);
    child.on('message',m=>{if(m.type==='result')finish(m);else options.onEvent?.(m);});
    child.on('error',()=>finish({ok:false,code:'PROCESS',message:'平台执行进程启动失败'}));
    child.on('exit',()=>finish({ok:false,code:'PROCESS',message:'平台执行进程中断'}));
    child.send({...input,workDir});
  });
}
module.exports={runSdk};

// Pure conversion kept outside the SDK child so contracts can be checked without
// loading vendor code or contacting a platform. Resolved assets come only from
// the owner-scoped media library in daemon, never from browser form fields.
function buildSdkTask(input){
  const a=input.article,m=a.metadata||{},type=m.contentType||'article';
  const cookie=JSON.stringify(input.session.cookies||[]);
  const localStorage=Object.assign({},...(input.session.origins||[]).map(o=>Object.fromEntries((o.localStorage||[]).map(x=>[x.name,x.value]))));
  const resolved=input.resolvedAssets||{};
  const asset=id=>{const file=resolved[id];if(!file?.pathOrUrl)throw Error('ASSET_NOT_RESOLVED');return {pathOrUrl:file.pathOrUrl,localPath:file.pathOrUrl,size:file.size||0,duration:file.duration||0,width:file.width||0,height:file.height||0,format:file.format||path.extname(file.name||file.pathOrUrl).slice(1),name:file.name||path.basename(file.pathOrUrl)};};
  const htmlWithAssets=html=>String(html||'').replace(/local-asset:([a-zA-Z0-9_-]+)/g,(_,id)=>{
    const file=resolved[id];if(!file?.pathOrUrl||file.kind!=='image')throw Error('IMAGE_ASSET_NOT_RESOLVED');
    return `data:${file.mime_type};base64,${fs.readFileSync(file.pathOrUrl).toString('base64')}`;
  });
  const cover=m.coverAssetId?asset(m.coverAssetId):m.coverUrl?{pathOrUrl:m.coverUrl,url:m.coverUrl}:null;
  const covers=cover?[cover]:[];
  const publishData={title:a.title,content:htmlWithAssets(a.html),desc:m.digest||a.markdown||'',tags:m.tags||[],covers,
    pubType:input.mode==='draft'?0:1,createType:m.original?1:0,visibleType:0,
    contentList:[{title:a.title,content:htmlWithAssets(a.html),desc:m.digest||'',covers,createType:m.original?1:0}],
    ...(m.platformOptions?.[input.platform]||{})};
  // Preserve the previously verified article structure, including empty digest.
  if(type==='article')publishData.desc=m.digest||'';
  if(type==='video')publishData.video=asset((m.assetIds||[])[0]);
  if(type==='audio'){publishData.audio=asset((m.assetIds||[])[0]);if(cover)publishData.cover=cover;}
  if(type==='imageText')publishData.images=(m.assetIds||[]).map(asset);
  if(type==='wechat')publishData.contentList=(m.entries||[]).map(entry=>({title:entry.title,content:htmlWithAssets(entry.html),desc:entry.digest||'',author:entry.author||'',contentSourceUrl:entry.sourceUrl||'',covers:entry.coverAssetId?[asset(entry.coverAssetId)]:covers,createType:m.original?1:0}));
  const publishType=type==='wechat'?'article':type;
  return {publishType,platform:[{id:input.accountId,platformCookie:cookie,platformCode:input.platform,
    platformUserId:input.remoteId,platformUserName:input.remoteName,platformLocalStorage:JSON.stringify(localStorage)}],
    tasks:[{taskId:input.taskId,authorInfo:{id:input.accountId},publishData}],callBackData:'shitu-local'};
}
function sdkFileFor(input){
  const type=input.article?.metadata?.contentType||input.contentType||'article';
  return type!=='article'||!require('./vendor/article-platforms.json').some(p=>p.id===input.platform)?'multimedia-platform-service.cjs':'platform-service.cjs';
}
module.exports.buildSdkTask=buildSdkTask;
module.exports.sdkFileFor=sdkFileFor;
