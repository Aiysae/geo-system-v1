const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const localBrowsers=path.join(process.cwd(),'.data/local-publishing-browsers');
if(fs.existsSync(localBrowsers))process.env.PLAYWRIGHT_BROWSERS_PATH=localBrowsers;
const {chromium}=require('playwright');
const adapter=require('../platform-adapters/juejin.cjs');

test('掘金适配器不把未登录会话当作成功',async()=>{
  const result=await adapter.verifySession({session:{cookies:[],origins:[]}});
  assert.equal(result.ok,false);
  assert.equal(result.code,'AUTH');
  assert.deepEqual(adapter.contentTypes,['article']);
  assert.deepEqual(adapter.draftTypes,['article']);
});

test('仅从成功的本人资料响应提取账号身份',()=>{
  const parse=adapter._internal.responseIdentity;
  assert.deepEqual(parse({err_no:0,data:{user_info:{user_id:'123',user_name:'测试用户'}}}),{id:'123',name:'测试用户'});
  assert.equal(parse({err_no:1,data:{user_info:{user_id:'123',user_name:'测试用户'}}}),null);
  assert.equal(parse({err_no:0,data:{user_id:'123'}}),null);
});

test('本地编辑器样本可填写标题和 Markdown，不触发发布',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<input placeholder="请输入文章标题"><div class="cm-content" contenteditable="true"></div><button id="publish">发布</button>');
    let published=false;
    await page.locator('#publish').evaluate(button=>button.addEventListener('click',()=>{window.published=true;}));
    const result=await adapter._internal.fillArticle(page,{title:'掘金草稿测试',markdown:'# 测试正文'});
    assert.equal(result.ok,true);
    assert.equal(await page.locator('input').inputValue(),'掘金草稿测试');
    assert.equal(await page.locator('.cm-content').innerText(),'# 测试正文');
    assert.equal(await adapter._internal.readMarkdown(page),'# 测试正文');
    published=await page.evaluate(()=>Boolean(window.published));
    assert.equal(published,false);
  }finally{await browser.close();}
});

test('草稿箱样本必须按编号回读标题和正文',async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.route('https://juejin.cn/editor/drafts**',route=>{
      const pathname=new URL(route.request().url()).pathname;
      const body=pathname==='/editor/drafts'
        ?'<a href="/editor/drafts/991">样本标题</a>'
        :'<input placeholder="文章标题" value="样本标题"><div class="cm-content" contenteditable="true"># 样本正文</div>';
      return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body});
    });
    assert.deepEqual(await adapter._internal.readDraft(page,'样本标题','# 样本正文','991'),{ok:true,remoteId:'991'});
    const mismatch=await adapter._internal.readDraft(page,'样本标题','# 其他正文','991');
    assert.equal(mismatch.ok,false);
    assert.equal(mismatch.code,'NEEDS_REVIEW');
  }finally{await browser.close();}
});
