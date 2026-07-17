import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

function Panel({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("geo-panel", className)} {...props} />
}

function PanelHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("geo-panel-header", className)} {...props} />
}

function PanelContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("geo-panel-content", className)} {...props} />
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("geo-empty-state", className)}>
      <div className="max-w-md">
        {Icon ? (
          <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[#E6F4FF] text-[#1677FF]">
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
        <div className="text-sm font-semibold text-[#38536E]">{title}</div>
        {description ? <div className="mt-1 text-xs leading-5 text-[#7E91A7]">{description}</div> : null}
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  )
}

export { Panel, PanelHeader, PanelContent, EmptyState }
