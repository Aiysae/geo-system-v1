const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { randomUUID, randomBytes, createCipheriv, createDecipheriv, createHash } = require('node:crypto');

const id = () => randomUUID();
const now = () => Date.now();
const json = value => JSON.stringify(value);
const digest = value => createHash('sha256').update(json(value)).digest('hex');
const {metadata:validateMetadata,typeOf,applyOverride,platformCapability,plainHtml}=require('./vendor/content-rules.cjs');
const terminal = new Set(['published', 'draft', 'failed', 'cancelled', 'rejected']);
function fail(message, code = 'INVALID') { const e = new Error(message); e.code = code; throw e; }
function text(value, max, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${name}为空或过长`);
  return value.trim();
}

class Store {
  constructor(directory,options={}) {
    this.getAsset=options.getAsset;
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keyPath = path.join(directory, 'session.key');
    if (!fs.existsSync(keyPath)) {
      try { fs.writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' }); }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    this.key = fs.readFileSync(keyPath);
    if (this.key.length !== 32) fail('本机会话密钥格式错误', 'STORAGE');
    this.db = new DatabaseSync(path.join(directory, 'publishing.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS accounts(
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, platform TEXT NOT NULL, label TEXT NOT NULL,
        remote_id TEXT NOT NULL DEFAULT '', remote_name TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'needs_login',
        session TEXT, checked_at INTEGER, created_at INTEGER NOT NULL, error TEXT NOT NULL DEFAULT '');
      CREATE UNIQUE INDEX IF NOT EXISTS account_identity ON accounts(owner,platform,remote_id) WHERE remote_id<>'';
      CREATE TABLE IF NOT EXISTS articles(
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, markdown TEXT NOT NULL, html TEXT NOT NULL,
        metadata TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS article_imports(
        owner TEXT NOT NULL, source_key TEXT NOT NULL, source_version TEXT NOT NULL,
        article_id TEXT NOT NULL REFERENCES articles(id), imported_at INTEGER NOT NULL,
        PRIMARY KEY(owner,source_key,source_version));
      CREATE INDEX IF NOT EXISTS article_import_source ON article_imports(owner,source_key);
      CREATE TABLE IF NOT EXISTS assets(
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
        mime_type TEXT NOT NULL, size INTEGER NOT NULL, width INTEGER, height INTEGER,
        file_name TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS asset_owner ON assets(owner,created_at);
      CREATE TABLE IF NOT EXISTS batches(
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
        created_at INTEGER NOT NULL, scheduled_at INTEGER NOT NULL, UNIQUE(owner,request_key));
      CREATE TABLE IF NOT EXISTS batch_drafts(
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS batch_draft_owner ON batch_drafts(owner,updated_at);
      CREATE TABLE IF NOT EXISTS tasks(
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, batch_id TEXT NOT NULL REFERENCES batches(id),
        account_id TEXT NOT NULL REFERENCES accounts(id), article_id TEXT NOT NULL REFERENCES articles(id),
        snapshot TEXT NOT NULL, mode TEXT NOT NULL, state TEXT NOT NULL, phase TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0, audit_attempts INTEGER NOT NULL DEFAULT 0,
        next_run INTEGER NOT NULL, lease_until INTEGER, lease_owner TEXT, remote_id TEXT, remote_url TEXT,
        message TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS task_dispatch ON tasks(state,next_run,created_at);
      CREATE INDEX IF NOT EXISTS task_owner ON tasks(owner,batch_id);
      CREATE TABLE IF NOT EXISTS events(
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, task_id TEXT, kind TEXT NOT NULL,
        message TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(owner TEXT PRIMARY KEY, paused INTEGER NOT NULL DEFAULT 0);
      PRAGMA user_version=1;`);
    if(!this.db.prepare('PRAGMA table_info(accounts)').all().some(column=>column.name==='group_name'))
      this.db.exec("ALTER TABLE accounts ADD COLUMN group_name TEXT NOT NULL DEFAULT ''");
    for(const [table,columns] of Object.entries({
      accounts:{session_version:'INTEGER NOT NULL DEFAULT 0',session_saved_at:'INTEGER',successful_check_at:'INTEGER',cooldown_until:'INTEGER NOT NULL DEFAULT 0',health_code:"TEXT NOT NULL DEFAULT ''"},
      tasks:{interval_ms:'INTEGER NOT NULL DEFAULT 0',daily_limit:'INTEGER NOT NULL DEFAULT 0'},
    })){
      const existing=new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));
      for(const [name,type] of Object.entries(columns))if(!existing.has(name))this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS submissions(
      id INTEGER PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),task_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,interval_ms INTEGER NOT NULL,daily_limit INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS submission_budget ON submissions(account_id,started_at);`);
    fs.chmodSync(path.join(directory, 'publishing.sqlite'), 0o600);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  event(owner, task, kind, message) {
    this.db.prepare('INSERT INTO events(owner,task_id,kind,message,created_at) VALUES(?,?,?,?,?)')
      .run(owner, task || null, kind, String(message).slice(0,400), now());
  }
  seal(value) {
    const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',this.key,iv);
    return Buffer.concat([iv,cipher.update(json(value)),cipher.final(),cipher.getAuthTag()]).toString('base64');
  }
  unseal(value) {
    const b=Buffer.from(value,'base64'), decipher=createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12));
    decipher.setAuthTag(b.subarray(-16));
    return JSON.parse(Buffer.concat([decipher.update(b.subarray(12,-16)),decipher.final()]).toString());
  }
  account(owner, accountId, secrets=false) {
    const a=this.db.prepare('SELECT * FROM accounts WHERE owner=? AND id=?').get(owner,accountId);
    if(!a)fail('账号不存在或无权访问','NOT_FOUND');
    if(secrets)a.session=a.session?this.unseal(a.session):null; else delete a.session;
    return a;
  }
  addAccount(owner, platform, label) {
    if(this.db.prepare('SELECT count(*) n FROM accounts WHERE owner=?').get(owner).n>=100)fail('最多管理 100 个账号');
    const accountId=id();
    this.db.prepare('INSERT INTO accounts(id,owner,platform,label,created_at) VALUES(?,?,?,?,?)').run(accountId,owner,platform,text(label,80,'账号名称'),now());
    return this.account(owner,accountId);
  }
  setAccountGroup(owner,accountId,groupName){
    this.account(owner,accountId);
    const name=String(groupName||'').trim();if(name.length>60)fail('分组名称最多 60 字');
    this.db.prepare('UPDATE accounts SET group_name=? WHERE owner=? AND id=?').run(name,owner,accountId);
    return this.account(owner,accountId);
  }
  saveSession(owner, accountId, session, identity, expectedVersion) {
    const a=this.account(owner,accountId);
    if(expectedVersion!==undefined&&a.session_version!==expectedVersion)fail('登录状态已更新，请重新打开账号窗口','STALE_SESSION');
    if(!identity.id)fail('平台未返回可确认的账号标识','AUTH');
    if(a.remote_id && a.remote_id!==String(identity.id))fail('登录的账号与原账号不一致，请切回原账号或新增账号','AUTH');
    const existing=this.db.prepare('SELECT id FROM accounts WHERE owner=? AND platform=? AND remote_id=? AND id<>?').get(owner,a.platform,String(identity.id),accountId);
    if(existing)fail('这个平台账号已经添加，请使用已有账号','CONFLICT');
    this.transaction(()=>{
      this.db.prepare("UPDATE accounts SET session=?,remote_id=?,remote_name=?,state='ready',checked_at=?,successful_check_at=?,session_saved_at=?,session_version=session_version+1,health_code=CASE WHEN cooldown_until>unixepoch('subsec')*1000 THEN health_code ELSE '' END,error=CASE WHEN cooldown_until>unixepoch('subsec')*1000 THEN error ELSE '' END WHERE owner=? AND id=?")
        .run(this.seal(session),String(identity.id),String(identity.name||a.label).slice(0,120),now(),now(),now(),owner,accountId);
      this.db.prepare("UPDATE tasks SET state='queued',next_run=MAX(next_run,?),message='登录已恢复，等待自动执行',updated_at=? WHERE owner=? AND account_id=? AND state='waiting_login'").run(now(),now(),owner,accountId);
      this.db.prepare("UPDATE tasks SET state='submitted',next_run=?,audit_attempts=0,message='登录恢复，自动核验已提交文章',updated_at=? WHERE owner=? AND account_id=? AND state='audit_pending' AND remote_id IS NOT NULL").run(now(),now(),owner,accountId);
      this.event(owner,null,'login','账号登录状态已保存');
    });
    return this.account(owner,accountId);
  }
  refreshSession(owner,accountId,session,version,verified=false){
    // Compare-and-swap: an old browser/worker must never overwrite reauthorization.
    const result=this.db.prepare(`UPDATE accounts SET session=?,session_version=session_version+1,session_saved_at=?,
      checked_at=CASE WHEN ? THEN ? ELSE checked_at END,successful_check_at=CASE WHEN ? THEN ? ELSE successful_check_at END,
      health_code=CASE WHEN ? AND cooldown_until<=? THEN '' ELSE health_code END,
      error=CASE WHEN ? AND cooldown_until<=? THEN '' ELSE error END
      WHERE owner=? AND id=? AND session_version=? AND state='ready' AND session IS NOT NULL`)
      .run(this.seal(session),now(),+verified,now(),+verified,now(),+verified,now(),+verified,now(),owner,accountId,version);
    return result.changes===1;
  }
  invalidate(owner, accountId, message='账号登录已失效，请重新登录',code='AUTH') {
    this.transaction(()=>{
      this.db.prepare("UPDATE accounts SET state=?,health_code=?,error=?,checked_at=?,session_version=session_version+1 WHERE owner=? AND id=?")
        .run(code==='AUTH'?'needs_login':'needs_verification',code,message,now(),owner,accountId);
      this.db.prepare("UPDATE tasks SET state='waiting_login',message=?,updated_at=? WHERE owner=? AND account_id=? AND state IN ('queued','retry_wait')").run(message,now(),owner,accountId);
      this.db.prepare("UPDATE tasks SET state='audit_pending',message=?,updated_at=? WHERE owner=? AND account_id=? AND state='submitted'").run(message,now(),owner,accountId);
      this.event(owner,null,'account.paused',message);
    });
  }
  deferAccount(owner,accountId,code,message,until){
    this.db.prepare('UPDATE accounts SET cooldown_until=MAX(cooldown_until,?),health_code=?,error=?,checked_at=? WHERE owner=? AND id=?')
      .run(until,code,message,now(),owner,accountId);
    this.db.prepare("UPDATE tasks SET next_run=MAX(next_run,?),message=?,updated_at=? WHERE owner=? AND account_id=? AND state IN ('queued','retry_wait','submitted')").run(until,message,now(),owner,accountId);
  }
  removeAccount(owner, accountId) {
    this.account(owner,accountId);
    if(this.db.prepare('SELECT 1 FROM tasks WHERE owner=? AND account_id=? LIMIT 1').get(owner,accountId))fail('账号已有任务记录，可退出登录并保留记录');
    this.db.prepare('DELETE FROM accounts WHERE owner=? AND id=?').run(owner,accountId);
  }
  logout(owner,accountId) {
    this.account(owner,accountId);
    if(this.db.prepare("SELECT 1 FROM tasks WHERE owner=? AND account_id=? AND state IN ('running','auditing')").get(owner,accountId))fail('该账号正在执行任务，请等待任务结束');
    this.invalidate(owner,accountId,'账号已退出登录');
    this.db.prepare("UPDATE accounts SET session=NULL,session_saved_at=NULL,successful_check_at=NULL,cooldown_until=0 WHERE owner=? AND id=?").run(owner,accountId);
  }
  saveArticle(owner, input) {
    const metadata=validateMetadata(input.metadata||{}),contentType=metadata.contentType;
    const articleId=input.id||id(), title=text(input.title,200,'标题');
    const markdown=contentType==='article'?text(input.markdown,300000,'正文'):String(input.markdown||'');
    const html=contentType==='article'?text(input.html,600000,'排版正文'):String(input.html||plainHtml(markdown));
    if(markdown.length>300000||html.length>600000)fail('内容正文过长');
    if(input.id){
      const existing=this.db.prepare('SELECT metadata FROM articles WHERE owner=? AND id=?').get(owner,articleId);
      if(!existing)fail('文章不存在或无权访问','NOT_FOUND');
      const source=JSON.parse(existing.metadata).source;if(source)metadata.source=source;
    }
    this.db.prepare(`INSERT INTO articles(id,owner,title,markdown,html,metadata,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,markdown=excluded.markdown,html=excluded.html,metadata=excluded.metadata,version=version+1,updated_at=excluded.updated_at`)
      .run(articleId,owner,title,markdown,html,json(metadata),now());
    return this.article(owner,articleId);
  }
  importedArticle(owner,input) {
    const key=text(input.sourceKey||input.source?.id,500,'来源编号');
    const version=text(input.sourceVersion||input.source?.version,128,'来源版本');
    const record=this.db.prepare('SELECT article_id FROM article_imports WHERE owner=? AND source_key=? AND source_version=?').get(owner,key,version);
    return record?{article:this.article(owner,record.article_id),status:'existing',sourceKey:key}:null;
  }
  importArticle(owner,input) {
    const source=validateMetadata({...input.metadata,source:input.source}).source;
    if(!source)fail('导入来源缺失');
    return this.transaction(()=>{
      const existing=this.importedArticle(owner,{source});if(existing)return existing;
      const previous=this.db.prepare('SELECT 1 FROM article_imports WHERE owner=? AND source_key=? LIMIT 1').get(owner,source.id);
      const article=this.saveArticle(owner,{...input,id:undefined,metadata:{...input.metadata,source}});
      this.db.prepare('INSERT INTO article_imports(owner,source_key,source_version,article_id,imported_at) VALUES(?,?,?,?,?)').run(owner,source.id,source.version,article.id,now());
      this.event(owner,null,'article.import','文章已加入分发内容库');
      return {article,status:previous?'new_version':'created',sourceKey:source.id};
    });
  }
  async registerAsset(owner,input) {
    if(!/^[a-f0-9-]{36}$/.test(String(input.uploadId||'')))fail('上传编号无效');
    const kind=String(input.kind||'');
    if(!['image','video','audio'].includes(kind))fail('素材类型无效');
    const incoming=path.join(this.directory,'incoming',createHash('sha256').update(owner).digest('hex').slice(0,20),input.uploadId);
    const stat=fs.statSync(incoming);
    const limit=kind==='image'?12*1024*1024:kind==='video'?250*1024*1024:100*1024*1024;
    if(!stat.isFile()||!stat.size||stat.size>limit)fail('素材为空或超出大小限制');
    const head=Buffer.alloc(16);const handle=fs.openSync(incoming,'r');try{fs.readSync(handle,head,0,16,0);}finally{fs.closeSync(handle);}
    const name=text(input.name,120,'文件名').replace(/[\\/:*?"<>|\x00-\x1f]/g,'-');
    let mimeType='',extension='',width=null,height=null,buffer=null;
    if(kind==='image'){
      const meta=await sharp(incoming,{limitInputPixels:40000000,failOn:'warning'}).metadata();
      if(!['jpeg','png','webp'].includes(meta.format))fail('仅支持 JPG、PNG 和 WebP 图片');
      const transparent=!!meta.hasAlpha;
      buffer=await sharp(incoming,{limitInputPixels:40000000,failOn:'warning'}).rotate()
        .resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true})
        [transparent?'png':'jpeg'](transparent?{compressionLevel:8}:{quality:88}).toBuffer();
      if(buffer.length>8*1024*1024)fail('图片处理后仍超过 8MB');
      mimeType=transparent?'image/png':'image/jpeg';extension=transparent?'png':'jpg';
      const info=await sharp(buffer).metadata();width=info.width;height=info.height;
    }else if(kind==='video'&&head.subarray(4,8).toString()==='ftyp'){
      mimeType='video/mp4';extension='mp4';
    }else if(kind==='audio'&&head.subarray(0,4).toString()==='RIFF'&&head.subarray(8,12).toString()==='WAVE'){
      mimeType='audio/wav';extension='wav';
    }else if(kind==='audio'&&head.subarray(4,8).toString()==='ftyp'){
      mimeType='audio/mp4';extension='m4a';
    }else if(kind==='audio'&&(head.subarray(0,3).toString()==='ID3'||head[0]===0xff&&(head[1]&0xe0)===0xe0)){
      mimeType='audio/mpeg';extension='mp3';
    }else fail('素材文件格式与类型不匹配；视频使用 MP4，音频使用 MP3/WAV/M4A');
    const assetId=`lpa_${id().replace(/-/g,'')}`,fileName=`${assetId}.${extension}`;
    const assetDir=path.join(this.directory,'assets');fs.mkdirSync(assetDir,{recursive:true,mode:0o700});
    const target=path.join(assetDir,fileName);
    if(buffer){fs.writeFileSync(target,buffer,{flag:'wx',mode:0o600});fs.rmSync(incoming,{force:true});}
    else fs.renameSync(incoming,target);
    try{this.db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?)').run(assetId,owner,kind,name,mimeType,buffer?.length||stat.size,width,height,fileName,now());}
    catch(e){fs.rmSync(target,{force:true});throw e;}
    return this.asset(owner,assetId,false);
  }
  asset(owner,assetId,internal=true){
    const a=this.db.prepare('SELECT * FROM assets WHERE owner=? AND id=?').get(owner,assetId);
    if(!a)fail('素材不存在或无权访问','NOT_FOUND');
    if(internal){a.pathOrUrl=path.join(this.directory,'assets',a.file_name);if(!fs.existsSync(a.pathOrUrl))fail('素材文件已丢失','STORAGE');}
    delete a.file_name;return a;
  }
  assets(owner){return this.db.prepare('SELECT id,kind,name,mime_type,size,width,height,created_at FROM assets WHERE owner=? ORDER BY created_at DESC LIMIT 500').all(owner);}
  article(owner,articleId) {
    const a=this.db.prepare('SELECT * FROM articles WHERE owner=? AND id=?').get(owner,articleId);
    if(!a)fail('文章不存在或无权访问','NOT_FOUND');
    a.metadata=JSON.parse(a.metadata);return a;
  }
  inspectPair(owner,account,article,mode) {
    const contentType=typeOf(article),errors=[],warnings=[];
    const issue=(code,message)=>({accountId:account.id,contentId:article.id,code,message});
    const capability=platformCapability(account.platform);
    if(!capability?.contentTypes.includes(contentType))errors.push(issue('CONTENT_UNSUPPORTED',`该平台未接入${({article:'文章',video:'视频',imageText:'图文',audio:'音频',wechat:'公众号内容包'})[contentType]||'此类型'}分发`));
    if(mode==='publish'&&capability?.draftOnly)errors.push(issue('PUBLISH_UNVERIFIED','该平台暂只开放草稿试存，正式发布需完成实号验收'));
    if(mode==='draft'&&!capability?.draftTypes.includes(contentType))errors.push(issue('DRAFT_UNVERIFIED','该平台此内容类型的原生草稿尚未验证，已阻止提交；可保存在本机素材库'));
    if(account.platform==='DEMO_CSDN'&&contentType!=='article'&&mode==='publish')errors.push(issue('DEMO_DRAFT_ONLY','本机多媒体演示只模拟草稿，不执行正式发布'));
    if(account.state!=='ready')warnings.push(issue('LOGIN_REQUIRED','账号尚未登录，支持的任务将等待登录完成'));
    if(account.platform!=='DEMO_CSDN'&&!(account.platform==='CSDN'&&contentType==='article'))warnings.push(issue('PLATFORM_UNVERIFIED','适配代码已接入，真实平台仍待逐一验证'));
    const m=article.metadata||{},assets=[];
    if(account.platform==='CtripNotes'&&contentType==='imageText'){
      const titleLength=[...String(article.title||'').trim()].length;
      if(titleLength<5||titleLength>30)errors.push(issue('CTRIP_TITLE','携程笔记标题需为 5–30 字'));
      if(!String(article.markdown||'').trim()||String(article.markdown||'').length>3000)errors.push(issue('CTRIP_DESCRIPTION','携程笔记描述必填且不得超过 3000 字'));
      if((m.assetIds||[]).length>20)errors.push(issue('CTRIP_IMAGES','携程笔记最多上传 20 张图片'));
    }
    if(account.platform==='Juejin'&&(m.assetIds||[]).length)errors.push(issue('JUEJIN_UPLOAD','掘金图片上传尚未验证；当前仅支持纯文字文章草稿'));
    const resolve=(id,expected)=>{
      if(!this.getAsset){errors.push(issue('ASSET_UNAVAILABLE','素材服务未就绪'));return null;}
      try{const asset=this.getAsset(owner,id);if(!asset)throw Error();const kind=asset.kind||asset.type||String(asset.mimeType||asset.mime||'').split('/')[0];
        if(expected&&kind!==expected){errors.push(issue('ASSET_TYPE',`请选择${expected==='image'?'图片':expected==='video'?'视频':'音频'}素材`));return null;}return asset;
      }catch{errors.push(issue('ASSET_NOT_FOUND','素材不存在或无权访问，请重新选择'));return null;}
    };
    const embedded=[...new Set([article.html,...(m.entries||[]).map(e=>e.html||'')].flatMap(html=>[...String(html||'').matchAll(/local-asset:([a-zA-Z0-9_-]+)/g)].map(match=>match[1])))];
    for(const id of embedded)resolve(id,'image');
    if(embedded.length&&account.platform!=='DEMO_CSDN')errors.push(issue('INLINE_UPLOAD_UNVERIFIED','该平台正文内嵌本机图片的转存尚未验证，请先移除正文图片或使用平台公开图片地址'));
    for(const id of m.assetIds||[])assets.push(resolve(id,contentType==='imageText'?'image':contentType==='video'?'video':contentType==='audio'?'audio':null));
    if(m.coverAssetId)resolve(m.coverAssetId,'image');
    if(['video','audio'].includes(contentType)&&(m.assetIds||[]).length!==1)errors.push(issue('MEDIA_REQUIRED',`每条${contentType==='video'?'视频':'音频'}内容请选择一个对应文件`));
    if(contentType==='video'&&!m.coverAssetId&&!m.coverUrl)errors.push(issue('COVER_REQUIRED','视频分发需要选择封面'));
    if(contentType==='imageText'&&!(m.assetIds||[]).length)errors.push(issue('IMAGES_REQUIRED','图文内容至少需要一张图片'));
    if(contentType==='imageText'&&(m.assetIds||[]).length>9&&account.platform!=='CtripNotes')warnings.push(issue('IMAGE_LIMIT','图片超过 9 张，请核对目标平台张数限制'));
    if(contentType==='audio'){
      if(account.platform!=='DEMO_CSDN'&&!m.platformOptions?.[account.platform]?.album)errors.push(issue('ALBUM_REQUIRED','请在该账号的平台设置中选择专辑或播客 album'));
      if(!m.coverAssetId&&!m.coverUrl)warnings.push(issue('COVER_RECOMMENDED','建议为音频选择封面，并核对平台要求'));
    }
    if(contentType==='wechat'){
      if(!(m.entries||[]).length)errors.push(issue('ENTRIES_REQUIRED','公众号内容包至少需要一篇文章'));
      for(const entry of m.entries||[]){if(!entry.coverAssetId)errors.push(issue('ENTRY_COVER_REQUIRED',`公众号文章“${entry.title}”需要封面`));else resolve(entry.coverAssetId,'image');}
    }
    return {accountId:account.id,contentId:article.id,contentType,eligible:errors.length===0,errors,warnings};
  }
  preflightBatch(owner,input) {
    const accountIds=[...new Set(input.accountIds||[])],articleIds=[...new Set(input.articleIds||input.contentIds||[])];
    const errors=[],warnings=[],pairs=[];
    if(!accountIds.length||!articleIds.length||accountIds.length*articleIds.length>200)errors.push({code:'SELECTION',message:'请选择账号与内容，每批最多 200 个任务'});
    if(!['draft','publish'].includes(input.mode))errors.push({code:'MODE',message:'分发模式无效'});
    const scheduledAt=input.scheduledAt?Number(input.scheduledAt):now();
    if(!Number.isFinite(scheduledAt)||scheduledAt>now()+90*86400000)errors.push({code:'SCHEDULE',message:'定时时间需在未来 90 天内'});
    const intervalMinutes=Number(input.intervalMinutes||0),dailyLimit=Number(input.dailyLimit||0);
    if(!Number.isInteger(intervalMinutes)||intervalMinutes<0||intervalMinutes>1440)errors.push({code:'INTERVAL',message:'间隔分钟数需为 0–1440 的整数'});
    if(!Number.isInteger(dailyLimit)||dailyLimit<0||dailyLimit>100)errors.push({code:'DAILY_LIMIT',message:'每日每账号数量需为 1–100，或留空不限制'});
    if(dailyLimit>0&&intervalMinutes*(dailyLimit-1)>=1440)errors.push({code:'SCHEDULE_SPAN',message:'当前每日数量和任务间隔超过一天，请缩短间隔或降低每日数量'});
    if(errors.length)return {ok:false,errors,warnings,eligible:[],pairs};
    for(const accountId of accountIds)for(const articleId of articleIds){
      try{
        const account=this.account(owner,accountId),article=applyOverride(this.article(owner,articleId),input.overrides?.[accountId]?.[articleId]);
        const pair=this.inspectPair(owner,account,article,input.mode);pairs.push(pair);errors.push(...pair.errors);warnings.push(...pair.warnings);
      }catch(e){const issue={accountId,contentId:articleId,code:e.code||'INVALID',message:e.message};errors.push(issue);pairs.push({accountId,contentId:articleId,eligible:false,errors:[issue],warnings:[]});}
    }
    return {ok:errors.length===0,errors,warnings,eligible:pairs.filter(p=>p.eligible).map(({accountId,contentId,contentType})=>({accountId,contentId,contentType})),pairs};
  }
  createBatch(owner,input) {
    const requestKey=text(input.requestKey,100,'请求编号');
    const accountIds=[...new Set(input.accountIds||[])],articleIds=[...new Set(input.articleIds||input.contentIds||[])];
    const scheduledAt=input.scheduledAt?Number(input.scheduledAt):now();
    const fingerprint=digest({accountIds:[...accountIds].sort(),articleIds:[...articleIds].sort(),mode:input.mode,scheduledAt:input.scheduledAt||null,intervalMinutes:input.intervalMinutes||0,dailyLimit:input.dailyLimit||0,overrides:input.overrides||null});
    return this.transaction(()=>{
      const existing=this.db.prepare('SELECT * FROM batches WHERE owner=? AND request_key=?').get(owner,requestKey);
      if(existing){if(existing.fingerprint!==fingerprint)fail('同一请求编号对应不同内容','CONFLICT');return {id:existing.id,reused:true};}
      const preflight=this.preflightBatch(owner,input);
      if(!preflight.ok){const e=new Error(preflight.errors[0].message);e.code='PREFLIGHT';e.preflight=preflight;throw e;}
      const accounts=accountIds.map(a=>this.account(owner,a));
      const articles=articleIds.map(a=>this.article(owner,a));
      const batchId=id(), created=now();
      this.db.prepare('INSERT INTO batches VALUES(?,?,?,?,?,?)').run(batchId,owner,requestKey,fingerprint,created,scheduledAt);
      const insert=this.db.prepare('INSERT INTO tasks(id,owner,batch_id,account_id,article_id,snapshot,mode,state,next_run,created_at,updated_at,interval_ms,daily_limit) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for(const a of accounts)for(const [index,article] of articles.entries()){
        const taskId=id(),snapshot=applyOverride(article,input.overrides?.[a.id]?.[article.id]);
        const dailyLimit=Number(input.dailyLimit)||0,interval=Number(input.intervalMinutes)||0;
        const runAt=scheduledAt+(dailyLimit?Math.floor(index/dailyLimit)*86400000:0)+(dailyLimit?index%dailyLimit:index)*interval*60000;
        insert.run(taskId,owner,batchId,a.id,article.id,json(snapshot),input.mode,a.state==='ready'?'queued':'waiting_login',runAt,created,created,interval*60000,dailyLimit);
        this.event(owner,taskId,'created',a.state==='ready'?'任务已入队':'等待账号登录；完成后自动继续');
      }
      return {id:batchId,reused:false,count:accounts.length*articles.length};
    });
  }
  saveBatchDraft(owner,input){
    const name=text(input.name,100,'方案名称');
    const accountIds=[...new Set(input.accountIds||[])],articleIds=[...new Set(input.articleIds||[])];
    if(accountIds.length*articleIds.length>200)fail('每个方案最多 200 个分发组合');
    accountIds.forEach(id=>this.account(owner,id));articleIds.forEach(id=>this.article(owner,id));
    const payload={accountIds,articleIds,mode:'draft',scheduledAt:input.scheduledAt||null,intervalMinutes:input.intervalMinutes||0,dailyLimit:input.dailyLimit||0,overrides:input.overrides||{}};
    if(json(payload).length>100000)fail('分发方案过长');
    const draftId=input.id||id();
    if(input.id&&!this.db.prepare('SELECT id FROM batch_drafts WHERE owner=? AND id=?').get(owner,draftId))fail('方案不存在或无权访问','NOT_FOUND');
    this.db.prepare(`INSERT INTO batch_drafts(id,owner,name,payload,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,payload=excluded.payload,updated_at=excluded.updated_at`)
      .run(draftId,owner,name,json(payload),now());
    return {id:draftId,name,payload};
  }
  deleteBatchDraft(owner,draftId){
    const result=this.db.prepare('DELETE FROM batch_drafts WHERE owner=? AND id=?').run(owner,draftId);
    if(!result.changes)fail('方案不存在或无权访问','NOT_FOUND');
    return {ok:true};
  }
  task(owner,taskId) {
    const t=this.db.prepare('SELECT * FROM tasks WHERE owner=? AND id=?').get(owner,taskId);
    if(!t)fail('任务不存在或无权访问','NOT_FOUND');
    t.snapshot=JSON.parse(t.snapshot);return t;
  }
  isAccountBusy(accountId) { return !!this.db.prepare("SELECT id FROM tasks WHERE account_id=? AND state IN ('running','auditing') AND lease_until>?").get(accountId,now()); }
  recover(expiredAt=now()) {
    this.transaction(()=>{
      const expired=this.db.prepare("SELECT * FROM tasks WHERE state IN ('running','auditing') AND lease_until<?").all(expiredAt);
      for(const t of expired){
        const uncertain=t.state==='running'&&t.phase==='submitting';
        const state=t.state==='auditing'?'submitted':uncertain?'needs_review':'queued';
        const message=uncertain?'执行中断，提交结果待核对；确认前不会重复发送':'执行器已恢复，任务将自动继续';
        this.db.prepare('UPDATE tasks SET state=?,lease_until=NULL,lease_owner=NULL,next_run=?,message=?,updated_at=? WHERE id=?').run(state,now(),message,now(),t.id);
        this.event(t.owner,t.id,'recovered',message);
      }
    });
  }
  claim(workerId, excludedAccounts=[],leaseMs=90000) {
    return this.transaction(()=>{
      if(this.db.prepare("SELECT count(*) n FROM tasks WHERE state IN ('running','auditing') AND lease_until>?").get(now()).n>=5)return null;
      const candidates=this.db.prepare(`SELECT t.* FROM tasks t JOIN accounts a ON a.id=t.account_id
        LEFT JOIN settings s ON s.owner=t.owner WHERE t.state IN ('queued','retry_wait','submitted') AND t.next_run<=?
        AND a.state='ready' AND a.cooldown_until<=? AND COALESCE(s.paused,0)=0 AND NOT EXISTS(SELECT 1 FROM tasks busy WHERE busy.account_id=t.account_id AND busy.state IN ('running','auditing') AND busy.lease_until>?)
        ORDER BY t.next_run,t.created_at`).all(now(),now(),now());
      const t=candidates.find(candidate=>{
        if(excludedAccounts.includes(candidate.account_id))return false;
        if(candidate.state==='submitted')return true;
        const budget=this.submissionBudget(candidate);
        if(budget.next<=now())return true;
        this.db.prepare("UPDATE tasks SET next_run=?,message='同账号跨批次间隔 / 24 小时额度等待中' WHERE id=?").run(budget.next,candidate.id);return false;
      });if(!t)return null;
      const audit=t.state==='submitted';
      this.db.prepare("UPDATE tasks SET state=?,phase=?,attempts=attempts+?,audit_attempts=audit_attempts+?,lease_owner=?,lease_until=?,updated_at=? WHERE id=?")
        .run(audit?'auditing':'running',audit?'audit':'preparing',audit?0:1,audit?1:0,workerId,now()+leaseMs,now(),t.id);
      return this.task(t.owner,t.id);
    });
  }
  submissionBudget(t){
    const a=this.account(t.owner,t.account_id);
    const recent=this.db.prepare('SELECT * FROM submissions WHERE account_id=? AND started_at>? ORDER BY started_at DESC').all(a.id,now()-86400000);
    const pending=this.db.prepare("SELECT interval_ms,daily_limit FROM tasks WHERE account_id=? AND state IN ('queued','retry_wait','waiting_login','running')").all(a.id);
    const policies=[t,...pending,...recent];
    const interval=Math.max(a.platform==='DEMO_CSDN'?0:60000,...policies.map(p=>p.interval_ms||0));
    const caps=policies.map(p=>p.daily_limit).filter(n=>n>0),limit=caps.length?Math.min(...caps):0;
    return {interval,limit,next:Math.max(a.cooldown_until,recent.length?recent[0].started_at+interval:0,limit&&recent.length>=limit?recent[limit-1].started_at+86400000:0)};
  }
  beginSubmission(t){
    return this.transaction(()=>{
      const current=this.task(t.owner,t.id),a=this.account(t.owner,t.account_id);
      if(current.lease_owner!==t.lease_owner||current.state!=='running'||current.phase==='submitting')return false;
      if(a.state!=='ready'){
        this.updateClaim(t,{state:'waiting_login',message:'账号已暂停，等待登录或平台验证',lease_until:null,lease_owner:null});return false;
      }
      const budget=this.submissionBudget(t);
      if(budget.next>now()){
        this.updateClaim(t,{state:'retry_wait',next_run:budget.next,message:'等待账号跨批次间隔 / 24 小时额度',lease_until:null,lease_owner:null});return false;
      }
      if(!this.updateClaim(t,{phase:'submitting',message:'正在提交平台内容'}))return false;
      this.db.prepare('INSERT INTO submissions(account_id,task_id,started_at,interval_ms,daily_limit) VALUES(?,?,?,?,?)').run(a.id,t.id,now(),budget.interval,budget.limit);
      return true;
    });
  }
  updateClaim(t, patch) {
    const keys=Object.keys(patch),allowed=new Set(['state','phase','next_run','lease_until','lease_owner','remote_id','remote_url','message']);
    if(keys.some(k=>!allowed.has(k)))throw Error('Unexpected task field');
    const values=keys.map(k=>patch[k]);
    const result=this.db.prepare(`UPDATE tasks SET ${keys.map(k=>`${k}=?`).join(',')},updated_at=? WHERE id=? AND owner=? AND lease_owner=?`).run(...values,now(),t.id,t.owner,t.lease_owner);
    return result.changes===1;
  }
  finish(t,state,message,extras={}) {
    this.transaction(()=>{
      if(this.updateClaim(t,{...extras,state,message,lease_until:null,lease_owner:null}))this.event(t.owner,t.id,state,message);
    });
  }
  pause(owner,paused) { this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET paused=excluded.paused').run(owner,paused?1:0); }
  taskAction(owner,taskId,action,input={}) {
    const t=this.task(owner,taskId);
    if(['running','auditing'].includes(t.state))fail('任务正在执行，可暂停队列等待本次提交结束');
    if(action==='cancel'){
      if(!['queued','retry_wait','waiting_login'].includes(t.state))fail('当前任务已提交或已结束');
      this.db.prepare("UPDATE tasks SET state='cancelled',message='用户取消',updated_at=? WHERE id=?").run(now(),taskId);
    }else if(action==='retry'){
      if(!['failed','needs_review','rejected','blocked'].includes(t.state))fail('当前状态无需重新提交');
      if(t.state==='needs_review'&&input.confirmedNotPublished!==true)fail('请先核对平台，并确认这篇文章尚未发布');
      this.db.prepare("UPDATE tasks SET state='queued',phase='queued',next_run=?,remote_id=NULL,message='等待重试',attempts=0,updated_at=? WHERE id=?").run(now(),now(),taskId);
    }else if(action==='reconcile'){
      if(!['needs_review','submitted','audit_pending'].includes(t.state))fail('当前状态无需核对');
      const remoteId=text(input.remoteId,200,'平台文章编号');
      this.db.prepare("UPDATE tasks SET state='submitted',remote_id=?,next_run=?,audit_attempts=0,message='已记录平台编号，等待核验',updated_at=? WHERE id=?").run(remoteId,now(),now(),taskId);
    }else fail('操作无效');
    this.event(owner,taskId,action,action==='retry'?'用户要求重新提交':action==='cancel'?'用户取消等待任务':'用户补充平台编号以核验结果');
  }
  snapshot(owner) {
    const accounts=this.db.prepare('SELECT id,platform,label,remote_id,remote_name,state,checked_at,created_at,error,group_name,session_saved_at,successful_check_at,cooldown_until,health_code FROM accounts WHERE owner=? ORDER BY created_at DESC').all(owner).map(a=>({...a,cooling_down:a.cooldown_until>now()}));
    const articles=this.db.prepare('SELECT id,title,version,updated_at,metadata FROM articles WHERE owner=? ORDER BY updated_at DESC LIMIT 500').all(owner).map(a=>({...a,metadata:JSON.parse(a.metadata),contentType:JSON.parse(a.metadata).contentType||'article'}));
    const tasks=this.db.prepare(`SELECT t.id,t.batch_id,t.account_id,t.article_id,t.mode,t.state,t.phase,t.attempts,t.audit_attempts,t.next_run,t.remote_id,t.message,t.created_at,t.updated_at,
      a.label account_name,a.platform, json_extract(t.snapshot,'$.title') title, COALESCE(json_extract(t.snapshot,'$.metadata.contentType'),'article') content_type FROM tasks t JOIN accounts a ON a.id=t.account_id WHERE t.owner=? ORDER BY t.created_at DESC,t.id LIMIT 500`).all(owner);
    const events=this.db.prepare('SELECT sequence,task_id,kind,message,created_at FROM events WHERE owner=? ORDER BY sequence DESC LIMIT 100').all(owner);
    const drafts=this.db.prepare('SELECT id,name,payload,updated_at FROM batch_drafts WHERE owner=? ORDER BY updated_at DESC LIMIT 100').all(owner).map(d=>({...d,payload:JSON.parse(d.payload)}));
    return {accounts,articles,assets:this.assets(owner),drafts,tasks,events,paused:!!this.db.prepare('SELECT paused FROM settings WHERE owner=?').get(owner)?.paused,counts:{total:tasks.length,done:tasks.filter(t=>terminal.has(t.state)).length}};
  }
  close(){this.db.close();}
}
module.exports={Store,fail,text,terminal};
