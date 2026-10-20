// Local platform simulator. The unmodified CSDN adapter is exercised against
// this loopback server; these results say nothing about the live CSDN service.
const http=require('node:http');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {randomBytes}=require('node:crypto');
class DemoPlatform{
  constructor(directory){
    this.db=new DatabaseSync(path.join(directory,'demo-platform.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,username TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL,title TEXT,content TEXT,status TEXT,task TEXT);
      CREATE TABLE IF NOT EXISTS faults(username TEXT PRIMARY KEY,quota_until INTEGER DEFAULT 0,drop_response INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS calls(id INTEGER PRIMARY KEY,username TEXT,path TEXT,task TEXT);`);
    if(!this.db.prepare('PRAGMA table_info(posts)').all().some(column=>column.name==='content_type'))
      this.db.exec("ALTER TABLE posts ADD COLUMN content_type TEXT NOT NULL DEFAULT 'article'");
  }
  async start(){
    this.server=http.createServer((req,res)=>void this.handle(req,res).catch(()=>{if(!res.destroyed){res.writeHead(500);res.end('fixture error');}}));
    await new Promise(r=>this.server.listen(0,'127.0.0.1',r));this.url=`http://127.0.0.1:${this.server.address().port}`;return this;
  }
  fault(username,kind){
    if(kind==='expire')this.db.prepare('DELETE FROM sessions WHERE username=?').run(username);
    else if(kind==='quota')this.db.prepare('INSERT INTO faults(username,quota_until) VALUES(?,?) ON CONFLICT(username) DO UPDATE SET quota_until=excluded.quota_until').run(username,Date.now()+12000);
    else if(kind==='drop')this.db.prepare('INSERT INTO faults(username,drop_response) VALUES(?,1) ON CONFLICT(username) DO UPDATE SET drop_response=1').run(username);
    else if(kind==='restore')this.db.prepare('DELETE FROM faults WHERE username=?').run(username);
    else throw Error('演示故障类型无效');
  }
  stats(username){return this.db.prepare('SELECT id,title,status,task,content_type FROM posts WHERE username=? ORDER BY id DESC').all(username);}
  saveMedia(username,task,contentType,assetIds){
    const result=this.db.prepare('INSERT INTO posts(username,title,content,status,task,content_type) VALUES(?,?,?,?,?,?)')
      .run(username,task.snapshot.title,JSON.stringify({assetIds,metadata:task.snapshot.metadata,markdown:task.snapshot.markdown}),
        '2',task.id,contentType);
    return {id:Number(result.lastInsertRowid)};
  }
  async handle(req,res){
    const u=new URL(req.url,'http://local'),token=/(?:^|;\s*)SESSION=([^;]+)/.exec(req.headers.cookie||'')?.[1];
    const username=this.db.prepare('SELECT username FROM sessions WHERE token=?').get(token||'')?.username;
    const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    let body='';for await(const c of req){body+=c;if(body.length>1000000)return json({msg:'too large'},413);}
    if(u.pathname==='/demo/login'&&req.method==='POST'){
      const data=JSON.parse(body);if(!/^[a-zA-Z0-9_-]{2,40}$/.test(data.username)||data.password!=='demo1234')return json({msg:'演示账号为 2–40 位字母、数字；密码 demo1234'},401);
      const t=randomBytes(24).toString('hex');this.db.prepare('INSERT INTO sessions VALUES(?,?)').run(t,data.username);
      res.setHeader('Set-Cookie',`SESSION=${t}; Domain=.csdn.net; Path=/; Secure; HttpOnly; SameSite=Lax`);return json({ok:true});
    }
    const profile=u.pathname==='/blog-console-api/v1/user/info';
    if(profile||u.pathname.includes('/risk/check')||u.pathname.includes('/saveArticle')||u.pathname.endsWith('/article/list')){
      if(!username)return json({code:401,msg:'登录已过期'},401);
      const fault=this.db.prepare('SELECT * FROM faults WHERE username=?').get(username);
      this.db.prepare('INSERT INTO calls(username,path,task) VALUES(?,?,?)').run(username,u.pathname,req.headers['x-shitu-task-id']||'');
      if(fault?.quota_until>Date.now())return json({code:429,msg:'演示限流，请稍后重试'},429);
      if(profile)return json({code:200,data:{username,nickname:`演示 ${username}`,avatar:''}});
      if(u.pathname.includes('/risk/check'))return json({code:200});
      if(u.pathname.endsWith('/article/list'))return json({code:200,data:{list:this.stats(username).map(p=>({articleId:p.id,title:p.title,status:p.status,username,coverImage:[]}))}});
      const data=JSON.parse(body),status=data.status===2?'2':'64';let articleId=Number(data.article_id)||0;
      if(articleId){const r=this.db.prepare('UPDATE posts SET title=?,content=?,status=? WHERE id=? AND username=?').run(data.title,data.content,status,articleId,username);if(!r.changes)return json({code:404,msg:'article missing'},404);}
      else articleId=Number(this.db.prepare('INSERT INTO posts(username,title,content,status,task) VALUES(?,?,?,?,?)').run(username,data.title,data.content,status,req.headers['x-shitu-task-id']||'').lastInsertRowid);
      if(status==='64'&&fault?.drop_response){req.socket.destroy();return;}
      return json({code:200,data:{article_id:articleId}});
    }
    if(req.method!=='GET')return json({code:404,msg:'演示接口未实现'},404);
    res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font:20px system-ui;background:#eef3fa;padding:50px}main{background:white;padding:36px;border-radius:20px;width:520px}input,button{display:block;font:20px system-ui;margin:14px 0;padding:12px;width:430px}button{background:#1766dd;color:white;border:0;border-radius:8px}small{color:#667}</style><main><h1>势途本地演示平台</h1><p>测试隔离账号登录和文章分发</p><form id="login"><label>演示账号<input id="username" autocomplete="username" placeholder="例如 demo-a"></label><label>演示密码<input id="password" type="password" autocomplete="current-password" placeholder="demo1234"></label><button>登录演示账号</button></form><p id="status"></p><small>只写入本机演示数据库，不连接真实平台。</small></main><script>const statusEl=document.querySelector('#status');async function profile(){let r=await fetch('/blog-console-api/v1/user/info');let d=await r.json();if(r.ok){statusEl.textContent='已登录：'+d.data.nickname;document.querySelector('form').hidden=true;}}document.querySelector('form').onsubmit=async e=>{e.preventDefault();let r=await fetch('/demo/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.querySelector('#username').value,password:document.querySelector('#password').value})});let d=await r.json();if(r.ok)await profile();else statusEl.textContent=d.msg;};profile();</script></html>`);
  }
  async close(){await new Promise(r=>this.server.close(r));this.db.close();}
}
module.exports={DemoPlatform};
