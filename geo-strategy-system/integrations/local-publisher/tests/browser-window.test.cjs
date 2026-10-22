const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os');
const {Store}=require('../store.cjs'),{AccountBrowser}=require('../browser.cjs');
function fixture(t){
 const dir=fs.mkdtempSync(os.tmpdir()+'/geo-login-window-'),store=new Store(dir),browser=new AccountBrowser(store);
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const account=store.addAccount('owner','DEMO_CSDN','窗口释放测试');
 store.saveSession('owner',account.id,{cookies:[],origins:[]},{id:'fixture'});
 const article=store.saveArticle('owner',{title:'窗口释放草稿',markdown:'正文',html:'<p>正文</p>'});
 store.createBatch('owner',{accountIds:[account.id],articleIds:[article.id],mode:'draft',requestKey:'window'});
 const handle={owner:'owner',version:store.account('owner',account.id).session_version,ready:false,reviewRequired:true,lastCheck:Date.now(),openedAt:Date.now(),lastSeenAt:Date.now(),page:{isClosed:()=>false,screenshot:async()=>Buffer.from('frame'),url:()=> 'https://csdn.net/'},context:{close:async()=>{handle.closed=true;}}};
 browser.captureState=async()=>({cookies:[],origins:[],marker:'latest'});browser.handles.set(account.id,handle);
 return {store,browser,account,handle};
}
test('verified window releases its account automatically and keeps final storage without another profile request',async t=>{
 const {store,browser,account,handle}=fixture(t);handle.ready=true;
 browser.verify=async()=>assert.fail('closing must not repeat the network login check');
 assert.equal(store.claim('before',[...browser.handles.keys()]),null);
 await browser.tick();await handle.closing;
 assert.equal(browser.handles.size,0);assert.ok(handle.closed);
 assert.equal(store.account('owner',account.id,true).session.marker,'latest');
 assert.ok(store.claim('after',[...browser.handles.keys()]));
});
test('disconnected login viewers expire after 90 seconds while an active viewer keeps its window',async t=>{
 const {browser,account,handle}=fixture(t);
 handle.lastSeenAt=Date.now()-91000;await browser.snapshot('owner',account.id);
 await browser.tick();assert.equal(browser.handles.size,1);
 handle.lastSeenAt=Date.now()-91000;await browser.tick();await handle.closing;
 assert.equal(browser.handles.size,0);assert.ok(handle.closed);
});
test('closed-window polling returns a normal completion and still enforces account ownership',async t=>{
 const {browser,account}=fixture(t);await browser.close('owner',account.id);
 const result=await browser.snapshot('owner',account.id);assert.equal(result.closed,true);assert.equal(result.ready,true);
 await assert.rejects(()=>browser.snapshot('another-owner',account.id),/无权访问/);
});
test('capture or browser-close failure never strands the account lock or loses saved login',async t=>{
 const {store,browser,account,handle}=fixture(t);handle.ready=true;
 browser.captureState=async()=>{throw Error('browser disconnected');};
 handle.context.close=async()=>{throw Error('context already closed');};
 await assert.rejects(()=>browser.close('owner',account.id));
 assert.equal(browser.handles.size,0);assert.equal(store.account('owner',account.id).state,'ready');
 assert.ok(store.claim('recovered',[...browser.handles.keys()]));
});
test('a slow closing window does not block the scheduler and duplicate closes share one cleanup',async t=>{
 const {browser,account,handle}=fixture(t);handle.ready=true;let release,closed=0;
 handle.verification=new Promise(resolve=>{release=resolve;});handle.context.close=async()=>{closed++;};
 await browser.tick();assert.ok(handle.closing);assert.equal(browser.handles.size,1);
 const second=browser.close('owner',account.id);release();await second;await handle.closing;
 assert.equal(closed,1);assert.equal(browser.handles.size,0);
});
