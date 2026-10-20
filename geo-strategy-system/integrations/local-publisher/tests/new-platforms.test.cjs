const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const {Store}=require('../store.cjs');
const {adapters}=require('../platform-adapters/index.cjs');

test('new platforms appear in order and block unverified publish/drafts',t=>{
  assert.deepEqual(adapters.map(adapter=>adapter.id),['CtripNotes','Meipian','Juejin']);
  const directory=fs.mkdtempSync(`${os.tmpdir()}/geo-platforms-`);
  const store=new Store(directory,{getAsset:()=>({kind:'image'})});
  t.after(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true});});
  const owner='platform-test';
  const ctrip=store.addAccount(owner,'CtripNotes','携程笔记测试');
  const meipian=store.addAccount(owner,'Meipian','美篇测试');
  const juejin=store.addAccount(owner,'Juejin','掘金测试');
  const note=store.saveArticle(owner,{title:'上海周末旅行路线',markdown:'从外滩出发，沿江散步。',metadata:{contentType:'imageText',assetIds:['photo']}});
  const article=store.saveArticle(owner,{title:'本地测试文章',markdown:'正文',html:'<p>正文</p>'});
  const check=(account,content,mode)=>store.preflightBatch(owner,{accountIds:[account.id],articleIds:[content.id],mode});
  assert.equal(check(ctrip,note,'draft').ok,true);
  assert.ok(check(ctrip,note,'publish').errors.some(issue=>issue.code==='PUBLISH_UNVERIFIED'));
  assert.ok(check(meipian,article,'draft').errors.some(issue=>issue.code==='DRAFT_UNVERIFIED'));
  assert.ok(check(meipian,article,'publish').errors.some(issue=>issue.code==='PUBLISH_UNVERIFIED'));
  assert.equal(check(juejin,article,'draft').ok,true);
  assert.ok(check(juejin,article,'publish').errors.some(issue=>issue.code==='PUBLISH_UNVERIFIED'));
  assert.ok(check(ctrip,store.saveArticle(owner,{title:'短题',markdown:'正文',metadata:{contentType:'imageText',assetIds:['photo']}}),'draft').errors.some(issue=>issue.code==='CTRIP_TITLE'));
});
