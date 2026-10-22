"use client"

import type { ReactNode, RefObject } from "react"
import SiteFooter from "@/components/site-footer"
import { cn } from "@/lib/utils"

// Page chrome shared by the GEO workspace and the publishing console:
// the sidebar (a drawer below md), the scrolling main column and the footer.
export function WorkspaceFrame({
  sidebar,
  sidebarOpen,
  onCloseSidebar,
  header,
  children,
  overlays,
  mainRef,
  className,
}: {
  sidebar: ReactNode
  sidebarOpen: boolean
  onCloseSidebar: () => void
  header: ReactNode
  children: ReactNode
  overlays?: ReactNode
  mainRef?: RefObject<HTMLElement | null>
  className?: string
}) {
  return (
    <div className={cn("flex h-screen w-screen overflow-hidden geo-workspace-bg print-root", className)}>
      {/* 移动端：抽屉展开时的半透明遮罩，点击关闭 */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-40 no-print"
          onClick={onCloseSidebar}
          aria-hidden="true"
        />
      )}

      {sidebar}

      <main ref={mainRef} className="flex-1 min-w-0 h-screen overflow-y-auto overscroll-contain relative print-main">
        <div className="relative z-10">
          {header}
          {children}
          <SiteFooter />
        </div>
      </main>
      {overlays}
    </div>
  )
}
