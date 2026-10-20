# -*- coding: utf-8 -*-
"""Layout regression: local DEMO_CSDN drafts only; real platforms stay untouched."""
import json, os, re, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[3]
BASE='http://127.0.0.1:18860'
OUT=ROOT/'docs/local-publishing-validation';OUT.mkdir(parents=True,exist_ok=True)
BROWSER=os.environ.get('LOCAL_PUBLISHER_BROWSER',str(ROOT/'.data/local-publishing-browsers/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell'))
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=BROWSER)
    context=browser.new_context(viewport={'width':1440,'height':1000})
    page=context.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    def snapshot():
        r=context.request.get(BASE+'/api/local-publishing');assert r.ok,r.status;return r.json()
    def until(predicate,timeout=120):
        deadline=time.time()+timeout
        while time.time()<deadline:
            result=predicate()
            if result:return result
            page.wait_for_timeout(600)
        raise AssertionError('Timed out waiting for local UI regression')
    def button(name):return page.get_by_role('button',name=name,exact=True)
    try:
        page.goto(BASE+'/publishing',wait_until='networkidle')
        if '/sign-in' in page.url:
            page.locator('input[name=email]').fill('publishing-demo@local.test')
            page.locator('input[name=password]').fill('LocalDemo2026!')
            button('登录').click();page.wait_for_url('**/publishing');page.wait_for_load_state('networkidle')
        expect(page.get_by_role('heading',name='账号管理',exact=True)).to_be_visible()
        initial=snapshot();demo=[a for a in initial['accounts'] if a['platform']=='DEMO_CSDN' and a['label'] in ['演示甲','演示乙']]
        assert len(demo)==2 and all(a['state']=='ready' for a in demo)
        baseline_real=[{k:a[k] for k in ['id','state','remote_id']} for a in initial['accounts'] if a['platform']!='DEMO_CSDN']
        baseline_real_tasks=[t['id'] for t in initial['tasks'] if t['platform']!='DEMO_CSDN']
        # Selection survives filtering and view switching.
        for a in demo:page.get_by_label('选择账号 '+a['label'],exact=True).check()
        page.get_by_label('搜索账号',exact=True).fill('演示甲')
        expect(page.get_by_role('row').filter(has_text='演示乙')).to_have_count(0)
        page.get_by_label('搜索账号',exact=True).fill('')
        for a in demo:expect(page.get_by_label('选择账号 '+a['label'],exact=True)).to_be_checked()
        button('宫格视图').click();expect(page.get_by_label('选择账号 演示甲',exact=True)).to_be_checked()
        button('列表视图').click()
        button('授权账号').click();dialog=page.get_by_role('dialog',name='添加账号',exact=True)
        expect(dialog).to_be_visible();expect(dialog.get_by_role('button',name='选择平台 CSDN',exact=True)).to_be_visible()
        assert dialog.get_by_role('button',name='选择平台 ').count()==25
        page.screenshot(path=str(OUT/'新版-添加账号.png'),full_page=True)
        # A failed authorization request reports inside the dialog, without reaching a platform.
        def fail_add(route):
            if route.request.method=='POST' and route.request.post_data_json.get('action')=='account.add':
                route.fulfill(status=503,json={'error':'模拟连接失败，请重试'})
            else:route.continue_()
        page.route('**/api/local-publishing',fail_add)
        dialog.get_by_label('账号备注',exact=True).fill('仅测试错误回显')
        dialog.get_by_role('button',name='添加账号并登录',exact=True).click()
        expect(dialog.get_by_role('alert')).to_contain_text('模拟连接失败')
        page.unroute('**/api/local-publishing',fail_add)
        page.keyboard.press('Escape');expect(dialog).not_to_be_visible()
        button('关闭错误').click()
        page.screenshot(path=str(OUT/'新版-账号管理.png'),full_page=True)
        print('PASS account search, selection, grid and authorization dialog',flush=True)
        # Existing isolated session opens inside the redesign and closes through backend.
        row=page.get_by_role('row').filter(has=page.get_by_text('演示甲',exact=True))
        row.get_by_role('button',name='打开账号窗口',exact=True).click()
        expect(page.get_by_alt_text('平台登录实时画面')).to_be_visible(timeout=60000)
        expect(button('检查登录状态')).to_be_enabled(timeout=60000)
        button('检查登录状态').click();expect(button('关闭登录窗口')).to_be_enabled(timeout=60000)
        button('关闭登录窗口').click();expect(page.get_by_role('dialog')).not_to_be_visible(timeout=30000)
        # Two new local articles, metadata, working format toolbar and rendered preview.
        button('文章素材').click();stamp=str(int(time.time()))
        titles=['【本地界面验收】草稿一 '+stamp,'【本地界面验收】草稿二 '+stamp]
        for index,title in enumerate(titles):
            (button('新建另一篇') if index else page.locator('section').get_by_role('button',name='新建文章',exact=True)).click();page.get_by_label('标题',exact=True).fill(title)
            body=page.get_by_label('正文（支持 Markdown）',exact=True)
            body.fill('新版工作台验收\n\n- 账号独立登录\n- 两账号批量草稿\n\n只在本地演示平台运行。')
            body.press('ControlOrMeta+A');body.press('ArrowLeft');button('二级标题').click()
            expect(body).to_have_value(re.compile(r'^## '))
            page.get_by_label('标签（逗号分隔）',exact=True).fill('界面验收，本地演示')
            page.get_by_label('摘要',exact=True).fill('新版页面回归验证')
            page.get_by_label('这是原创文章',exact=True).check()
            button('预览').click();expect(page.get_by_role('heading',name='新版工作台验收',exact=True)).to_be_visible()
            page.screenshot(path=str(OUT/'新版-文章编辑.png'),full_page=True)
            button('继续编辑').click()
            held=[]
            def hold_save(route):
                if route.request.method=='POST' and route.request.post_data_json.get('action')=='article.save':held.append(route)
                else:route.continue_()
            page.route('**/api/local-publishing',hold_save)
            button('保存文章并选择').click();until(lambda:held)
            expect(button('新建另一篇')).to_be_disabled()
            held[0].continue_();page.unroute('**/api/local-publishing',hold_save)
            until(lambda:any(a['title']==title for a in snapshot()['articles']))
            expect(button('保存文章并选择')).to_be_enabled()
        print('PASS login window, editor, toolbar and preview',flush=True)
        button('发布').click();button('批量分发').click()
        expect(page.get_by_text('2 篇文章 × 2 个账号 = 4 个任务',exact=True)).to_be_visible()
        assert page.get_by_label('执行方式',exact=True).input_value()=='draft'
        button('添加文章').click();dialog=page.get_by_role('dialog',name='选择文章素材',exact=True)
        for title in titles:expect(dialog.get_by_label('选择分发文章 '+title,exact=True)).to_be_checked()
        dialog.get_by_role('button',name='确定选择',exact=True).click()
        button('添加账号').click();dialog=page.get_by_role('dialog',name='选择分发账号',exact=True)
        for a in demo:expect(dialog.get_by_label('选择分发账号 '+a['label'],exact=True)).to_be_checked()
        for a in initial['accounts']:
            if a['platform']!='DEMO_CSDN':expect(dialog.get_by_label('选择分发账号 '+a['label'],exact=True)).not_to_be_checked()
        dialog.get_by_role('button',name='确定选择',exact=True).click()
        page.screenshot(path=str(OUT/'新版-批量分发.png'),full_page=True)
        # Queue pause holds jobs while duplicate submit is exercised via UI.
        if not snapshot()['paused']:button('暂停队列').click();until(lambda:snapshot()['paused'])
        button('创建分发批次').click()
        batch=until(lambda:[t for t in snapshot()['tasks'] if t['title'] in titles]);batch_id=batch[0]['batch_id']
        batch=until(lambda:[t for t in snapshot()['tasks'] if t['batch_id']==batch_id and len([x for x in snapshot()['tasks'] if x['batch_id']==batch_id])==4])
        ids={t['id'] for t in batch};assert len(ids)==4
        assert all(t['platform']=='DEMO_CSDN' and t['mode']=='draft' for t in batch)
        button('批量分发').click()
        # Re-selecting the same set in a different order must reuse the batch too.
        button('添加账号').click();dialog=page.get_by_role('dialog',name='选择分发账号',exact=True)
        choice=dialog.get_by_label('选择分发账号 '+demo[0]['label'],exact=True)
        choice.uncheck();choice.check();dialog.get_by_role('button',name='确定选择',exact=True).click()
        button('添加文章').click();dialog=page.get_by_role('dialog',name='选择文章素材',exact=True)
        choice=dialog.get_by_label('选择分发文章 '+titles[0],exact=True)
        choice.uncheck();choice.check();dialog.get_by_role('button',name='确定选择',exact=True).click()
        button('创建分发批次').click()
        expect(page.get_by_role('status')).to_contain_text('这个批次已经提交')
        assert len([t for t in snapshot()['tasks'] if t['title'] in titles])==4
        button('恢复队列').click();until(lambda:all(t['state']=='draft' for t in snapshot()['tasks'] if t['id'] in ids),150)
        for a in demo:
            r=context.request.get(BASE+'/api/local-publishing?action=demo.posts&id='+a['id']);assert r.ok
            posts=[x for x in r.json() if x['task'] in ids];assert len(posts)==2 and all(x['status']=='2' for x in posts)
        page.get_by_label('搜索任务',exact=True).fill(stamp)
        expect(page.locator('tr[data-task-id]')).to_have_count(4)
        page.screenshot(path=str(OUT/'新版-草稿任务完成.png'),full_page=True)
        page.reload(wait_until='networkidle');button('发布').click();page.get_by_label('搜索任务',exact=True).fill(stamp)
        expect(page.locator('tr[data-task-id]')).to_have_count(4)
        # Narrow screen keeps overflow inside table region; modal remains usable.
        page.set_viewport_size({'width':390,'height':844});button('账号').click()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        button('授权账号').click();expect(page.get_by_role('dialog',name='添加账号',exact=True)).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        page.screenshot(path=str(OUT/'新版-手机添加账号.png'),full_page=True)
        page.keyboard.press('Escape')
        button('发布').click();button('批量分发').click()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        page.screenshot(path=str(OUT/'新版-手机批量分发.png'),full_page=True)
        final=snapshot()
        assert baseline_real==[{k:a[k] for k in ['id','state','remote_id']} for a in final['accounts'] if a['platform']!='DEMO_CSDN']
        assert baseline_real_tasks==[t['id'] for t in final['tasks'] if t['platform']!='DEMO_CSDN']
        assert not errors,errors
        (OUT/'新版界面回归.json').write_text(json.dumps({'passed':True,'localDraftTasks':[{k:t[k] for k in ['id','title','account_name','platform','mode','state']} for t in final['tasks'] if t['id'] in ids],'duplicateSubmitReused':True,'realPlatformsUntouched':True,'browserErrors':errors,'viewports':[1440,390]},ensure_ascii=False,indent=2))
        print('PASS: selection/search/grid; authorization modal; session window; editor/preview; 2×2 drafts; duplicate submit; refresh; 390px; real platforms untouched',flush=True)
    finally:
        # Restore the queue even if an assertion fails after pausing it.
        if 'initial' in locals() and not initial['paused']:
            context.request.post(BASE+'/api/local-publishing',data={'action':'queue.pause','input':{'paused':False}},headers={'Origin':BASE})
        browser.close()
