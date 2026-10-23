const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os');
const {Store}=require('../store.cjs');
function fixture(t){const dir=fs.mkdtempSync(os.tmpdir()+'/geo-feedback-');const s=new Store(dir);t.after(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true})});return s;}
function seed(s,owner='one'){const a=s.addAccount(owner,'CSDN','账号');s.saveSession(owner,a.id,{cookies:[{name:'SESSION',value:'v'}]},{id:a.id,name:'账号'});const b=s.saveArticle(owner,{title:'文章',markdown:'正文',html:'<p>正文</p>'});return {a,b};}
function publish(s,a,b,extra={}){
  s.createBatch('one',{accountIds:[a.id],articleIds:[b.id],mode:'publish',requestKey:Math.random().toString(),clientId:'client-1',teamId:'team-1',...extra});
  const task=s.claim('worker');
  return {task,done:(state,extras={})=>s.finish(task,state,'平台已确认',extras)};
}
const row=(s,id)=>s.snapshot('one').tasks.find(t=>t.id===id);

test('batches keep the client they count toward and validate it',t=>{
  const s=fixture(t),{a,b}=seed(s);
  const {task}=publish(s,a,b);
  assert.equal(row(s,task.id).client_id,'client-1');assert.equal(row(s,task.id).team_id,'team-1');
  assert.throws(()=>s.createBatch('one',{accountIds:[a.id],articleIds:[b.id],mode:'publish',requestKey:'bad',clientId:'bad id;'}),/客户编号/);
  // The same request key with a different client is a different batch, not a silent reuse.
  s.createBatch('one',{accountIds:[a.id],articleIds:[b.id],mode:'publish',requestKey:'same',clientId:'client-1'});
  assert.throws(()=>s.createBatch('one',{accountIds:[a.id],articleIds:[b.id],mode:'publish',requestKey:'same',clientId:'client-2'}),/同一请求编号/);
});

test('only published tasks with a link and a client wait for write-back',t=>{
  const s=fixture(t),{a,b}=seed(s);
  const {task,done}=publish(s,a,b);
  done('published',{published_at:Date.now(),remote_url:'https://blog.csdn.net/u/article/details/1'});
  const pending=s.feedbackPending();
  assert.equal(pending.length,1);assert.equal(pending[0].id,task.id);assert.equal(pending[0].owner,'one');
  assert.equal(pending[0].remote_url,'https://blog.csdn.net/u/article/details/1');assert.equal(pending[0].client_id,'client-1');

  const second=seed(s);s.createBatch('one',{accountIds:[second.a.id],articleIds:[second.b.id],mode:'publish',requestKey:'no-client'});
  const unlinked=s.claim('worker');s.finish(unlinked,'published','ok',{published_at:Date.now(),remote_url:'https://blog.csdn.net/u/article/details/2'});
  assert.equal(s.feedbackPending().length,1,'a task without a client is never written back');

  s.markFeedback('one',task.id,'matched','已计入发布计划');
  assert.equal(s.feedbackPending().length,0);
  assert.equal(row(s,task.id).feedback_state,'matched');assert.equal(row(s,task.id).feedback_message,'已计入发布计划');
  assert.throws(()=>s.markFeedback('other',task.id,'matched'),/无权访问/);
  assert.throws(()=>s.markFeedback('one',task.id,'bogus'),/回写结果无效/);
});

test('failed write-backs retry after a delay; missing links can be added once published',t=>{
  const s=fixture(t),{a,b}=seed(s);
  const {task,done}=publish(s,a,b);
  assert.throws(()=>s.setTaskUrl('one',task.id,'https://example.com/a'),/只有已发布/);
  done('published',{published_at:Date.now()});
  assert.equal(s.feedbackPending().length,0,'no link yet');
  assert.throws(()=>s.setTaskUrl('one',task.id,'javascript:alert(1)'),/http/);
  s.setTaskUrl('one',task.id,'https://blog.csdn.net/u/article/details/3');
  assert.equal(s.feedbackPending().length,1);

  s.markFeedback('one',task.id,'error','数据库暂时不可用');
  assert.equal(row(s,task.id).feedback_state,'retry');
  assert.equal(s.feedbackPending().length,0,'waits for the back-off');
  s.db.prepare('UPDATE tasks SET feedback_next_at=0 WHERE id=?').run(task.id);
  assert.equal(s.feedbackPending().length,1);

  // A corrected link starts the write-back over.
  s.markFeedback('one',task.id,'denied','无权限');
  s.setTaskUrl('one',task.id,'https://blog.csdn.net/u/article/details/4');
  assert.equal(row(s,task.id).feedback_state,null);assert.equal(s.feedbackPending().length,1);
});

test('drafts are never written back',t=>{
  const s=fixture(t),{a,b}=seed(s);
  s.createBatch('one',{accountIds:[a.id],articleIds:[b.id],mode:'draft',requestKey:'draft',clientId:'client-1'});
  const task=s.claim('worker');s.finish(task,'draft','草稿',{remote_url:'https://blog.csdn.net/u/article/details/5'});
  assert.equal(s.feedbackPending().length,0);
});
