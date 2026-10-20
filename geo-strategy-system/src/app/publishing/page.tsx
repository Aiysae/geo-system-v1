import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import PublishingConsole from "@/components/publishing/publishing-console"
export const dynamic="force-dynamic"
export const metadata={title:"账号与文章分发 | 势途 GEO"}
export default async function PublishingPage(){
  const user=await getCurrentUser()
  if(!user)redirect("/sign-in?redirect_url=/publishing")
  return <PublishingConsole userName={user.name||user.email}/>
}
