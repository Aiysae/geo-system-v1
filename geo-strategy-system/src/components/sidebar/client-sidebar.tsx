"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Plus, Trash2, Users, Database, X } from "lucide-react"
import type { Client } from "@/types"

interface Props {
  clients: Client[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: (name: string) => void
  onDelete: (id: string) => void
  /** 仅在移动端抽屉模式下生效：是否展开。桌面端 (md+) 永远显示，此值被忽略。 */
  open?: boolean
  /** 仅在移动端：抽屉关闭回调。桌面端不会触发。 */
  onClose?: () => void
}

export default function ClientSidebar({
  clients,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  open = false,
  onClose,
}: Props) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")

  function submit() {
    const v = name.trim()
    if (!v) return
    onCreate(v)
    setName("")
    setAdding(false)
  }

  // 移动端 (<md)：fixed 抽屉，根据 open 平移；桌面端 (md+)：静态 flex 子项，始终可见。
  // md:translate-x-0 强行覆盖移动端的 -translate-x-full，使桌面端布局不受 open 状态影响。
  const drawerClass = open ? "translate-x-0" : "-translate-x-full"

  return (
    <aside
      className={`no-print fixed md:static z-50 inset-y-0 left-0 w-[232px] shrink-0 transform transition-transform duration-300 ease-out md:translate-x-0 ${drawerClass} bg-gradient-to-b from-[#001743] via-[#002C70] to-[#003B8F] text-white h-screen flex flex-col overflow-hidden shadow-[10px_0_36px_-28px_rgba(0,29,102,0.9)]`}
    >
      <div className="relative flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4 backdrop-blur-sm">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            title="返回势途 GEO 品牌主页"
            className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            <Image
              src="/brand/shitu-lockup.jpg"
              alt="势途"
              width={840}
              height={960}
              sizes="36px"
              priority
              className="h-8 w-auto rounded-md bg-white ring-1 ring-white/20"
            />
          </Link>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">势途 GEO</div>
            <div className="mt-0.5 text-[10px] text-white/60">全链路操作工具</div>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden p-1.5 rounded hover:bg-white/10 transition shrink-0"
            aria-label="关闭侧边栏"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="relative flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/60 font-semibold">
          <Users className="h-3.5 w-3.5" /> 客户列表
        </div>
        <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px] text-cyan-100 ring-1 ring-white/10">
          {clients.length}
        </span>
        <button
          onClick={() => setAdding(true)}
          className="p-1 rounded hover:bg-white/10 transition"
          aria-label="新增客户"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {adding && (
        <div className="px-3 pb-2 flex gap-1 shrink-0">
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") submit()
              if (e.key === "Escape") {
                setName("")
                setAdding(false)
              }
            }}
            placeholder="客户名称..."
            className="flex-1 bg-white/10 placeholder:text-white/40 text-sm rounded px-2 py-1.5 outline-none focus:bg-white/15"
          />
          <button
            onClick={submit}
            className="text-xs px-2.5 rounded bg-white/15 hover:bg-white/25 transition"
          >
            添加
          </button>
        </div>
      )}

      <nav className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pb-4 space-y-1">
        {clients.length === 0 && !adding && (
          <p className="px-3 py-8 text-xs text-white/40 text-center leading-relaxed">
            暂无客户
            <br />
            点击右上 + 创建
          </p>
        )}
        {clients.map(c => (
          <div
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`group flex items-center justify-between rounded-lg px-3 py-2.5 cursor-pointer text-sm transition ${
              activeId === c.id
                ? "bg-gradient-to-r from-[#1677FF] to-[#00AEEA] text-white shadow-sm"
                : "text-white/72 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${activeId === c.id ? "bg-white" : "bg-cyan-300/45"}`} />
              <span className="truncate">{c.name}</span>
            </span>
            <button
              onClick={e => {
                e.stopPropagation()
                if (confirm(`确定删除客户「${c.name}」?`)) onDelete(c.id)
              }}
              className="opacity-0 group-hover:opacity-100 transition p-1 hover:bg-white/10 rounded"
              aria-label="删除"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </nav>

      <div className="relative px-4 py-3 border-t border-white/10 text-[11px] text-white/45 flex items-center gap-1.5 shrink-0">
        <Database className="h-3 w-3" />
        云端同步 · 多设备可用
      </div>
    </aside>
  )
}
