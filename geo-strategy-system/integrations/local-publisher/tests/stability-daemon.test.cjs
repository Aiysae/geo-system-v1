const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {Store}=require('../store.cjs'),{DemoPlatform}=require('../demo.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=30000){const end=Date.now()+ms;while(Date.now()<end){const result=await fn();if(result)return result;await wait(200);}throw Error('等待超时');}
test('independent executor: rotated login, account-wide 403/429, restart and network recovery; drafts only',{timeout:100000},async t=>{
 const dir=fs.mkdtempSync('/tmp/geo-stab-'),socket=path.join(dir,'publisher.sock'),store=new Store(dir),demo=new DemoPlatform(dir);
 const owner='stability',a=store.addAccount(owner,'DEMO_CSDN','稳定性演示'),other=store.addAccount(owner,'DEMO_CSDN','独立账号');
 function login(account){const token='fixture-'+Math.random();demo.db.prepare('INSERT INTO sessions VALUES(?,?)').run(token,account.id);store.saveSession(owner,account.id,{cookies:[{name:'SESSION',value:token,domain:'.csdn.net',path:'/',secure:true,httpOnly:true,sameSite:'Lax',expires:-1}],origins:[]},{id:account.id});}
 login(a);login(other);let child;
 async function stop(signal='SIGTERM'){if(!child||child.exitCode!==null||child.signalCode)return;const exited=once(child,'exit');child.kill(signal);await exited;}
 t.after(async()=>{await stop();store.close();demo.db.close();fs.rmSync(dir,{recursive:true,force:true});});
 function call(action,input={}){return new Promise((resolve,reject)=>{const req=http.request({socketPath:socket,path:action?'/command':'/health',method:action?'POST':'GET'},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>{const m=JSON.parse(body);m.ok?resolve(m.data||true):reject(Error(m.error));});});req.on('error',reject);req.end(action?JSON.stringify({owner,action,input}):undefined);});}
 async function start(){child=spawn(process.execPath,[path.join(__dirname,'../daemon.cjs')],{env:{PATH:process.env.PATH,HOME:process.env.HOME,LOCAL_PUBLISHER_DATA_DIR:dir,LOCAL_PUBLISHER_SOCKET:socket},stdio:'ignore'});await until(()=>call().catch(()=>false));}
 let seq=0;
 async function batch(account=a){const article=await call('article.save',{title:'隔离草稿 '+(++seq),markdown:'只用于本地演示验证',html:'<p>只用于本地演示验证</p>'});const b=await call('batch.create',{accountIds:[account.id],articleIds:[article.id],mode:'draft',requestKey:'stability-'+seq});return store.snapshot(owner).tasks.find(t=>t.batch_id===b.id).id;}
 const task=id=>store.task(owner,id),finished=id=>until(()=>task(id).state==='draft');
 await start();assert.equal(fs.statSync(socket).mode&0o777,0o600);
 // Each call is a separate short-lived web connection. Its closure never stops the daemon.
 await call('demo.fault',{id:a.id,kind:'rotate'});const first=await batch();await finished(first);assert.equal(store.account(owner,a.id).state,'ready');
 await call('demo.fault',{id:a.id,kind:'challenge'});const challenged=await batch();await until(()=>task(challenged).state==='waiting_login');const waiting=await batch();assert.equal(task(waiting).state,'waiting_login');
 assert.equal(store.account(owner,a.id).state,'needs_verification');
 const unaffected=await batch(other);await finished(unaffected);
 const before=demo.db.prepare('SELECT count(*) n FROM calls WHERE username=?').get(a.id).n;await wait(1800);assert.equal(demo.db.prepare('SELECT count(*) n FROM calls WHERE username=?').get(a.id).n,before);
 await call('demo.fault',{id:a.id,kind:'restore'});login(a);await finished(challenged);await finished(waiting);
 await call('demo.fault',{id:a.id,kind:'quota'});const limited=await batch();await until(()=>task(limited).state==='retry_wait');const queued=await batch();
 const cooldown=store.account(owner,a.id).cooldown_until;assert.ok(cooldown>Date.now());await stop('SIGKILL');await start();assert.equal(store.account(owner,a.id).cooldown_until,cooldown);assert.notEqual(task(limited).state,'draft');
 await finished(limited);await finished(queued);
 await call('demo.fault',{id:a.id,kind:'offline'});const offline=await batch();await until(()=>task(offline).state==='retry_wait');await call('demo.fault',{id:a.id,kind:'restore'});await finished(offline);
 await call('demo.fault',{id:a.id,kind:'expire'});const expired=await batch();await until(()=>task(expired).state==='waiting_login');const pending=await batch();assert.equal(task(pending).state,'waiting_login');login(a);await finished(expired);await finished(pending);
 const posts=await call('demo.posts',{id:a.id});assert.equal(posts.length,8);assert.ok(posts.every(p=>p.status==='2'));assert.equal(new Set(posts.map(p=>p.task)).size,posts.length);
 assert.equal((await call('state')).runtime.independent,true);assert.equal(JSON.stringify(await call('state')).includes('fixture-'),false);
});
