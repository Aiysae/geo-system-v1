const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os');
const {Store}=require('../store.cjs');
function setup(t){
 const dir=fs.mkdtempSync(os.tmpdir()+'/geo-stability-');let s=new Store(dir);
 t.after(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});
 const a=s.addAccount('owner','DEMO_CSDN','稳定性演示');
 const session={cookies:[],origins:[]};s.saveSession('owner',a.id,session,{id:'demo'});
 const article=s.saveArticle('owner',{title:'仅演示草稿',markdown:'正文',html:'<p>正文</p>'});
 return {get s(){return s;},a,session,add(extra={}){s.createBatch('owner',{accountIds:[a.id],articleIds:[article.id],mode:'draft',requestKey:Math.random().toString(),...extra});},restart(){s.close();s=new Store(dir);return s;}};
}
test('expired account pauses every batch; login resumes only unsubmitted jobs',t=>{
 const f=setup(t);f.add();f.add();const active=f.s.claim('first');
 f.s.invalidate('owner',f.a.id);f.s.finish(active,'waiting_login','登录失效');
 assert.ok(f.s.snapshot('owner').tasks.every(t=>t.state==='waiting_login'));
 assert.equal(f.s.claim('second'),null);
 f.s.saveSession('owner',f.a.id,f.session,{id:'demo'});assert.ok(f.s.claim('resumed'));
});
test('stale refresh cannot overwrite newer credentials or resurrect a logged-out account',t=>{
 const f=setup(t),old=f.s.account('owner',f.a.id,true);
 assert.equal(f.s.refreshSession('owner',f.a.id,{...f.session,marker:'new'},old.session_version,true),true);
 assert.equal(f.s.refreshSession('owner',f.a.id,{marker:'stale'},old.session_version,true),false);
 const current=f.s.account('owner',f.a.id,true);f.s.logout('owner',f.a.id);
 assert.equal(f.s.refreshSession('owner',f.a.id,current.session,current.session_version,true),false);
 assert.equal(f.s.account('owner',f.a.id,true).session,null);
});
test('rate cooldown and challenge gate the whole account across restart without touching other accounts',t=>{
 t.mock.timers.enable({apis:['Date']});
 const f=setup(t);f.add();f.add();f.s.deferAccount('owner',f.a.id,'RATE_LIMIT','请求过多',Date.now()+60000);
 assert.equal(f.restart().claim('after-restart'),null);
 assert.equal(f.s.account('owner',f.a.id).health_code,'RATE_LIMIT');
 t.mock.timers.tick(60001);assert.ok(f.s.claim('after-cooldown'));
 f.s.invalidate('owner',f.a.id,'请完成平台验证','CHALLENGE');
 assert.equal(f.s.account('owner',f.a.id).state,'needs_verification');
});
test('actual submissions share spacing and rolling daily budget across batches, retries and restart',t=>{
 const f=setup(t);f.add({intervalMinutes:5,dailyLimit:2});f.add({intervalMinutes:0,dailyLimit:0});
 const first=f.s.claim('one');assert.equal(f.s.beginSubmission(first),true);f.s.finish(first,'draft','ok');
 assert.equal(f.restart().claim('two'),null);
 f.s.db.prepare('UPDATE submissions SET started_at=started_at-301000').run();
 f.s.db.prepare('UPDATE tasks SET next_run=0').run();
 const second=f.s.claim('two');assert.ok(second);assert.equal(f.s.beginSubmission(second),true);f.s.finish(second,'draft','ok');
 f.add();f.s.db.prepare('UPDATE submissions SET started_at=started_at-301000').run();
 assert.equal(f.s.claim('three'),null);
 assert.ok(f.s.snapshot('owner').tasks.some(t=>t.next_run>Date.now()+80000000));
});
test('login window does not automatically poll through a platform challenge or Retry-After',async t=>{
 const f=setup(t),{AccountBrowser}=require('../browser.cjs'),browser=new AccountBrowser(f.s);
 const handle={reviewRequired:true,lastCheck:0};browser.handle=()=>handle;let checks=0;
 browser.verifyHandle=async()=>{checks++;};
 await browser.verify('owner',f.a.id,true);assert.equal(checks,0);
 await browser.verify('owner',f.a.id);assert.equal(checks,1);
 handle.retryAfter=Date.now()+60000;
 await browser.verify('owner',f.a.id,true);await browser.verify('owner',f.a.id);assert.equal(checks,1);
});
test('a newly opened window also pauses an existing account when the platform returns 403',async t=>{
 const f=setup(t),{AccountBrowser}=require('../browser.cjs'),{DemoPlatform}=require('../demo.cjs');
 const demo=await new DemoPlatform(f.s.directory).start();t.after(()=>demo.close());
 demo.db.prepare('INSERT INTO sessions VALUES(?,?)').run('browser-fixture','demo');demo.fault('demo','challenge');
 const session={cookies:[{name:'SESSION',value:'browser-fixture',domain:'.csdn.net',path:'/'}],origins:[]};
 const browser=new AccountBrowser(f.s,demo.url),handle={owner:'owner',page:{isClosed:()=>false},context:{},version:f.s.account('owner',f.a.id).session_version,lastCheck:0};
 browser.captureState=async()=>session;browser.handles.set(f.a.id,handle);
 await browser.verify('owner',f.a.id);
 assert.equal(f.s.account('owner',f.a.id).state,'needs_verification');assert.equal(handle.reviewRequired,true);
});
