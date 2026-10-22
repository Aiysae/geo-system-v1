const test=require('node:test'),assert=require('node:assert/strict');
const {sessionJar,jarSession,captureSession}=require('../session.cjs');
test('cookie updates obey domain, path, max-age and deletion while preserving storage',()=>{
 const session={cookies:[{name:'sid',value:'old',domain:'.example.com',path:'/',secure:true,httpOnly:true}],origins:[{origin:'https://example.com',localStorage:[{name:'state',value:'kept'}]}],sessionStorage:{'https://example.com':{nonce:'kept'}}};
 const jar=sessionJar(session),url='https://app.example.com/editor/new';
 jar.setCookieSync('sid=new; Domain=.example.com; Path=/; Secure; HttpOnly; Max-Age=3600',url);
 jar.setCookieSync('pathCookie=editor; Path=/editor; Secure',url);
 jar.setCookieSync('hostOnly=one; Path=/; Secure',url);
 jar.setCookieSync('bad=bad; Domain=unrelated.com',url,{ignoreError:true});
 assert.equal(jar.getCookieStringSync('https://unrelated.com/'),'');
 assert.ok(!jar.getCookieStringSync('https://other.example.com/').includes('hostOnly'));
 assert.ok(!jar.getCookieStringSync('https://app.example.com/other').includes('pathCookie'));
 const saved=jarSession(jar,session);assert.equal(saved.cookies.find(c=>c.name==='sid').value,'new');assert.ok(saved.cookies.find(c=>c.name==='sid').expires>Date.now()/1000+3500);assert.deepEqual(saved.origins,session.origins);assert.deepEqual(saved.sessionStorage,session.sessionStorage);
 const restored=sessionJar(saved);restored.setCookieSync('sid=; Domain=.example.com; Path=/; Max-Age=0',url);assert.ok(!jarSession(restored,saved).cookies.some(c=>c.name==='sid'));
});
test('browser snapshots preserve unopened origins and session storage',async()=>{
 const state=await captureSession({storageState:async()=>({cookies:[],origins:[{origin:'https://example.com',localStorage:[],indexedDB:[{name:'tokens'}]}]}),pages:()=>[{evaluate:async()=>({origin:'https://example.com',items:{refreshed:'yes'}})}]},
 {origins:[{origin:'https://login.example.com',localStorage:[{name:'identity',value:'kept'}]}],sessionStorage:{'https://login.example.com':{nonce:'kept'}}});
 assert.equal(state.origins.length,2);assert.equal(state.sessionStorage['https://example.com'].refreshed,'yes');assert.equal(state.sessionStorage['https://login.example.com'].nonce,'kept');
});
