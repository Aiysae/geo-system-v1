"""Fault recovery through the actual authenticated API and login UI."""
import json, os, time, uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[3];BASE='http://127.0.0.1:18860';OUT=ROOT/'.data/publishing-preview/evidence'
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path=str(ROOT/'.data/local-publishing-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell'))
 context=b.new_context(storage_state=str(OUT/'browser-session.json'),viewport={'width':1440,'height':1050});page=context.new_page()
 def get(action='state',id=''):
  r=context.request.get(BASE+'/api/local-publishing',params={'action':action,'id':id});assert r.ok,r.text();return r.json()
 def post(operation,**data):
  r=context.request.post(BASE+'/api/local-publishing',data={'action':operation,'input':data},headers={'Origin':BASE});assert r.ok,r.text();return r.json()
 def until(predicate,timeout=120):
  end=time.monotonic()+timeout
  while time.monotonic()<end:
   value=predicate()
   if value:return value
   page.wait_for_timeout(700)
  raise AssertionError('Timed out. Tasks: '+str([(t['state'],t['message'])for t in get()['tasks']]))
 def task(id):return next(t for t in get()['tasks'] if t['id']==id)
 def new_job(title,mode='publish',scheduledAt=None):
  article=post('article.save',title=title,markdown='本地故障恢复验收正文。');batch=post('batch.create',accountIds=[account['id']],articleIds=[article['id']],mode=mode,requestKey=str(uuid.uuid4()),scheduledAt=scheduledAt);return until(lambda:next((t for t in get()['tasks'] if t['batch_id']==batch['id']),None))['id']
 try:
  page.goto(BASE+'/publishing',wait_until='networkidle');account=next(a for a in get()['accounts'] if a['remote_id']=='demo-a');results={}
  post('demo.fault',id=account['id'],kind='expire');job=new_job('登录过期恢复验收');until(lambda:task(job)['state']=='waiting_login')
  # Complete reauthentication inside the embedded browser; never press Continue.
  row=page.get_by_role('row').filter(has=page.get_by_text(account['label'],exact=True));row.get_by_role('button',name='登录 / 查看',exact=True).click();image=page.get_by_alt_text('平台登录实时画面');image.wait_for(timeout=60000)
  def click_frame(x,y):
   expect(page.get_by_role('button',name='发送输入',exact=True)).to_be_enabled();box=image.bounding_box();image.click(position={'x':x*box['width']/1200,'y':y*box['height']/800})
  def type_frame(value):page.get_by_label('输入到已选中的平台输入框').fill(value);page.get_by_role('button',name='发送输入',exact=True).click()
  click_frame(250,320);type_frame('demo-a');click_frame(250,425);type_frame('demo1234');click_frame(250,490)
  until(lambda:next(a for a in get()['accounts'] if a['id']==account['id'])['state']=='ready');page.get_by_role('button',name='关闭登录窗口',exact=True).click();until(lambda:task(job)['state']=='published');results['expired_login']=task(job)['state'];print('PASS expired login → UI reauthentication → automatic publish',flush=True)
  post('demo.fault',id=account['id'],kind='quota');job=new_job('限流自动恢复验收');until(lambda:task(job)['state']=='retry_wait');until(lambda:task(job)['state']=='published');assert task(job)['attempts']>1;results['rate_limit']={'state':task(job)['state'],'attempts':task(job)['attempts']};print('PASS rate limit → automatic backoff → publish',flush=True)
  post('demo.fault',id=account['id'],kind='drop');job=new_job('提交后断网防重验收');until(lambda:task(job)['state']=='needs_review',200);posts=[x for x in get('demo.posts',account['id']) if x['task']==job];assert len(posts)==1 and posts[0]['status']=='64';page.wait_for_timeout(4000);assert len([x for x in get('demo.posts',account['id']) if x['task']==job])==1
  post('demo.fault',id=account['id'],kind='restore');post('task.action',id=job,action='reconcile',remoteId=str(posts[0]['id']));until(lambda:task(job)['state']=='published');results['lost_response']={'copies':1,'after_reconcile':task(job)['state']};print('PASS lost submission response → needs review, one copy → reconcile',flush=True)
  # A paused queue must not dispatch; resume then saves a draft through the SDK.
  post('queue.pause',paused=True);job=new_job('暂停与草稿验收','draft');page.wait_for_timeout(1800);assert task(job)['state']=='queued';post('queue.pause',paused=False);until(lambda:task(job)['state']=='draft');assert any(x['task']==job and x['status']=='2' for x in get('demo.posts',account['id']));results['draft_and_pause']='passed';print('PASS pause/resume + saved draft exists in platform database',flush=True)
  job=new_job('定时分发验收','draft',int(time.time()*1000)+5000);page.wait_for_timeout(1000);assert task(job)['state']=='queued';until(lambda:task(job)['state']=='draft');results['scheduled']='passed';print('PASS scheduled draft',flush=True)
  page.get_by_role('button',name='3 批量分发',exact=True).click();page.screenshot(path=str(OUT/'recovery-passed.png'),full_page=True)
  (OUT/'recovery-result.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
 finally:b.close()
