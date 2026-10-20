import "server-only"
import { fork, type ChildProcess } from "node:child_process"
import path from "node:path"
import { randomUUID } from "node:crypto"

type Pending = { resolve:(value:unknown)=>void; reject:(error:Error)=>void; timer:ReturnType<typeof setTimeout> }
class PublishingService {
  child:ChildProcess|null=null
  ready:Promise<void>|null=null
  pending=new Map<string,Pending>()
  watchdog:ReturnType<typeof setInterval>|null=null
  async start() {
    if(this.ready)return this.ready
    const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_ENV:process.env.NODE_ENV,
      LOCAL_PUBLISHER_DATA_DIR:process.env.LOCAL_PUBLISHER_DATA_DIR||path.join(process.cwd(),".data/local-publishing"),
      LOCAL_PUBLISHER_BROWSER:process.env.LOCAL_PUBLISHER_BROWSER}
    this.ready=new Promise<void>((resolve,reject)=>{
      const daemonFile=process.env.LOCAL_PUBLISHER_DAEMON_PATH||[process.cwd(),"integrations","local-publisher","daemon.cjs"].join(path.sep)
      const child=fork(daemonFile,[],{env,execArgv:[],execPath:process.env.LOCAL_PUBLISHER_NODE||process.execPath,stdio:["ignore","ignore","ignore","ipc"]})
      this.child=child
      const startup=setTimeout(()=>{reject(new Error("本机发布服务启动超时"));child.kill()},15000)
      child.on("message",(message:unknown)=>{
        const m=message as {type:string;id?:string;ok?:boolean;data?:unknown;error?:string}
        if(m.type==="ready"){clearTimeout(startup);resolve();return}
        if(m.type!=="response"||!m.id)return
        const p=this.pending.get(m.id);if(!p)return
        clearTimeout(p.timer);this.pending.delete(m.id)
        if(m.ok)p.resolve(m.data);else p.reject(new Error(m.error||"操作失败"))
      })
      const closed=()=>{
        clearTimeout(startup);if(this.child!==child)return
        this.child=null;this.ready=null;reject(new Error("本机发布服务启动失败，请确认 Node.js 版本不低于 22.13"))
        for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error("本机执行器正在恢复，请稍后刷新"))}this.pending.clear()
      }
      child.on("error",closed);child.on("exit",closed)
    })
    if(!this.watchdog){this.watchdog=setInterval(()=>{if(!this.ready)void this.start().catch(()=>{})},5000);this.watchdog.unref()}
    return this.ready
  }
  async request(owner:string,action:string,input:Record<string,unknown>={}) {
    await this.start()
    return new Promise<unknown>((resolve,reject)=>{
      const id=randomUUID(),timer=setTimeout(()=>{this.pending.delete(id);reject(new Error("操作仍在处理，请刷新状态；不要重复创建批次"))},60000)
      this.pending.set(id,{resolve,reject,timer});this.child!.send({type:"request",id,owner,action,input},error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(new Error("执行器连接中断"))}})
    })
  }
}
const state=globalThis as typeof globalThis & {__shituPublishingService?:PublishingService}
export function localPublishingEnabled(){return process.env.GEO_LOCAL_PUBLISHING==="1"||process.env.NODE_ENV!=="production"}
export function publishingService(){
  if(!localPublishingEnabled())throw new Error("当前环境未启用本机独立分发")
  return state.__shituPublishingService ||= new PublishingService()
}
export async function startLocalPublishing(){if(localPublishingEnabled())await publishingService().start()}
