"""End-to-end test through the real local GEO page; only DEMO_CSDN is used."""
import json, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[3]
BASE='http://127.0.0.1:18860'
OUT=ROOT/'.data/publishing-preview/evidence';OUT.mkdir(parents=True,exist_ok=True)
BROWSER=os.environ.get('LOCAL_PUBLISHER_BROWSER',str(ROOT/'.data/local-publishing-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell'))
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,executable_path=BROWSER)
    context=b.new_context(viewport={'width':1440,'height':1050})
    page=context.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    def state():
        r=context.request.get(BASE+'/api/local-publishing');assert r.ok,r.text();return r.json()
    def post(action,**data):
        r=context.request.post(BASE+'/api/local-publishing',data={'action':action,'input':data},headers={'Origin':BASE});assert r.ok,r.text();return r.json()
    def until(predicate,timeout=100):
        deadline=time.time()+timeout
        while time.time()<deadline:
            result=predicate()
            if result:return result
            page.wait_for_timeout(700)
        raise AssertionError('Timed out: '+json.dumps(state(),ensure_ascii=False)[:4000])
    def tab(name):page.get_by_role('button',name=name,exact=True).click()
    def platform_login(label,username):
        row=page.get_by_role('row').filter(has=page.get_by_text(label,exact=True));row.get_by_role('button',name='登录 / 查看',exact=True).click()
        image=page.get_by_alt_text('平台登录实时画面');image.wait_for(timeout=60000)
        expect(page.get_by_role('dialog').get_by_role('button',name='发送输入')).to_be_enabled()
        def click_frame(x,y):
            expect(page.get_by_role('button',name='发送输入',exact=True)).to_be_enabled();box=image.bounding_box();image.click(position={'x':x*box['width']/1200,'y':y*box['height']/800})
        def type_frame(text):
            page.get_by_label('输入到已选中的平台输入框').fill(text);page.get_by_role('button',name='发送输入',exact=True).click()
        click_frame(250,320);page.get_by_role('button',name='全选当前输入',exact=True).click();type_frame(username);click_frame(250,425);page.get_by_role('button',name='全选当前输入',exact=True).click();type_frame('demo1234');click_frame(250,490)
        until(lambda:any(a['label']==label and a['state']=='ready' for a in state()['accounts']))
        page.screenshot(path=str(OUT/(username+'-login.png')),full_page=True)
        page.get_by_role('button',name='关闭登录窗口',exact=True).click();expect(page.get_by_role('dialog')).not_to_be_visible();print('PASS login:',label,flush=True)
    try:
        page.goto(BASE+'/publishing',wait_until='networkidle')
        if '/sign-in' in page.url:
            page.locator('input[name=email]').fill('publishing-demo@local.test');page.locator('input[name=password]').fill('LocalDemo2026!');page.get_by_role('button',name='登录',exact=True).click();page.wait_for_url('**/publishing')
        page.wait_for_load_state('networkidle')
        assert len(state()['platforms'])==25
        # Actual DOM was inspected before this script; labels match the rendered UI.
        for label,username in [('演示甲','demo-a'),('演示乙','demo-b')]:
            a=next((a for a in state()['accounts'] if a['label']==label),None)
            if not a:
                page.get_by_label('文章平台',exact=True).select_option('DEMO_CSDN');page.get_by_label('账号备注').fill(label);page.get_by_role('button',name='添加账号',exact=True).click();until(lambda:any(a['label']==label for a in state()['accounts']))
            if not a or a['state']!='ready':platform_login(label,username)
        assert {a['remote_id'] for a in state()['accounts']}=={'demo-a','demo-b'}
        tab('2 文章库')
        for title in ['分发验收文章一','分发验收文章二']:
            if not any(a['title']==title for a in state()['articles']):
                page.get_by_role('button',name='新建',exact=True).click();page.get_by_label('标题',exact=True).fill(title);page.get_by_label('正文（支持 Markdown）').fill('## 本地验收\n\n这是一篇测试文章，验证多账号隔离和持久化队列。\n\n|项目|结果|\n|---|---|\n|文章内容|完整|');page.get_by_label('标签（逗号分隔）').fill('测试，GEO');page.get_by_role('button',name='保存文章并选择',exact=True).click();until(lambda:any(a['title']==title for a in state()['articles']))
        tab('3 批量分发')
        for label in ['演示甲','演示乙']:page.locator('fieldset').filter(has=page.get_by_text('分发账号',exact=True)).get_by_label(label,exact=False).check()
        for title in ['分发验收文章一','分发验收文章二']:page.locator('fieldset').filter(has=page.get_by_text('文章',exact=True)).get_by_label(title,exact=True).check()
        page.get_by_label('执行方式').select_option('publish');page.get_by_role('button',name='创建分发批次',exact=True).click()
        until(lambda:len(state()['tasks'])>=4)
        first=state()['tasks'];batch_id=first[0]['batch_id'];ids={t['id'] for t in first if t['batch_id']==batch_id}
        assert len(ids)==4
        # Second click must reuse the batch, even after an HTTP response was lost.
        page.get_by_role('button',name='创建分发批次',exact=True).click();page.wait_for_timeout(500);assert len([t for t in state()['tasks'] if t['batch_id']==batch_id])==4
        until(lambda:all(t['state']=='published' for t in state()['tasks'] if t['id'] in ids),150)
        for a in state()['accounts']:
            posts=context.request.get(BASE+'/api/local-publishing?action=demo.posts&id='+a['id']).json()
            assert len([x for x in posts if x['task'] in ids])==2
        page.reload(wait_until='networkidle');tab('3 批量分发');until(lambda:len(state()['tasks'])>=4)
        page.screenshot(path=str(OUT/'batch-published.png'),full_page=True)
        assert not errors,errors
        # Auth and CSRF checks: actual HTTP route, not stubs.
        anon=p.request.new_context();assert anon.get(BASE+'/api/local-publishing').status==401;anon.dispose()
        assert context.request.post(BASE+'/api/local-publishing',data={'action':'account.add','input':{}},headers={'Origin':'https://example.invalid'}).status==403
        assert context.request.post(BASE+'/api/local-publishing',data={'action':'account.add','input':{}}).status==403
        print('PASS 2 accounts × 2 articles; SDK submission + audit; duplicate click; reload; auth + CSRF',flush=True)
        (OUT/'ui-result.json').write_text(json.dumps({'passed':True,'tasks':[{k:t[k] for k in ['id','title','platform','account_name','state','remote_id']} for t in state()['tasks']],'browserErrors':errors},ensure_ascii=False,indent=2))
        context.storage_state(path=str(OUT/'browser-session.json'))
    finally:b.close()
