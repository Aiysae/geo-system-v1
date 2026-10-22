process.umask(0o077);
const path=require('node:path');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {Store,fail}=require('./store.cjs');
const {AccountBrowser}=require('./browser.cjs');
const {runSdk}=require('./sdk-runner.cjs');
const {DemoPlatform}=require('./demo.cjs');
const platforms=require('./vendor/content-platforms.json');
const {adapters:localAdapters,byId:localAdapterById}=require('./platform-adapters/index.cjs');
const {metadata:validateContentMetadata,typeOf}=require('./vendor/content-rules.cjs');
const urls=require('./vendor/login-urls.json');
const directory=process.env.LOCAL_PUBLISHER_DATA_DIR||path.join(process.cwd(),'.data/local-publishing');
const store=new Store(directory),demo=new DemoPlatform(directory),browser=new AccountBrowser(store),workerId=randomUUID();
store.getAsset=(owner,id)=>store.asset(owner,id);
let ticking=false,closing=false;
const active=new Map();
const capabilities=[
  {id:'DEMO_CSDN',name:'本地演示平台',login:true,demo:true,contentTypes:['article','video','imageText','audio','wechat','dynamic'],draftTypes:['article','video','imageText','audio','wechat','dynamic'],readiness:'本机模拟验证专用'},
  ...localAdapters.map(p=>({id:p.id,name:p.name,login:!!p.loginUrls,custom:true,contentTypes:p.contentTypes,draftTypes:p.draftTypes,readiness:p.draftTypes.length?'独立草稿适配已接入 · 待登录和回读验证':'登录入口已接入 · 草稿能力待验证'})),
  ...platforms.map(p=>({...p,login:!!urls[p.id],readiness:'客户端存在适配代码 · 待真实平台验证'})),
];

function resolveTaskAssets(task){
  const meta=task.snapshot.metadata||{};
  const assetIds=[...(meta.assetIds||[]),meta.coverAssetId,...(meta.entries||[]).map(e=>e.coverAssetId),
    ...[task.snapshot.html,...(meta.entries||[]).map(e=>e.html)].flatMap(html=>[...String(html||'').matchAll(/local-asset:([a-zA-Z0-9_-]+)/g)].map(m=>m[1]))].filter(Boolean);
  return Object.fromEntries([...new Set(assetIds)].map(id=>[id,store.asset(task.owner,id)]));
}

function rememberSession(task,account,result,verified=false){
  if(!result.session&&!verified)return;
  const session=result.session||account.session;
  if(!store.refreshSession(task.owner,account.id,session,account.session_version,verified))throw Error('STALE_SESSION');
  account.session=session;account.session_version++;
}
function accountFault(task,account,result){
  const submitting=task.phase==='submitting',audit=task.state==='auditing';
  if(['AUTH','CHALLENGE'].includes(result.code)){
    store.invalidate(task.owner,account.id,result.message,result.code);
    store.finish(task,submitting?'needs_review':audit?'audit_pending':'waiting_login',submitting?'提交结果待核对；账号已暂停，避免重复发送':result.message);
    return true;
  }
  if(['RATE_LIMIT','NETWORK','TIMEOUT'].includes(result.code)){
    const until=Math.max(Number(result.retryAt)||0,Date.now()+retryDelay(task.attempts||task.audit_attempts,account.platform==='DEMO_CSDN'));
    store.deferAccount(task.owner,account.id,result.code,result.message||'连接暂时异常，等待重试',until);
    store.finish(task,submitting?'needs_review':audit?(task.audit_attempts>=10?'audit_pending':'submitted'):(task.attempts>=4?'failed':'retry_wait'),
      submitting?'提交结果待核对；不会自动重复提交':task.attempts>=4?'连续检查失败，请核对平台状态':result.message||'稍后自动重试',{next_run:until});
    return true;
  }
  return false;
}

async function executeLocalDraft(task,account,adapter){
  if(task.mode!=='draft'){store.finish(task,'blocked','该平台正式发布尚未通过验收');return;}
  const profile=await adapter.verifySession({session:account.session});
  rememberSession(task,account,profile,profile.ok&&account.remote_id===profile.identity?.id);
  if(!profile.ok){
    if(accountFault(task,account,profile))return;
    store.finish(task,'blocked',profile.message||'平台账号身份尚未核实');
    return;
  }
  if(account.remote_id!==profile.identity?.id){store.invalidate(task.owner,account.id,'账号身份发生变化');store.finish(task,'waiting_login','账号身份与绑定记录不一致，请重新登录原账号');return;}
  if(!store.beginSubmission(task))return;
  task.phase='submitting';
  const result=await adapter.saveDraft({session:account.session,article:task.snapshot,resolvedAssets:resolveTaskAssets(task)});
  rememberSession(task,account,result);
  if(!result.ok&&accountFault(task,account,result))return;
  if(result.ok&&result.remoteId)store.finish(task,'draft','平台草稿已保存并回读确认',{remote_id:String(result.remoteId)});

  else if(result.code==='NEEDS_REVIEW'||result.ok)store.finish(task,'needs_review',result.message||'平台未返回可回读的草稿编号，请核对草稿箱');
  else store.finish(task,'blocked',result.message||'平台草稿试存尚未完成');
}

async function execute(task){
  const heartbeat=setInterval(()=>store.updateClaim(task,{lease_until:Date.now()+90000}),20000);
  try{
    const account=store.account(task.owner,task.account_id,true);
    if(!account.session){store.finish(task,'waiting_login','请先登录该账号；完成后自动继续');return;}
    const localAdapter=localAdapterById[account.platform];
    if(localAdapter){await executeLocalDraft(task,account,localAdapter);return;}
    const platform=account.platform==='DEMO_CSDN'?'CSDN':account.platform;
    const options={directory,fixtureUrl:account.platform==='DEMO_CSDN'?demo.url:undefined,onEvent:e=>{
      if(e.type==='dependency')store.event(task.owner,task.id,'dependency',e.message);
      if(e.type==='progress'&&e.stage)store.updateClaim(task,{message:e.message});
    }};
    if(task.state==='auditing'){
      const result=await runSdk({operation:'audit',platform,session:account.session,accountId:account.id,taskId:task.id,remoteId:task.remote_id,contentType:typeOf(task.snapshot)},{...options,timeoutMs:45000});
      rememberSession(task,account,result,result.ok);
      if(!result.ok&&accountFault(task,account,result))return;
      if(result.ok&&[0,3,4].includes(result.auditStatus)){store.finish(task,result.auditStatus===4?'draft':'published',result.auditStatus===4?'平台已确认草稿':'平台已确认发布或审核通过');}
      else if(result.ok&&[2,14].includes(result.auditStatus))store.finish(task,'rejected','平台审核未通过，请修改内容后处理');
      else if(task.audit_attempts>=10||result.code==='DEPENDENCY')store.finish(task,'audit_pending',result.message||'已提交，审核状态待核对');
      else store.finish(task,'submitted','文章已提交，等待平台审核',{next_run:Date.now()+(account.platform==='DEMO_CSDN'?1000:60000)});
      return;
    }
    const profile=await runSdk({operation:'profile',platform,session:account.session},{...options,timeoutMs:30000});
    rememberSession(task,account,profile,profile.ok&&account.remote_id===profile.identity?.id);
    if(!profile.ok){
      if(accountFault(task,account,profile))return;
      if(profile.code==='DEPENDENCY')store.finish(task,'blocked',profile.message);
      else if(task.attempts<4)store.finish(task,'retry_wait','发布前检查暂时失败，稍后自动重试',{next_run:Date.now()+retryDelay(task.attempts,account.platform==='DEMO_CSDN')});
      else store.finish(task,'failed','发布前检查多次失败，请检查平台状态后重试');
      return;
    }
    if(account.remote_id!==profile.identity.id){store.invalidate(task.owner,account.id,'账号身份发生变化');store.finish(task,'waiting_login','账号身份与绑定记录不一致，请重新登录原账号');return;}
    if(!store.beginSubmission(task))return;
    task.phase='submitting';
    const resolvedAssets=resolveTaskAssets(task);
    if(account.platform==='DEMO_CSDN'&&typeOf(task.snapshot)!=='article'){
      const simulated=demo.saveMedia(account.remote_id,task,typeOf(task.snapshot),Object.keys(resolvedAssets));
      store.finish(task,'draft','本机模拟平台已保存多媒体草稿',{remote_id:String(simulated.id)});
      return;
    }
    const result=await runSdk({operation:'publish',platform,session:account.session,accountId:account.id,
      remoteId:account.remote_id,remoteName:account.remote_name,taskId:task.id,article:task.snapshot,mode:task.mode,resolvedAssets},options);
    rememberSession(task,account,result);
    if(!result.ok&&accountFault(task,account,result))return;
    if(result.ok){
      if(task.mode==='draft')store.finish(task,'draft','平台适配器返回草稿保存成功',{remote_id:result.remoteId||null});
      else if(result.remoteId)store.finish(task,'submitted','提交成功，等待平台审核',{remote_id:result.remoteId,next_run:Date.now()+5000});
      else store.finish(task,'needs_review','平台未返回文章编号，请先核对提交结果');
    }else if(result.code==='DEPENDENCY')store.finish(task,'blocked',result.message);
    else store.finish(task,'needs_review',`${result.message||'平台未明确返回成功'}；核对后再重试`);
  }catch{store.finish(task,task.state==='auditing'?'audit_pending':task.phase==='submitting'?'needs_review':task.attempts>=4?'failed':'retry_wait','执行发生中断，将按记录恢复或等待核对',{next_run:Date.now()+30000});}
  finally{clearInterval(heartbeat);active.delete(task.id);}
}
function retryDelay(attempt,isDemo){return (isDemo?2000:15000)*2**Math.min(attempt,5);}
async function tick(){
  if(ticking||closing)return;ticking=true;
  try{
    store.recover();await browser.tick();
    const available=5-active.size;
    for(let i=0;i<available;i++){
      const held=[...browser.handles.keys(),...browser.opening.keys()];
      const t=store.claim(`${workerId}:${randomUUID()}`,held);if(!t)break;
      active.set(t.id,t);void execute(t);
    }
  }catch{process.send?.({type:'health',message:'调度器暂时异常，正在重试'});}
  finally{ticking=false;}
}
async function command(owner,action,input){
  if(typeof owner!=='string'||!owner||owner.length>150)fail('登录身份无效','AUTH');
  switch(action){
    case 'state':{
      const snap=store.snapshot(owner);
      return {...snap,platforms:capabilities.map(p=>{const accounts=snap.accounts.filter(a=>a.platform===p.id);const tasks=snap.tasks.filter(t=>t.platform===p.id);return {...p,readiness:p.demo?'演示测试专用':tasks.some(t=>t.state==='blocked')?(p.custom?'草稿试存待核对':'存在远端依赖 · 待适配'):tasks.some(t=>t.state==='published')?'发布已验证':tasks.some(t=>t.state==='draft')?'草稿已验证 · 正式发布待验证':accounts.some(a=>a.state==='ready')?(p.custom?'登录已验证 · 草稿待验证':'登录已验证 · 发布待验证'):p.readiness}}),loginWindows:[...browser.handles.entries()].filter(([,h])=>h.owner===owner).map(([id,h])=>({id,message:h.message})),runtime:{running:true,independent:!!process.env.LOCAL_PUBLISHER_SOCKET,localDatabase:true,vendorBackend:false,fixture:true,active:active.size}};
    }
    case 'account.add':if(!capabilities.some(p=>p.id===input.platform&&p.login))fail('该平台登录入口尚未接入');return store.addAccount(owner,input.platform,input.label);
    case 'account.group':return store.setAccountGroup(owner,input.id,input.groupName);
    case 'account.remove':await browser.close(owner,input.id);store.removeAccount(owner,input.id);return {ok:true};
    case 'account.logout':await browser.close(owner,input.id);store.logout(owner,input.id);return {ok:true};
    case 'login.open':return browser.open(owner,input.id);
    case 'login.close':await browser.close(owner,input.id);void tick();return {ok:true};
    case 'login.verify':await browser.verify(owner,input.id);return {ok:true};
    case 'login.interact':return browser.interact(owner,input.id,input);
    case 'login.snapshot':return browser.snapshot(owner,input.id);
    case 'demo.fault':{const a=store.account(owner,input.id);if(a.platform!=='DEMO_CSDN'||!a.remote_id)fail('请选择已登录的演示账号');demo.fault(a.remote_id,input.kind);return {ok:true};}
    case 'demo.posts':{const a=store.account(owner,input.id);if(a.platform!=='DEMO_CSDN')fail('仅限演示账号');return demo.stats(a.remote_id);}
    case 'article.save':return store.saveArticle(owner,{...input,metadata:validateContentMetadata(input.metadata)});
    case 'article.get':return store.article(owner,input.id);
    case 'article.import':return store.importArticle(owner,input);
    case 'article.import.lookup':return store.importedArticle(owner,input);
    case 'asset.register':return store.registerAsset(owner,input);
    case 'asset.path':return store.asset(owner,input.id);
    case 'batch.preflight':return store.preflightBatch(owner,input);
    case 'batch.draft.save':return store.saveBatchDraft(owner,input);
    case 'batch.draft.delete':return store.deleteBatchDraft(owner,input.id);
    case 'batch.create':{const b=store.createBatch(owner,input);void tick();return b;}
    case 'queue.pause':store.pause(owner,input.paused===true);void tick();return {ok:true};
    case 'task.action':{
      const task=store.task(owner,input.id),account=store.account(owner,task.account_id);
      if(localAdapterById[account.platform]&&input.action==='reconcile')fail('该平台尚未接入按编号自动核验，请在平台草稿箱核对后再试');
      store.taskAction(owner,input.id,input.action,input);void tick();return {ok:true};
    }
    default:fail('操作不存在','NOT_FOUND');
  }
}
process.on('message',async m=>{
  if(!m||m.type!=='request')return;
  try{const data=await command(m.owner,m.action,m.input||{});process.send?.({type:'response',id:m.id,ok:true,data});}
  catch(e){process.send?.({type:'response',id:m.id,ok:false,error:e.code==='SQLITE_CONSTRAINT_UNIQUE'?'记录已存在':String(e.message||'操作失败').slice(0,250),code:e.code||'INVALID'});}
});
let timer,socketServer;
demo.start().then(async()=>{
  browser.fixtureUrl=demo.url;
  if(process.env.LOCAL_PUBLISHER_SOCKET)socketServer=await require('./socket-server.cjs').listen(process.env.LOCAL_PUBLISHER_SOCKET,command);
  timer=setInterval(()=>void tick(),1000);void tick();process.send?.({type:'ready'});
}).catch(()=>process.exit(1));
async function shutdown(){
  if(closing)return;closing=true;clearInterval(timer);socketServer?.close();
  const deadline=Date.now()+150000;
  while(active.size&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,250));
  await browser.shutdown();await demo.close();store.close();process.exit(0);
}
process.on('disconnect',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
