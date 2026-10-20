const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

const id='Juejin';
const loginUrls={authorizeUrl:'https://juejin.cn/editor/drafts/new',entryUrl:'https://juejin.cn/editor/drafts/new'};
const draftsUrl='https://juejin.cn/editor/drafts';
const editorUrl=loginUrls.entryUrl;
const loginPath=/(?:^|\/)login(?:\/|$)/i;
const userResponsePath=/\/user_api\/v\d+\/user\/(?:get|info)(?:\?|$)/i;
const draftResponsePath=/\/content_api\/v\d+\/article_draft\/(?:create|update|create_offline|update_offline)(?:\?|$)/i;

function resultError(code,message){return {ok:false,code,message};}
function hasSession(session){return Array.isArray(session?.cookies)&&session.cookies.some(c=>/(^|\.)juejin\.cn$/i.test(c.domain||''));}
function isLogin(page){return loginPath.test(new URL(page.url()).pathname);}
function responseIdentity(payload){
  if(!payload||typeof payload!=='object'||(payload.err_no!==undefined&&payload.err_no!==0))return null;
  const values=[payload.data?.user_info,payload.data?.user,payload.data,payload.user_info,payload.user];
  for(const value of values){
    const userId=value?.user_id||value?.userId||value?.uid;
    const name=value?.user_name||value?.userName||value?.name;
    if(userId&&name)return {id:String(userId),name:String(name)};
  }
  return null;
}
async function pageIdentity(page){
  const nav=page.locator('header a[href*="/user/"], nav a[href*="/user/"]').first();
  if(await nav.count()===0)return null;
  const href=await nav.getAttribute('href');
  const userId=href?.match(/\/user\/([A-Za-z0-9_-]+)/)?.[1];
  if(!userId)return null;
  const name=(await nav.getAttribute('title'))||(await nav.getAttribute('aria-label'))||(await nav.locator('img').first().getAttribute('alt').catch(()=>''))||(await nav.innerText().catch(()=>''));
  return name?.trim()?{id:userId,name:name.trim()}:null;
}
async function openSession(session){
  const localBrowsers=path.join(process.cwd(),'.data/local-publishing-browsers');
  if(!process.env.PLAYWRIGHT_BROWSERS_PATH&&fs.existsSync(localBrowsers))process.env.PLAYWRIGHT_BROWSERS_PATH=localBrowsers;
  const executablePath=[process.env.LOCAL_PUBLISHER_BROWSER,chromium.executablePath(),'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>p&&fs.existsSync(p));
  if(!executablePath)throw Object.assign(new Error('本机缺少 Chrome 浏览器'),{code:'BROWSER'});
  const browser=await chromium.launch({headless:true,executablePath});
  try{
    const context=await browser.newContext({storageState:{cookies:session.cookies,origins:session.origins||[]},serviceWorkers:'block',acceptDownloads:false});
    if(session.sessionStorage)await context.addInitScript(data=>{for(const [key,value] of Object.entries(data[location.origin]||{}))sessionStorage.setItem(key,value);},session.sessionStorage);
    await context.route('**/*',route=>{
      const hostname=new URL(route.request().url()).hostname;
      if(/(^|\.)yixiaoer\.cn$/i.test(hostname)||/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[?::|\[?f[cd])/i.test(hostname))return route.abort();
      return route.continue();
    });
    return {browser,page:await context.newPage()};
  }catch(error){await browser.close();throw error;}
}
async function verifySession({session}={}){
  if(!hasSession(session))return resultError('AUTH','掘金账号尚未登录');
  let browser;
  try{
    const opened=await openSession(session);browser=opened.browser;
    const page=opened.page;
    let identity=null;
    page.on('response',async response=>{
      if(!userResponsePath.test(response.url()))return;
      try{identity=responseIdentity(await response.json())||identity;}catch{}
    });
    await page.goto(editorUrl,{waitUntil:'domcontentloaded',timeout:30000});
    if(isLogin(page)||await page.getByText('登录掘金畅享更多权益',{exact:false}).count())return resultError('AUTH','掘金登录状态已失效');
    await page.waitForTimeout(1200);
    identity=identity||await pageIdentity(page);
    return identity?{ok:true,identity}:resultError('AUTH','尚未从掘金页面确认账号身份，请重新登录后验证');
  }catch(error){return resultError(error.code||'PLATFORM',`掘金账号检查失败：${error.message}`);}
  finally{await browser?.close();}
}
async function fillMarkdown(page,markdown){
  const mirror=page.locator('.CodeMirror').first();
  if(await mirror.count()){
    const done=await mirror.evaluate((element,value)=>{
      if(typeof element.CodeMirror?.setValue!=='function')return false;
      element.CodeMirror.setValue(value);element.CodeMirror.focus();return true;
    },markdown);
    if(done)return true;
  }
  const selectors=['.cm-content[contenteditable="true"]','[class*="editor"] [contenteditable="true"]','textarea[placeholder*="正文"]','textarea[placeholder*="Markdown"]','[role="textbox"][contenteditable="true"]'];
  for(const selector of selectors){
    const candidates=page.locator(selector);
    for(let i=0;i<await candidates.count();i++){
      const candidate=candidates.nth(i);
      if(!await candidate.isVisible())continue;
      await candidate.fill(markdown);return true;
    }
  }
  return false;
}
async function fillArticle(page,article){
  const title=page.locator('input[placeholder*="标题"], textarea[placeholder*="标题"]').first();
  if(!await title.count()||!await title.isVisible())return resultError('SELECTOR','掘金编辑器标题输入框已变化，草稿未提交');
  await title.fill(article.title);
  if(!await fillMarkdown(page,article.markdown))return resultError('SELECTOR','掘金 Markdown 编辑区已变化，草稿未提交');
  await title.focus();
  return {ok:true};
}
async function readMarkdown(page){
  const mirror=page.locator('.CodeMirror').first();
  if(await mirror.count()){
    const value=await mirror.evaluate(element=>typeof element.CodeMirror?.getValue==='function'?element.CodeMirror.getValue():null);
    if(value!==null)return value;
  }
  for(const selector of ['.cm-content[contenteditable="true"]','[class*="editor"] [contenteditable="true"]','textarea[placeholder*="正文"]','textarea[placeholder*="Markdown"]','[role="textbox"][contenteditable="true"]']){
    const element=page.locator(selector).first();
    if(!await element.count()||!await element.isVisible())continue;
    return await element.evaluate(node=>('value'in node?node.value:node.innerText));
  }
  return null;
}
async function readDraft(page,title,markdown,savedId){
  if(!savedId)return resultError('NEEDS_REVIEW','掘金未返回草稿编号，需人工核对');
  await page.goto(draftsUrl,{waitUntil:'domcontentloaded',timeout:30000});
  if(isLogin(page))return resultError('AUTH','掘金登录状态已失效，需核对刚才的草稿');
  const link=page.locator(`a[href*="/editor/drafts/${savedId}"]`).filter({hasText:title}).first();
  try{await link.waitFor({state:'visible',timeout:10000});}catch{return resultError('NEEDS_REVIEW','未在掘金草稿箱回读到对应编号的草稿，请手动核对');}
  const href=await link.getAttribute('href');
  const remoteId=href?.match(/\/editor\/drafts\/([A-Za-z0-9_-]+)/)?.[1]||null;
  if(remoteId!==String(savedId))return resultError('NEEDS_REVIEW','草稿编号与草稿箱回读记录不一致，请手动核对');
  const target=new URL(href,page.url());
  if(target.hostname!=='juejin.cn'||!target.pathname.startsWith('/editor/drafts/'))return resultError('NEEDS_REVIEW','草稿详情地址异常，请手动核对');
  await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:30000});
  if(isLogin(page))return resultError('AUTH','掘金登录状态已失效，需核对刚才的草稿');
  const titleInput=page.locator('input[placeholder*="标题"], textarea[placeholder*="标题"]').first();
  try{await titleInput.waitFor({state:'visible',timeout:10000});}catch{return resultError('NEEDS_REVIEW','草稿详情未加载完成，请手动核对');}
  const actualTitle=await titleInput.inputValue();
  const actualMarkdown=await readMarkdown(page);
  const normalized=value=>String(value||'').replace(/\r\n/g,'\n').trim();
  return actualTitle===title&&actualMarkdown!==null&&normalized(actualMarkdown)===normalized(markdown)
    ?{ok:true,remoteId}
    :resultError('NEEDS_REVIEW','草稿详情与提交内容不一致，请手动核对');
}
async function saveDraft({session,article,resolvedAssets}={}){
  if(!hasSession(session))return resultError('AUTH','掘金账号尚未登录');
  if(article?.metadata?.contentType&&article.metadata.contentType!=='article')return resultError('INVALID','掘金适配器当前仅处理文章草稿');
  if(!article?.title?.trim()||!article?.markdown?.trim())return resultError('INVALID','文章标题和 Markdown 正文必填');
  if(/local-asset:[A-Za-z0-9_-]+/.test(`${article.markdown}\n${article.html||''}`)||Object.keys(resolvedAssets||{}).length)return resultError('DEPENDENCY','掘金图片素材上传尚待真实账号验证，请先使用纯文字文章');
  let browser;
  try{
    const opened=await openSession(session);browser=opened.browser;
    const page=opened.page;
    let savedId=null,saveResponses=0;
    page.on('response',async response=>{
      if(!draftResponsePath.test(response.url()))return;
      try{
        const data=await response.json();
        if(response.ok()&&data?.err_no===0){
          const value=data.data?.draft_id||data.data?.article_draft_id||data.data?.id;
          if(value){savedId=String(value);saveResponses++;}
        }
      }catch{}
    });
    await page.goto(editorUrl,{waitUntil:'domcontentloaded',timeout:30000});
    if(isLogin(page)||await page.getByText('登录掘金畅享更多权益',{exact:false}).count())return resultError('AUTH','掘金登录状态已失效');
    const beforeFillResponses=saveResponses;
    const filled=await fillArticle(page,article);if(!filled.ok)return filled;
    for(let i=0;i<15&&(!savedId||saveResponses<=beforeFillResponses);i++)await page.waitForTimeout(1000);
    if(!savedId)return resultError('NEEDS_REVIEW','编辑器未返回草稿编号，请在掘金草稿箱核对，避免重复提交');
    return await readDraft(page,article.title,article.markdown,savedId);
  }catch(error){return resultError(error.code||'PLATFORM',`掘金草稿保存需核对：${error.message}`);}
  finally{await browser?.close();}
}

module.exports={id,name:'掘金',contentTypes:['article'],draftTypes:['article'],loginUrls,verifySession,saveDraft,
  _internal:{responseIdentity,fillArticle,readDraft,readMarkdown,hasSession}};
