const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os');
const {Store}=require('../store.cjs');
const sharp=require('sharp'),path=require('node:path');
function fixture(t){const dir=fs.mkdtempSync(os.tmpdir()+'/geo-store-');const s=new Store(dir);t.after(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true})});return s;}
function seed(s,owner='one',label='账号'){const a=s.addAccount(owner,'CSDN',label);s.saveSession(owner,a.id,{cookies:[{name:'SESSION',value:'sensitive-session-value'}]},{id:a.id,name:label});const b=s.saveArticle(owner,{title:'文章',markdown:'正文',html:'<p>正文</p>'});return {a,b};}
function batch(s,a,b,extra={}){return s.createBatch('one',{accountIds:[a.id],articleIds:[b.id],mode:'publish',requestKey:Math.random().toString(),...extra});}
test('tenant isolation, encrypted sessions, and duplicate identity',t=>{const s=fixture(t),{a,b}=seed(s);assert.throws(()=>s.account('other',a.id));assert.throws(()=>s.article('other',b.id));assert.equal(s.snapshot('other').accounts.length,0);assert.equal(JSON.stringify(s.snapshot('one')).includes('sensitive-session'),false);assert.equal(s.db.prepare('SELECT session FROM accounts').get().session.includes('sensitive-session'),false);assert.equal(s.account('one',a.id,true).session.cookies[0].value,'sensitive-session-value');const a2=s.addAccount('one','CSDN','另一个');assert.throws(()=>s.saveSession('one',a2.id,{cookies:[]},{id:a.id}));assert.throws(()=>s.saveSession('one',a.id,{cookies:[]},{id:'different'}));});
test('atomic batch, idempotency, immutable article snapshots',t=>{const s=fixture(t),{a,b}=seed(s);const x=batch(s,a,b,{requestKey:'repeat'});assert.equal(batch(s,a,b,{requestKey:'repeat'}).id,x.id);assert.equal(s.snapshot('one').tasks.length,1);assert.throws(()=>batch(s,a,b,{requestKey:'repeat',mode:'draft'}));assert.throws(()=>batch(s,a,b,{accountIds:[a.id,'missing']}));assert.equal(s.snapshot('one').tasks.length,1);s.saveArticle('one',{id:b.id,title:'修改后',markdown:'新正文',html:'<p>新正文</p>'});assert.equal(s.claim('w').snapshot.title,'文章');});
test('future schedule survives login; pause and same-account serial dispatch',t=>{const s=fixture(t),{a,b}=seed(s);s.logout('one',a.id);batch(s,a,b,{scheduledAt:Date.now()+60000});s.saveSession('one',a.id,{cookies:[]},{id:a.id});assert.equal(s.claim('w'),null);batch(s,a,b);s.pause('one',true);assert.equal(s.claim('w'),null);s.pause('one',false);const job=s.claim('w');assert.ok(job);batch(s,a,b);assert.equal(s.claim('x'),null);s.finish(job,'published','done');assert.ok(s.claim('next'));});
test('global concurrency and lease recovery fence stale writers',t=>{const s=fixture(t);for(let i=0;i<6;i++){const {a,b}=seed(s,'one','a'+i);batch(s,a,b);}const jobs=Array.from({length:5},(_,i)=>s.claim('worker-'+i));assert.ok(jobs.every(Boolean));assert.equal(s.claim('six'),null);s.updateClaim(jobs[0],{phase:'submitting'});s.recover(Date.now()+100000);assert.equal(s.task('one',jobs[0].id).state,'needs_review');assert.equal(s.task('one',jobs[1].id).state,'queued');assert.equal(s.updateClaim(jobs[1],{message:'stale'}),false);assert.throws(()=>s.taskAction('one',jobs[0].id,'retry'));s.taskAction('one',jobs[0].id,'reconcile',{remoteId:'42'});assert.equal(s.task('one',jobs[0].id).state,'submitted');});
test('reauth resumes waiting submissions and audits without resubmitting',t=>{const s=fixture(t),{a,b}=seed(s);batch(s,a,b);const task=s.claim('worker');s.finish(task,'audit_pending','expired',{remote_id:'10'});s.invalidate('one',a.id);s.saveSession('one',a.id,{cookies:[]},{id:a.id});const next=s.claim('audit-worker');assert.equal(next.state,'auditing');assert.equal(next.remote_id,'10');assert.equal(next.attempts,1);});
test('media library stores owner-scoped images and rejects unsupported platform drafts',async t=>{
 const s=fixture(t);s.getAsset=(owner,id)=>s.asset(owner,id);
 const incoming=path.join(s.directory,'incoming',require('node:crypto').createHash('sha256').update('one').digest('hex').slice(0,20));fs.mkdirSync(incoming,{recursive:true});
 const uploadId='11111111-1111-4111-8111-111111111111';
 fs.writeFileSync(path.join(incoming,uploadId),await sharp({create:{width:16,height:16,channels:3,background:'#ff0000'}}).png().toBuffer());
 const asset=await s.registerAsset('one',{uploadId,kind:'image',name:'封面.png'});
 assert.equal(asset.kind,'image');assert.equal(s.assets('one').length,1);assert.equal(s.assets('other').length,0);
 assert.throws(()=>s.asset('other',asset.id));
 const account=s.addAccount('one','RedNote','笔记账号');
 const content=s.saveArticle('one',{title:'图文笔记',markdown:'测试内容',metadata:{contentType:'imageText',assetIds:[asset.id]}});
 const check=s.preflightBatch('one',{accountIds:[account.id],articleIds:[content.id],mode:'draft'});
 assert.equal(check.ok,false);assert.ok(check.errors.some(x=>x.code==='DRAFT_UNVERIFIED'));
 assert.equal(s.snapshot('one').articles[0].contentType,'imageText');
});
test('account groups, saved batch plans and per-account content snapshots stay local',t=>{
 const s=fixture(t),{a,b}=seed(s);
 s.setAccountGroup('one',a.id,'华东客户');assert.equal(s.account('one',a.id).group_name,'华东客户');
 const overrides={[a.id]:{[b.id]:{title:'账号专用标题',metadata:{digest:'专用摘要'}}}};
 const draft=s.saveBatchDraft('one',{name:'周一草稿',accountIds:[a.id],articleIds:[b.id],overrides});
 assert.equal(s.snapshot('one').drafts[0].name,'周一草稿');assert.equal(s.snapshot('other').drafts.length,0);
 assert.throws(()=>s.saveBatchDraft('other',{id:draft.id,name:'劫持',accountIds:[],articleIds:[]}));
 const result=s.preflightBatch('one',{accountIds:[a.id],articleIds:[b.id],mode:'draft',overrides});assert.equal(result.ok,true);
 s.createBatch('one',{accountIds:[a.id],articleIds:[b.id],mode:'draft',requestKey:'variant',overrides});
 assert.equal(s.snapshot('one').tasks[0].title,'账号专用标题');
 s.deleteBatchDraft('one',draft.id);assert.equal(s.snapshot('one').drafts.length,0);
});
test('batch spacing and daily cap assign durable per-task times',t=>{
 const s=fixture(t),{a,b}=seed(s),second=s.saveArticle('one',{title:'第二篇',markdown:'正文二',html:'<p>正文二</p>'}),third=s.saveArticle('one',{title:'第三篇',markdown:'正文三',html:'<p>正文三</p>'});
 const start=Date.now()+60000,input={accountIds:[a.id],articleIds:[b.id,second.id,third.id],mode:'draft',requestKey:'calendar',scheduledAt:start,intervalMinutes:30,dailyLimit:2};
 assert.equal(s.preflightBatch('one',input).ok,true);s.createBatch('one',input);
 const times=s.db.prepare('SELECT next_run FROM tasks ORDER BY rowid').all().map(row=>row.next_run);
 assert.deepEqual(times,[start,start+30*60000,start+86400000]);
 assert.equal(s.preflightBatch('one',{...input,intervalMinutes:1440}).ok,false);
});
test('source imports deduplicate durably without overwriting edits or queued task snapshots',t=>{
 const s=fixture(t),source={kind:'production',id:'production:batch:b1:i1:original',version:'v1',clientId:'client-1',batchId:'b1',itemId:'i1',variant:'original'};
 const input={title:'生产原稿',markdown:'原始正文',html:'<p>原始正文</p>',source,metadata:{digest:'摘要',tags:['测试']}};
 const first=s.importArticle('one',input);assert.equal(first.status,'created');
 s.saveArticle('one',{id:first.article.id,title:'分发独立修改',markdown:'修改正文',html:'<p>修改正文</p>',metadata:{digest:'修改摘要'}});
 const duplicate=s.importArticle('one',input);assert.equal(duplicate.status,'existing');assert.equal(duplicate.article.id,first.article.id);assert.equal(duplicate.article.title,'分发独立修改');
 const a=s.addAccount('one','CSDN','草稿账号');s.createBatch('one',{accountIds:[a.id],articleIds:[first.article.id],mode:'draft',requestKey:'import-snapshot'});
 const next=s.importArticle('one',{...input,markdown:'生产稿件第二版',html:'<p>生产稿件第二版</p>',source:{...source,version:'v2'}});
 assert.equal(next.status,'new_version');assert.notEqual(next.article.id,first.article.id);
 assert.equal(s.db.prepare('SELECT snapshot FROM tasks WHERE owner=?').get('one').snapshot.includes('分发独立修改'),true);
 assert.equal(s.article('one',first.article.id).markdown,'修改正文');
 assert.equal(s.importedArticle('other',{source}),null);const other=s.importArticle('other',input);assert.notEqual(other.article.id,first.article.id);
 assert.equal(s.article('one',first.article.id).metadata.source.batchId,'b1');
 s.db.close();s.db=new (require('node:sqlite').DatabaseSync)(path.join(s.directory,'publishing.sqlite'));
 assert.equal(s.importedArticle('one',{sourceKey:source.id,sourceVersion:'v1'}).article.id,first.article.id);
 assert.throws(()=>s.importArticle('one',{...input,source:{...source,kind:'remote'}}));
});
