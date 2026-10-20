const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fork}=require('node:child_process'),sharp=require('sharp');
const {Store}=require('../store.cjs'),{DemoPlatform}=require('../demo.cjs');

test('local demo accepts five content types through the queue without real platform writes',{timeout:60000},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'geo-media-flow-'));
  const store=new Store(dir);store.getAsset=(owner,id)=>store.asset(owner,id);
  const demo=new DemoPlatform(dir);
  demo.db.prepare('INSERT INTO sessions(token,username) VALUES(?,?)').run('fixture-token','fixture-user');
  demo.db.close();
  const account=store.addAccount('owner','DEMO_CSDN','演示账号');
  store.saveSession('owner',account.id,{cookies:[{name:'SESSION',value:'fixture-token',domain:'.csdn.net',path:'/'}]},
    {id:'fixture-user',name:'演示账号'});
  const incoming=path.join(dir,'incoming',require('node:crypto').createHash('sha256').update('owner').digest('hex').slice(0,20));fs.mkdirSync(incoming,{recursive:true});
  async function asset(kind,name,buffer,index){
    const uploadId=`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
    fs.writeFileSync(path.join(incoming,uploadId),buffer);
    return store.registerAsset('owner',{uploadId,kind,name});
  }
  const image=await asset('image','封面.png',await sharp({create:{width:12,height:12,channels:3,background:'#2266aa'}}).png().toBuffer(),1);
  const video=await asset('video','短片.mp4',Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(32)]),2);
  const audio=await asset('audio','旁白.mp3',Buffer.concat([Buffer.from('ID3'),Buffer.alloc(32)]),3);
  const content=[
    {title:'演示视频',markdown:'',metadata:{contentType:'video',assetIds:[video.id],coverAssetId:image.id}},
    {title:'演示图文',markdown:'说明',metadata:{contentType:'imageText',assetIds:[image.id]}},
    {title:'演示音频',markdown:'',metadata:{contentType:'audio',assetIds:[audio.id],coverAssetId:image.id}},
    {title:'演示公众号包',markdown:'正文',metadata:{contentType:'wechat',entries:[{title:'第一篇',markdown:'正文',coverAssetId:image.id}]}},
    {title:'演示动态',markdown:'简短动态',metadata:{contentType:'dynamic'}},
  ].map(input=>store.saveArticle('owner',input));
  const ids=content.map(x=>x.id);
  assert.equal(store.preflightBatch('owner',{accountIds:[account.id],articleIds:ids,mode:'draft'}).ok,true);
  store.createBatch('owner',{accountIds:[account.id],articleIds:ids,mode:'draft',requestKey:'media-demo'});
  store.close();
  const child=fork(path.join(__dirname,'../daemon.cjs'),[],{
    env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_ENV:'test',LOCAL_PUBLISHER_DATA_DIR:dir},
    stdio:['ignore','ignore','ignore','ipc'],execArgv:[],
  });
  t.after(()=>{child.kill();fs.rmSync(dir,{recursive:true,force:true})});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('daemon did not start')),15000);child.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);resolve();}});child.once('exit',()=>reject(Error('daemon exited')));});
  let sequence=0;
  const request=(action,input={})=>new Promise((resolve,reject)=>{
    const id=String(++sequence),timer=setTimeout(()=>reject(Error('daemon request timeout')),10000);
    const listener=m=>{if(m.type==='response'&&m.id===id){clearTimeout(timer);child.off('message',listener);m.ok?resolve(m.data):reject(Error(m.error));}};
    child.on('message',listener);child.send({type:'request',id,owner:'owner',action,input});
  });
  const deadline=Date.now()+45000;let state;
  while(Date.now()<deadline){
    state=await request('state');if(state.tasks.length===5&&state.tasks.every(x=>x.state==='draft'))break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.equal(state.tasks.length,5,JSON.stringify(state.tasks.map(x=>[x.title,x.state,x.message])));
  assert.ok(state.tasks.every(x=>x.state==='draft'),JSON.stringify(state.tasks.map(x=>[x.title,x.state,x.message])));
  const posts=await request('demo.posts',{id:account.id});
  assert.deepEqual(new Set(posts.map(x=>x.content_type)),new Set(['video','imageText','audio','wechat','dynamic']));
});
