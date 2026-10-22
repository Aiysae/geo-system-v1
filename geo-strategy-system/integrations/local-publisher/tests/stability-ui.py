"""Local browser regression for login persistence and account health. Drafts only."""
import json,time,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[3];BASE='http://127.0.0.1:18860'
OUT=ROOT/'.data/publishing-preview/evidence/stability';OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path=str(ROOT/'.data/local-publishing-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell'))
 context=b.new_context(viewport={'width':1440,'height':1000});page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def state():
  r=context.request.get(BASE+'/api/local-publishing');assert r.ok,r.text();return r.json()
 def post(action,**data):
  r=context.request.post(BASE+'/api/local-publishing',data={'action':action,'input':data},headers={'Origin':BASE},timeout=65000);assert r.ok,r.text();return r.json()
 def until(fn,seconds=70):
  end=time.monotonic()+seconds
  while time.monotonic()<end:
   result=fn()
   if result:return result
   page.wait_for_timeout(400)
  raise AssertionError('等待状态超时')
 def btn(name):return page.get_by_role('button',name=name,exact=True)
 def account():return next(a for a in state()['accounts'] if a['label']==label)
 def login():
  screen=page.get_by_alt_text('平台登录实时画面');expect(screen).to_be_visible(timeout=60000)
  for x,y,value in [(250,320,username),(250,425,'demo1234')]:
   expect(btn('发送输入')).to_be_enabled(timeout=60000);box=screen.bounding_box();screen.click(position={'x':x*box['width']/1200,'y':y*box['height']/800});page.get_by_label('输入到已选中的平台输入框').fill(value);btn('发送输入').click()
  expect(btn('发送输入')).to_be_enabled();box=screen.bounding_box();screen.click(position={'x':250*box['width']/1200,'y':490*box['height']/800})
  until(lambda:account()['state']=='ready');expect(screen).not_to_be_visible(timeout=60000)
  assert all(w['id']!=account()['id'] for w in state()['loginWindows'])
 def job(title):
  article=post('article.save',title=title,markdown='只在本地演示平台保存草稿。');batch=post('batch.create',accountIds=[account()['id']],articleIds=[article['id']],mode='draft',requestKey=str(uuid.uuid4()));return next(t['id'] for t in state()['tasks'] if t['batch_id']==batch['id'])
 def task(id):return next(t for t in state()['tasks'] if t['id']==id)
 try:
  page.goto(BASE+'/publishing',wait_until='networkidle',timeout=120000)
  if '/sign-in' in page.url:
   page.locator('input[name=email]').fill('publishing-demo@local.test');page.locator('input[name=password]').fill('LocalDemo2026!');btn('登录').click();page.wait_for_url('**/publishing',timeout=60000);page.wait_for_load_state('networkidle')
  expect(page.get_by_role('heading',name='账号管理',exact=True)).to_be_visible(timeout=60000)
  page.screenshot(path=str(OUT/'before.png'),full_page=True)
  label='稳定性界面验收-'+str(int(time.time()));username='stability-'+str(int(time.time()))
  btn('授权账号').click();dialog=page.get_by_role('dialog',name='添加账号',exact=True);dialog.get_by_role('button',name='选择平台 本地演示平台',exact=True).click();dialog.get_by_label('账号备注').fill(label);dialog.get_by_role('button',name='添加账号并登录',exact=True).click();login()
  page.get_by_label('搜索账号',exact=True).fill(label);row=page.get_by_role('row').filter(has=page.get_by_text(label,exact=True));expect(row).to_contain_text('状态保存');expect(row).to_contain_text('核验成功')
  post('demo.fault',id=account()['id'],kind='challenge');first=job('验证挑战恢复');until(lambda:task(first)['state']=='waiting_login');expect(row).to_contain_text('待平台验证',timeout=15000);second=job('验证同账号暂停');assert task(second)['state']=='waiting_login'
  page.screenshot(path=str(OUT/'challenge.png'),full_page=True)
  post('demo.fault',id=account()['id'],kind='restore');row.get_by_role('button',name='扫码 / 登录',exact=True).click();until(lambda:account()['state']=='ready');expect(page.get_by_role('dialog',name='平台账号登录')).not_to_be_visible(timeout=60000)
  until(lambda:all(task(id)['state']=='draft' for id in [first,second]))
  post('demo.fault',id=account()['id'],kind='quota');third=job('请求限速恢复');until(lambda:task(third)['state']=='retry_wait');expect(row).to_contain_text('请求限速等待中',timeout=15000);expect(row).to_contain_text('下次尝试');page.screenshot(path=str(OUT/'rate-limit.png'),full_page=True);until(lambda:task(third)['state']=='draft')
  post('demo.fault',id=account()['id'],kind='expire');fourth=job('重新登录自动恢复');until(lambda:task(fourth)['state']=='waiting_login');row.get_by_role('button',name='扫码 / 登录',exact=True).click();login();until(lambda:task(fourth)['state']=='draft')
  # Close the entire browser while a queued draft is waiting. The server continues.
  post('queue.pause',paused=True);fifth=job('关闭浏览器仍完成草稿');saved=context.storage_state();api=p.request.new_context(storage_state=saved)
  post('queue.pause',paused=False);b.close()
  end=time.monotonic()+40
  while time.monotonic()<end:
   detached=api.get(BASE+'/api/local-publishing').json()
   if next(t for t in detached['tasks'] if t['id']==fifth)['state']=='draft':break
   time.sleep(.4)
  else:raise AssertionError('关闭浏览器后任务未继续')
  api.dispose();b=p.chromium.launch(headless=True,executable_path=str(ROOT/'.data/local-publishing-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell'))
  context=b.new_context(storage_state=saved,viewport={'width':1440,'height':1000});page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(BASE+'/publishing',wait_until='networkidle');assert account()['state']=='ready'
  # Refresh during an unfinished login: an abandoned viewer must release its slot.
  abandoned=post('account.add',platform='DEMO_CSDN',label='未完成登录回收-'+str(int(time.time())))
  post('login.open',id=abandoned['id']);page.reload(wait_until='networkidle')
  until(lambda:all(w['id']!=abandoned['id'] for w in state()['loginWindows']),seconds=105)
  page.reload(wait_until='networkidle');page.get_by_label('搜索账号',exact=True).fill(label);expect(page.get_by_role('row').filter(has=page.get_by_text(label,exact=True))).to_contain_text('状态保存');page.screenshot(path=str(OUT/'passed.png'),full_page=True)
  page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth');page.screenshot(path=str(OUT/'mobile.png'),full_page=True)
  assert not errors,errors
  (OUT/'result.json').write_text(json.dumps({'passed':True,'drafts':5,'loginViaEmbeddedBrowser':True,'automaticWindowRelease':True,'browserClosedDraftCompleted':True,'abandonedWindowReclaimed':True,'challengePauseAndResume':True,'rateLimitVisibleAndAutoResume':True,'expiredLoginAutoResume':True,'pageErrors':errors},ensure_ascii=False,indent=2))
  print('PASS: auto-close after login, abandoned window reclaimed, browser-closed draft completion, challenge/429/expiry recovery, five demo drafts, 390px layout')
 finally:b.close()
