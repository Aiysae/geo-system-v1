import { NextRequest, NextResponse } from "next/server"
import { requireUserId } from "@/lib/with-credits"
import { publishingService } from "@/lib/local-publishing/service"
import { requestPublishingFeedbackSync } from "@/lib/local-publishing/feedback-sync"
import { requireOperationAccess } from "@/lib/team-access"
import { preparePublishArticle } from "@/lib/article-publishing/content"
import { marked } from "marked"
import { JSDOM } from "jsdom"

export const runtime="nodejs"
export const dynamic="force-dynamic"
function sameOrigin(request:NextRequest){
  try {
    const origin=new URL(request.headers.get("origin")||"")
    return origin.host===(request.headers.get("host")||request.nextUrl.host)&&origin.protocol===request.nextUrl.protocol
  } catch {return false}
}
function reply(data:unknown,status=200){return NextResponse.json(data,{status,headers:{"Cache-Control":"private, no-store, max-age=0"}})}
export async function GET(request:NextRequest){
  const auth=await requireUserId();if(!auth.ok)return auth.response
  const action=request.nextUrl.searchParams.get("action")||"state"
  if(!["state","login.snapshot","article.get","demo.posts"].includes(action))return reply({error:"读取操作无效"},400)
  if(action==="state")requestPublishingFeedbackSync()
  try{return reply(await publishingService().request(auth.userId,action,{id:request.nextUrl.searchParams.get("id")}))}
  catch(e){return reply({error:e instanceof Error?e.message:"读取失败"},400)}
}
export async function POST(request:NextRequest){
  const auth=await requireUserId();if(!auth.ok)return auth.response
  if(!sameOrigin(request))return reply({error:"请从当前工作台提交操作"},403)
  try{
    const raw=await request.text();if(raw.length>4000000)return reply({error:"内容超过单次提交大小"},413)
    const body=JSON.parse(raw) as {action:string;input?:Record<string,unknown>}
    const allowed=["account.add","account.group","account.remove","account.logout","login.open","login.close","login.verify","login.interact","article.save","batch.preflight","batch.create","batch.draft.save","batch.draft.delete","queue.pause","task.action","task.url","demo.fault"]
    if(!allowed.includes(body.action))return reply({error:"操作无效"},400)
    const input=body.input||{}
    if(body.action==="article.save"&&((input.metadata as {contentType?:string}|undefined)?.contentType||"article")==="article"){
      if(typeof input.markdown!=="string"||input.markdown.length>300000)return reply({error:"文章正文过长或格式错误"},400)
      const metadata=(input.metadata||{}) as {digest?:string;tags?:string[]}
      const placeholders=new Map<string,string>()
      const safeMarkdown=input.markdown.replace(/local-asset:([A-Za-z0-9_-]+)/g,(match:string,id:string)=>{
        const url=`https://local-asset.invalid/${id}`;placeholders.set(url,match);return url
      })
      const prepared=preparePublishArticle({markdown:safeMarkdown,renderedHtml:await marked.parse(safeMarkdown),
        title:typeof input.title==="string"?input.title:undefined,digest:metadata.digest,tags:Array.isArray(metadata.tags)?metadata.tags.join(","):"",
        createDocument:html=>new JSDOM(html).window.document})
      const restore=(value:string)=>{for(const [url,local] of placeholders)value=value.replaceAll(url,local);return value}
      input.title=prepared.title;input.markdown=restore(prepared.markdownContent);input.html=restore(prepared.htmlContent)
      input.metadata={...metadata,digest:prepared.digest,tags:prepared.tags}
    }
    if(body.action==="batch.create"&&input.clientId){
      // Fail at creation rather than after publishing when the batch is counted toward a client the user cannot edit.
      await requireOperationAccess({userId:auth.userId,clientId:String(input.clientId),teamId:typeof input.teamId==="string"&&input.teamId?input.teamId:undefined,module:"feedback",action:"edit"})
    }
    return reply(await publishingService().request(auth.userId,body.action,input))
  }catch(e){return reply({error:e instanceof Error?e.message:"操作失败"},400)}
}
