"use client"

import { useState } from "react"
import { Plus, Trash2, Users, Database } from "lucide-react"
import type { Client } from "@/types"

interface Props {
  clients: Client[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: (name: string) => void
  onDelete: (id: string) => void
}

export default function ClientSidebar({ clients, activeId, onSelect, onCreate, onDelete }: Props) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")

  function submit() {
    const v = name.trim()
    if (!v) return
    onCreate(v)
    setName("")
    setAdding(false)
  }

  return (
    <aside className="no-print w-64 shrink-0 bg-gradient-to-b from-[#001a2c] via-[#003554] to-[#004B73] text-white h-screen flex flex-col overflow-hidden shadow-2xl shadow-blue-900/20">
      <div className="px-5 py-5 border-b border-white/10 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <img src="/logo.jpg" alt="" className="h-9 w-auto rounded-lg ring-1 ring-white/20" />
          <div>
            <div className="font-bold tracking-wide text-base bg-gradient-to-r from-white to-blue-200 bg-clip-text text-transparent">势途 GEO</div>
            <div className="text-[11px] text-white/60 mt-0.5">市场情报终端</div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 pt-5 pb-2 shrink-0">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/60 font-semibold">
          <Users className="h-3.5 w-3.5" /> 客户列表
        </div>
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

      <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pb-4 space-y-0.5">
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
            className={`group flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer text-sm transition ${
              activeId === c.id
                ? "bg-gradient-to-r from-[#0077B6] to-[#00B4D8] text-white shadow-lg shadow-cyan-500/30"
                : "text-white/75 hover:bg-white/5"
            }`}
          >
            <span className="truncate">{c.name}</span>
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

      <div className="px-4 py-3 border-t border-white/10 text-[11px] text-white/40 flex items-center gap-1.5 shrink-0">
        <Database className="h-3 w-3" />
        本地存储 · 刷新不丢
      </div>
    </aside>
  )
}
