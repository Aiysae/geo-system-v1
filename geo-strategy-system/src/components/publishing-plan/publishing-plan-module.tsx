"use client"

import { CalendarDays } from "lucide-react"
import PublishingPlanPanel from "@/components/client-feedback/publishing-plan-panel"
import type { Client } from "@/types"

/**
 * The publishing plan on its own: it needs no strategy report or question
 * pool. When there is a strategy, its platform advice feeds the suggestions;
 * otherwise they come from the latest detection.
 */
export default function PublishingPlanModule({ client }: { client: Client }) {
  return (
    <div className="geo-module-surface">
      <div className="geo-module-header">
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="geo-module-icon">
              <CalendarDays className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <div className="geo-module-title">发布规划</div>
              <div className="geo-module-description truncate">当前客户：{client.name}</div>
            </div>
          </div>
          <div className="rounded-lg border border-[#DCE6F2] bg-[#F8FAFD] px-3 py-2 text-xs text-slate-600">
            发布数量、渠道分配与执行任务
          </div>
        </div>
      </div>
      <main className="px-3 py-4 sm:px-5 lg:px-6">
        <PublishingPlanPanel key={`publishing-plan-${client.id}`} client={client} />
      </main>
    </div>
  )
}
