// One SDK operation per process. Vendor backend traffic is rejected; only the
// supplied account is held in memory. No SDK logging is retained.
const http=require('node:http'), https=require('node:https');
const { randomBytes }=require('node:crypto');
const path=require('node:path');
const {buildSdkTask,sdkFileFor}=require('./sdk-runner.cjs');
const {sessionJar,jarSession}=require('./session.cjs');
const {platformCapability,typeOf}=require('./vendor/content-rules.cjs');
const originalHttp=http.request.bind(http),originalHttps=https.request.bind(https);
let input,callbackPort=0,blocked=false,rateLimited=false,networkError=false,authError=false,challenge=false,uncertainWrite=false,jar,retryAt=0,finished=false;
const send=value=>process.connected&&process.send(value);
for(const method of ['log','info','warn','error','debug','trace']) console[method]=()=>{};
const vendor=host=>/(^|\.)yixiaoer\.cn$/i.test(host);
const privateHost=host=>/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::|\[?f[cd])/i.test(host);
function request(protocol,...args){
  let options={},cb;
  if(typeof args[0]==='string'||args[0] instanceof URL){
    const u=new URL(args[0]);options={protocol:u.protocol,hostname:u.hostname,port:u.port,path:u.pathname+u.search};
    if(typeof args[1]==='object')Object.assign(options,args[1]);cb=args.find(x=>typeof x==='function');
  }else{options={...args[0]};cb=args.find(x=>typeof x==='function');}
  const host=String(options.hostname||options.host||'').replace(/^\[|\]$/g,'');
  const requestUrl=`${protocol}//${host}${options.path||'/'}`;
  const callback=host==='127.0.0.1'&&Number(options.port)===callbackPort&&callbackPort>0;
  const mutating=!['GET','HEAD','OPTIONS'].includes(String(options.method||'GET').toUpperCase())&&!callback;
  if(uncertainWrite&&mutating)throw new Error('SUBMISSION_RESULT_UNKNOWN');
  if(vendor(host)){blocked=true;send({type:'dependency',message:'该步骤依赖蚁小二专用服务，需另行适配'});throw new Error('VENDOR_DEPENDENCY');}
  if(privateHost(host)&&!callback)throw new Error('PRIVATE_ENDPOINT_BLOCKED');
  if(!callback&&jar){
    const headers={...options.headers};
    for(const key of Object.keys(headers))if(key.toLowerCase()==='cookie')delete headers[key];
    const cookie=jar.getCookieStringSync(requestUrl);if(cookie)headers.cookie=cookie;options.headers=headers;
  }
  if(process.env.LOCAL_PUBLISHER_FIXTURE_URL&&!callback){
    // Fixed test environment only: exercise the actual SDK against a local
    // platform fixture. Requests from production data cannot enable this path.
    if(!/(^|\.)csdn\.net$/.test(host))throw new Error('FIXTURE_UNEXPECTED_HOST');
    const target=new URL(process.env.LOCAL_PUBLISHER_FIXTURE_URL);
    if(target.hostname!=='127.0.0.1')throw new Error('FIXTURE_LOOPBACK_ONLY');
    options={...options,protocol:'http:',hostname:target.hostname,host:undefined,port:target.port,agent:undefined,
      headers:{...options.headers,'x-fixture-host':host,'x-shitu-task-id':input.taskId||'', 'x-shitu-operation':input.operation}};
    protocol='http:';
  }
  const req=(protocol==='https:'?originalHttps:originalHttp)(options,cb);
  req.on('response',res=>{if(!callback)observe(res.statusCode,res.headers['set-cookie']||[],res.headers['retry-after'],requestUrl,mutating);});
  req.on('error',()=>{networkError=true;if(input.operation==='publish'&&mutating)uncertainWrite=true;});return req;
}
http.request=(...a)=>request('http:',...a);https.request=(...a)=>request('https:',...a);
http.get=(...a)=>{const r=http.request(...a);r.end();return r;};https.get=(...a)=>{const r=https.request(...a);r.end();return r;};
const nativeFetch=global.fetch;
global.fetch=async(resource,init)=>{
  const u=new URL(typeof resource==='string'?resource:resource.url||resource);
  if(vendor(u.hostname)){blocked=true;throw new Error('VENDOR_DEPENDENCY');}
  if(privateHost(u.hostname))throw new Error('PRIVATE_ENDPOINT_BLOCKED');
  if(process.env.LOCAL_PUBLISHER_FIXTURE_URL)throw new Error('FIXTURE_UNEXPECTED_FETCH');
  const mutating=!['GET','HEAD','OPTIONS'].includes(String(init?.method||resource?.method||'GET').toUpperCase());
  if(uncertainWrite&&mutating)throw new Error('SUBMISSION_RESULT_UNKNOWN');
  try{const response=await nativeFetch(resource,init);observe(response.status,response.headers.getSetCookie(),response.headers.get('retry-after'),response.url||u.href,mutating);return response;}
  catch(error){networkError=true;if(input.operation==='publish'&&mutating)uncertainWrite=true;throw error;}
};
function observe(status,cookies,retryAfter,url,mutating){
  for(const cookie of cookies)jar?.setCookieSync(cookie,url,{ignoreError:true});
  if(status===429){rateLimited=true;const seconds=Number(retryAfter);const retry=retryAfter&&Number.isFinite(seconds)?Date.now()+seconds*1000:Date.parse(retryAfter);if(Number.isFinite(retry))retryAt=Math.max(retryAt,retry);}
  if(status===401)authError=true;
  if(status===403)challenge=true;
  if(input.operation==='publish'&&mutating&&status>=500)uncertainWrite=true;
}
// Article operations do not need OS command execution.
for(const k of ['exec','execFile','spawn','fork','execSync','execFileSync','spawnSync'])require('node:child_process')[k]=()=>{throw new Error('SDK_COMMAND_DISABLED');};
function classified(message){
  if(blocked)return {code:'DEPENDENCY',message:'该平台步骤仍依赖蚁小二专用服务，已停止并等待适配'};
  if(rateLimited)return {code:'RATE_LIMIT',message:'平台请求频率受限，账号队列等待后自动再试',retryAt};
  if(challenge||/验证码|安全验证|访问受限|captcha|challenge/i.test(String(message)))return {code:'CHALLENGE',message:'平台要求验证或拒绝访问，账号队列已暂停，请打开账号窗口核对'};
  if(authError||/未登录|登录.{0,8}(失效|过期)|请.{0,4}(登录|登陆)|not.?logged.?in|unauthorized|(?:session|cookie|token).{0,12}expired/i.test(String(message)))return {code:'AUTH',message:'平台登录已失效，请重新登录'};
  if(uncertainWrite||networkError||/timeout|网络|socket/i.test(String(message)))return {code:'NETWORK',message:'平台连接中断，需核对提交结果'};
  return {code:'PLATFORM',message:String(message||'平台未返回明确结果').replace(/(?:cookie|token|authorization)\s*[:=]\s*\S+/gi,'[凭据已省略]').slice(0,220)};
}
function done(result){if(finished)return;finished=true;send({type:'result',...result,...(jar?{session:jarSession(jar,input.session)}:{})});setTimeout(()=>process.exit(0),20);}
process.once('message',async message=>{
  input=message;jar=sessionJar(input.session);
  try{
    const nonce=randomBytes(24).toString('hex');
    const server=http.createServer((req,res)=>{
      if(req.headers.authorization!==nonce){res.writeHead(403);res.end();return;}
      let body='';req.on('data',c=>{body+=c;if(body.length>1024*1024)req.destroy();});
      req.on('end',()=>{try{const e=JSON.parse(body);send({type:'audit-feedback',auditStatus:e.auditStatus,stages:e.stages,stageStatus:e.stageStatus});res.setHeader('Content-Type','application/json');res.end('{"statusCode":0}');}catch{res.writeHead(400);res.end();}});
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));callbackPort=server.address().port;
    const contentType=input.article?typeOf(input.article):input.contentType||'article';
    if(input.operation==='publish'){
      const capability=platformCapability(input.platform);
      if(!capability?.contentTypes.includes(contentType)){done({ok:false,code:'CONTENT_UNSUPPORTED',message:'平台未接入该内容类型'});return;}
      if(input.mode==='draft'&&!capability?.draftTypes.includes(contentType)){done({ok:false,code:'DRAFT_UNVERIFIED',message:'该内容类型的原生草稿尚未验证，已阻止提交'});return;}
    }
    const sdk=require('./vendor/'+sdkFileFor(input));
    for(const method of ['log','info','warn','error','debug','trace'])if(typeof sdk.logger[method]==='function')sdk.logger[method]=()=>{};
    sdk.PubConfig.API_URL=`http://127.0.0.1:${callbackPort}`;sdk.PubConfig.API_Token=nonce;
    sdk.PubConfig.userYixiaoerDataDir=input.workDir;sdk.PubConfig.userYixiaoerVideoTmpDir=input.workDir;
    sdk.PubConfig.httpTimeout=25000;
    const cookie=JSON.stringify(input.session.cookies||[]);
    if(input.operation==='profile'){
      const r=await sdk.Cloud.getPlatformUserInfo(input.platform,cookie);
      if(blocked||authError||challenge||rateLimited||networkError){done({ok:false,...classified(r?.msg)});return;}
      if(r?.code!==0){done({ok:false,...classified(r?.msg)});return;}
      const d=r.data||{}, remoteId=r.yixiaoerId||d.authorId||d.user_id_str||d.uid||d.username||d.id;
      if(!remoteId){done({ok:false,code:'IDENTITY_UNVERIFIED',message:'平台未返回账号标识，需要核对适配器'});return;}
      done({ok:true,identity:{id:String(remoteId),name:String(r.yixiaoerName||r.name||r.userName||r.nickname||d.nickname||d.name||d.nickName||d.username||remoteId)}});return;
    }
    if(input.operation==='audit'){
      const r=await sdk.Cloud.checkAuditStatus(input.platform,{cookie,platformAccountId:input.accountId},input.taskId,input.remoteId,contentType==='wechat'?'article':contentType,nonce);
      if(blocked||authError||challenge||rateLimited||networkError){done({ok:false,...classified()});return;}
      // openUrl is the public article link the SDK reports once a platform shows the article as published.
      if(r&&typeof r.auditStatus==='number'){done({ok:true,auditStatus:r.auditStatus,openUrl:typeof r.openUrl==='string'?r.openUrl:undefined});return;}
      done({ok:false,code:'AUDIT_PENDING',message:'平台审核结果尚未明确'});return;
    }
    if(input.operation!=='publish')throw Error('UNSUPPORTED_OPERATION');
    const taskSet=buildSdkTask(input);
    const error=await sdk.Cloud.pushLocalPublishTask(taskSet,async event=>{
      if(event.event==='publishResult'){
        if(event.stageStatus==='success')done({ok:true,remoteId:event.publishId||null});
        else done({ok:false,...classified(event.errorMessage)});
      }else{
        send({type:'progress',stage:String(event.stages||''),status:String(event.stageStatus||''),
          message:event.event==='wxQrCode'?'平台要求扫码确认，请在账号窗口完成':'正在执行平台发布步骤'});
      }
    });
    if(error)done({ok:false,...classified(error)});
  }catch(e){done({ok:false,...classified(e.message)});}
});
process.on('disconnect',()=>process.exit(0));
