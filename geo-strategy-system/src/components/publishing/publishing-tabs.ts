import { FileText, LayoutGrid, Send, ShieldCheck, Users } from "lucide-react"

export type PublishingTabKey = "tasks" | "accounts" | "articles" | "assets" | "platforms"

// Sections of the publishing console, listed under 内容分发 in the workspace sidebar.
export const PUBLISHING_TABS: ReadonlyArray<{
  key: PublishingTabKey
  label: string
  icon: typeof Send
}> = [
  { key: "tasks", label: "发布", icon: Send },
  { key: "accounts", label: "账号", icon: Users },
  { key: "articles", label: "内容库", icon: FileText },
  { key: "assets", label: "多媒体素材", icon: LayoutGrid },
  { key: "platforms", label: "平台状态", icon: ShieldCheck },
] as const

export function isPublishingTabKey(value: string | null): value is PublishingTabKey {
  return PUBLISHING_TABS.some(tab => tab.key === value)
}
