import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createUser,authenticateUser,createSession}=require('../../../src/lib/auth.ts') as typeof import('../../../src/lib/auth')
const email='publishing-demo@local.test',password='LocalDemo2026!'
let user
try{user=await authenticateUser(email,password)}catch{user=await createUser({email,password,name:'分发验收',emailVerifiedAt:new Date().toISOString()})}
const session=await createSession(user.id)
fs.writeFileSync(path.join(path.dirname(process.env.LOCAL_KV_FILE!),'test-session.json'),JSON.stringify({userId:user.id,cookie:session.cookieValue}),{mode:0o600})
console.log('Local preview account ready')
