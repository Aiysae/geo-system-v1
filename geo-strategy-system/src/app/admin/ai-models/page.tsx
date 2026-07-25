import { redirect } from "next/navigation"
import { Bot, ShieldCheck } from "lucide-react"
import { AdminHeader } from "@/components/admin/admin-header"
import SiteFooter from "@/components/site-footer"
import { isAdminUser } from "@/lib/admin"
import { listAiCredentialsPublic } from "@/lib/ai-credential-store"
import { getCurrentUser } from "@/lib/auth"
import {
  AI_OFFICIAL_PRESETS,
  AI_RELAY_PRESETS,
  listAiGatewayProvidersPublic,
} from "@/lib/ai-gateways"
import { listAiProviderPublicSettings, migrateLegacyAiProviderSecrets } from "@/lib/ai-settings"
import { AiCredentialPoolManager } from "./ai-credential-pool-manager"
import { AiModelCenter } from "./ai-model-center"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdminAiModelsPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/sign-in?redirect_url=/admin/ai-models")
  if (!isAdminUser(user)) {
    return (
      <div className="flex min-h-screen items-center justify-center geo-saturated-bg px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl ring-1 ring-slate-200">
          <ShieldCheck className="mx-auto h-8 w-8 text-rose-500" />
          <h1 className="mt-4 text-lg font-bold text-slate-900">无权限访问</h1>
          <p className="mt-2 text-sm text-slate-500">该页面仅限管理员访问。</p>
        </div>
      </div>
    )
  }

  await migrateLegacyAiProviderSecrets(user.id)
  const [connections, legacySettings, credentials] = await Promise.all([
    listAiGatewayProvidersPublic(),
    listAiProviderPublicSettings(),
    listAiCredentialsPublic(),
  ])

  return (
    <div className="min-h-screen geo-saturated-bg">
      <AdminHeader
        title="势途 GEO · 管理后台"
        subtitle="模型渠道与功能配置"
        icon={<Bot className="h-5 w-5 text-white" />}
        active="ai-models"
      />
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
        <AiCredentialPoolManager credentials={credentials} />
        <AiModelCenter
          officialPresets={AI_OFFICIAL_PRESETS}
          relayPresets={AI_RELAY_PRESETS}
          connections={connections}
          legacySettings={legacySettings}
        />
      </main>
      <SiteFooter />
    </div>
  )
}
