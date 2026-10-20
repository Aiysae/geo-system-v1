const fs=require('node:fs');
const path=require('node:path');
const localBrowsers=path.join(process.cwd(),'.data/local-publishing-browsers');
if(!process.env.PLAYWRIGHT_BROWSERS_PATH&&fs.existsSync(localBrowsers))process.env.PLAYWRIGHT_BROWSERS_PATH=localBrowsers;
const {chromium}=require('playwright');
const {adapters:localAdapters,byId:localAdapterById}=require('./platform-adapters/index.cjs');
const urls={...require('./vendor/login-urls.json'),...Object.fromEntries(localAdapters.map(adapter=>[adapter.id,adapter.loginUrls]))};
const detectors=require('./vendor/login-detectors.cjs');
const {runSdk}=require('./sdk-runner.cjs');
const {fail}=require('./store.cjs');

class AccountBrowser {
  constructor(store,fixtureUrl){this.store=store;this.fixtureUrl=fixtureUrl;this.handles=new Map();this.opening=new Map();this.browser=null;this.starting=null;}
  async getBrowser(){
    if(this.browser?.isConnected())return this.browser;
    if(this.starting)return this.starting;
    const configured=process.env.LOCAL_PUBLISHER_BROWSER;
    const candidates=[configured,chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].filter(Boolean);
    const executablePath=candidates.find(p=>fs.existsSync(p));
    if(!executablePath)fail('本机缺少可用浏览器，请安装 Chrome 后再打开账号登录','BROWSER');
    this.starting=chromium.launch({headless:true,executablePath}).then(b=>{this.browser=b;b.on('disconnected',()=>{this.handles.clear();this.browser=null;});return b;}).finally(()=>{this.starting=null;});
    return this.starting;
  }
  async open(owner,accountId){
    this.store.account(owner,accountId);
    if(this.opening.has(accountId))return this.opening.get(accountId);
    if(!this.handles.has(accountId)&&new Set([...this.handles.keys(),...this.opening.keys()]).size>=5)fail('最多同时打开 5 个账号窗口');
    const promise=this.openOne(owner,accountId).finally(()=>this.opening.delete(accountId));
    this.opening.set(accountId,promise);return promise;
  }
  async openOne(owner,accountId){
    const account=this.store.account(owner,accountId,true);
    if(this.store.isAccountBusy(accountId))fail('该账号正在发布，请等待本次任务结束');
    const existing=this.handles.get(accountId);
    if(existing){if(existing.owner!==owner)fail('无权访问','NOT_FOUND');if(account.state!=='ready'&&existing.ready){existing.ready=false;await existing.page.reload({waitUntil:'domcontentloaded'});}return {id:accountId};}
    if(this.handles.size>=5)fail('最多同时打开 5 个账号窗口，请先关闭已完成的窗口');
    const effectivePlatform=account.platform==='DEMO_CSDN'?'CSDN':account.platform;
    const config=urls[effectivePlatform];if(!config)fail('该平台暂无登录地址');
    const browser=await this.getBrowser();
    const state=account.session;
    const context=await browser.newContext({viewport:{width:1200,height:800},storageState:state?{cookies:state.cookies,origins:state.origins}:undefined,serviceWorkers:'block',acceptDownloads:false});
    if(state?.sessionStorage)await context.addInitScript(data=>{const values=data[location.origin];if(values)for(const [k,v]of Object.entries(values))sessionStorage.setItem(k,v);},state.sessionStorage);
    await context.route('**/*',async route=>{
      const req=route.request(),u=new URL(req.url());
      if(/(^|\.)yixiaoer\.cn$/i.test(u.hostname)){await route.abort();return;}
      if(/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::|\[?f[cd])/i.test(u.hostname)){await route.abort();return;}
      if(account.platform==='DEMO_CSDN'){
        if(!/(^|\.)csdn\.net$/.test(u.hostname)){await route.abort();return;}
        try{
          const target=new URL(this.fixtureUrl);if(target.hostname!=='127.0.0.1')throw Error('fixture');
          const response=await fetch(target.origin+u.pathname+u.search,{method:req.method(),headers:{'content-type':req.headers()['content-type']||'application/json',cookie:req.headers().cookie||''},body:['GET','HEAD'].includes(req.method())?undefined:req.postDataBuffer()});
          await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
        }catch{await route.abort();}return;
      }
      await route.continue();
    });
    const handle={owner,context,page:null,checking:false,lastCheck:0,openedAt:Date.now(),message:'请在下方平台页面完成登录'};
    this.handles.set(accountId,handle);
    const setup=page=>{
      handle.page=page;
      page.on('response',async response=>{
        const detector=detectors[effectivePlatform]?.(null,()=>{});
        if(!detector||!response.url().includes(detector.urlPatterns))return;
        try{const raw=await response.json();if(detector.processor(raw?.data||raw))void this.verify(owner,accountId);}catch{}
      });
      page.on('popup',p=>{handle.page=p;});
      page.on('dialog',dialog=>dialog.dismiss());
    };
    context.on('page',setup);
    try{const page=await context.newPage();await page.goto(state?config.entryUrl:config.authorizeUrl,{waitUntil:'domcontentloaded',timeout:30000});}
    catch{handle.message='页面加载未完成，可以刷新后重试';}
    return {id:accountId};
  }
  handle(owner,accountId){
    this.store.account(owner,accountId);
    const h=this.handles.get(accountId);if(!h||h.owner!==owner||!h.page||h.page.isClosed())fail('登录窗口已关闭，请重新打开','NOT_FOUND');return h;
  }
  async captureState(h){
    const state=await h.context.storageState({indexedDB:true});state.sessionStorage={};
    for(const page of h.context.pages())try{const data=await page.evaluate(()=>({origin:location.origin,items:Object.fromEntries(Object.keys(sessionStorage).map(k=>[k,sessionStorage.getItem(k)]))}));state.sessionStorage[data.origin]=data.items;}catch{}
    return state;
  }
  async verify(owner,accountId){
    let h;try{h=this.handle(owner,accountId);}catch{return;}
    if(h.checking)return;h.checking=true;h.lastCheck=Date.now();
    try{
      const session=await this.captureState(h);
      const a=this.store.account(owner,accountId);
      const adapter=localAdapterById[a.platform];
      if(!session.cookies.length&&!adapter)return;
      const result=adapter
        ?await adapter.verifySession({session})
        :await runSdk({operation:'profile',platform:a.platform==='DEMO_CSDN'?'CSDN':a.platform,session},{directory:this.store.directory,fixtureUrl:a.platform==='DEMO_CSDN'?this.fixtureUrl:undefined,timeoutMs:30000});
      if(result.ok){this.store.saveSession(owner,accountId,session,result.identity);h.ready=true;h.message='登录成功，状态已保存；等待中的任务将自动继续';}
      else h.message=result.message;
    }catch(e){h.message=e.message||'登录状态检查失败';}
    finally{h.checking=false;}
  }
  async snapshot(owner,accountId){
    const h=this.handle(owner,accountId);
    const screen=await h.page.screenshot({type:'jpeg',quality:70,timeout:10000});
    const u=new URL(h.page.url());
    return {image:screen.toString('base64'),width:1200,height:800,url:u.origin+u.pathname,message:h.message,checking:h.checking,ready:!!h.ready};
  }
  async interact(owner,accountId,input){
    const h=this.handle(owner,accountId);
    if(input.kind==='click'){
      if(!Number.isFinite(input.x)||!Number.isFinite(input.y)||input.x<0||input.x>1200||input.y<0||input.y>800)fail('点击位置无效');
      await h.page.mouse.click(input.x,input.y);
    }else if(input.kind==='text'){
      if(typeof input.text!=='string'||input.text.length>2000)fail('输入内容过长');
      await h.page.keyboard.insertText(input.text);
    }else if(input.kind==='key'){
      if(!['Enter','Tab','Backspace','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ControlOrMeta+A'].includes(input.key))fail('按键无效');
      await h.page.keyboard.press(input.key);
    }else if(input.kind==='scroll')await h.page.mouse.wheel(0,input.direction==='up'?-500:500);
    else if(input.kind==='reload')await h.page.reload({waitUntil:'domcontentloaded',timeout:30000});
    else fail('登录操作无效');
    return {ok:true};
  }
  async close(owner,accountId){
    this.store.account(owner,accountId);const h=this.handles.get(accountId);if(!h)return;
    this.handles.delete(accountId);await h.context.close();
  }
  async tick(){
    for(const [id,h]of this.handles){
      if(Date.now()-h.openedAt>30*60000){await this.close(h.owner,id);continue;}
      if(!h.ready&&Date.now()-h.lastCheck>10000&&!h.checking)void this.verify(h.owner,id);
    }
  }
  async shutdown(){await this.browser?.close();this.handles.clear();}
}
module.exports={AccountBrowser};
