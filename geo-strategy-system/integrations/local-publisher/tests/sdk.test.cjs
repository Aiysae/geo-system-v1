const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {DemoPlatform}=require('../demo.cjs');const {runSdk}=require('../sdk-runner.cjs');
test('copied SDK remains byte-identical; real SDK profile/publish/audit work with fixture',async t=>{
 const manifest=require('../vendor/provenance.json');assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../vendor/platform-service.cjs'))).digest('hex'),manifest.sha256);
 const directory=fs.mkdtempSync(os.tmpdir()+'/geo-sdk-test-');const demo=await new DemoPlatform(directory).start();t.after(async()=>{await demo.close();fs.rmSync(directory,{recursive:true,force:true})});
 const login=await fetch(demo.url+'/demo/login',{method:'POST',body:JSON.stringify({username:'test-user',password:'demo1234'})});const token=login.headers.get('set-cookie').match(/SESSION=([^;]+)/)[1];const session={cookies:[{name:'SESSION',value:token,domain:'.csdn.net',path:'/'}],origins:[]};
 const options={directory,fixtureUrl:demo.url,timeoutMs:45000};const profile=await runSdk({operation:'profile',platform:'CSDN',session},options);assert.equal(profile.identity.id,'test-user');
 const args={operation:'publish',platform:'CSDN',session,accountId:'account',remoteId:'test-user',remoteName:'Test',taskId:'normal',mode:'publish',article:{title:'独立适配器测试',html:'<p>本地正文</p>',metadata:{tags:['测试']}}};
 const published=await runSdk(args,options);assert.ok(published.ok);assert.ok(published.remoteId);const audit=await runSdk({operation:'audit',platform:'CSDN',session,accountId:'account',taskId:'normal',remoteId:published.remoteId},options);assert.equal(audit.auditStatus,0);
 demo.fault('test-user','drop');const uncertain=await runSdk({...args,taskId:'lost'},options);assert.equal(uncertain.ok,false);assert.equal(uncertain.code,'NETWORK');
 assert.equal(demo.stats('test-user').filter(p=>p.task==='lost').length,1);
 // Exactly one draft write plus one publish write; the SDK's internal retry
 // must not send a third write after losing the publish response.
 assert.equal(demo.db.prepare("SELECT count(*) n FROM calls WHERE task='lost' AND path LIKE '%saveArticle'").get().n,2);
 demo.fault('test-user','expire');const expired=await runSdk({operation:'profile',platform:'CSDN',session},options);assert.equal(expired.code,'AUTH');
});

test('SDK persists rotated cookies and distinguishes 403, 429 Retry-After and expiry',async t=>{
 const directory=fs.mkdtempSync(os.tmpdir()+'/geo-sdk-session-'),demo=await new DemoPlatform(directory).start();
 t.after(async()=>{await demo.close();fs.rmSync(directory,{recursive:true,force:true});});
 const login=await fetch(demo.url+'/demo/login',{method:'POST',body:JSON.stringify({username:'rotation-test',password:'demo1234'})});
 const token=login.headers.get('set-cookie').match(/SESSION=([^;]+)/)[1];
 const session={cookies:[{name:'SESSION',value:token,domain:'.csdn.net',path:'/',secure:true,httpOnly:true}],origins:[{origin:'https://editor.csdn.net',localStorage:[{name:'editor',value:'kept'}]}]};
 const options={directory,fixtureUrl:demo.url,timeoutMs:45000};
 const profile=session=>runSdk({operation:'profile',platform:'CSDN',session},options);
 demo.fault('rotation-test','rotate');const rotated=await profile(session);assert.equal(rotated.ok,true);
 assert.notEqual(rotated.session.cookies[0].value,token);assert.deepEqual(rotated.session.origins,session.origins);
 assert.equal((await profile(session)).code,'AUTH');assert.equal((await profile(rotated.session)).ok,true);
 demo.fault('rotation-test','challenge');assert.equal((await profile(rotated.session)).code,'CHALLENGE');
 demo.fault('rotation-test','restore');demo.fault('rotation-test','quota');const quota=await profile(rotated.session);assert.equal(quota.code,'RATE_LIMIT');assert.ok(quota.retryAt>Date.now());
});
