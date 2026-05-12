"use client"

import { useEffect, useState, useCallback } from "react"
import ClientSidebar from "@/components/sidebar/client-sidebar"
import PenetrationModule from "@/components/penetration/penetration-module"
import DiagnosisModule from "@/components/diagnosis/diagnosis-module"
import StrategyModule from "@/components/strategy/strategy-module"
import { Sparkles, Printer } from "lucide-react"
import {
  listClients,
  getActiveId,
  setActiveId as persistActiveId,
  upsertClient,
  deleteClient as removeClient,
  createClient,
} from "@/lib/storage"
import type { Client } from "@/types"

export default function Home() {
  const [clients, setClients] = useState<Client[]>([])
  const [activeId, setActive] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const list = listClients()
    const aid = getActiveId()
    const resolved = aid && list.some(c => c.id === aid) ? aid : list[0]?.id ?? null
    // eslint-disable-next-line react-hooks/set-state-in-effect -- LocalStorage hydration on mount
    setClients(list)
    setActive(resolved)
    setHydrated(true)
  }, [])

  const active = clients.find(c => c.id === activeId) ?? null

  const handleSelect = useCallback((id: string) => {
    setActive(id)
    persistActiveId(id)
  }, [])

  const handleCreate = useCallback((name: string) => {
    const c = createClient(name)
    const saved = upsertClient(c)
    setClients(prev => [saved, ...prev])
    setActive(saved.id)
    persistActiveId(saved.id)
  }, [])

  const handleDelete = useCallback((id: string) => {
    removeClient(id)
    setClients(prev => {
      const next = prev.filter(c => c.id !== id)
      if (activeId === id) {
        const newId = next[0]?.id ?? null
        setActive(newId)
        persistActiveId(newId)
      }
      return next
    })
  }, [activeId])

  const handleChangeClient = useCallback((patch: Partial<Client>) => {
    setClients(prev => {
      const idx = prev.findIndex(c => c.id === activeId)
      if (idx < 0) return prev
      const merged: Client = { ...prev[idx], ...patch }
      const saved = upsertClient(merged)
      const next = [...prev]
      next[idx] = saved
      return next
    })
  }, [activeId])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30 print-root">
      <ClientSidebar
        clients={clients}
        activeId={activeId}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onDelete={handleDelete}
      />

      <main className="flex-1 min-w-0 h-screen overflow-y-auto overscroll-contain relative print-main">
        <div className="pointer-events-none absolute inset-0 overflow-hidden -z-0 no-print">
          <div className="absolute -top-32 -left-24 w-96 h-96 rounded-full bg-gradient-to-br from-blue-300/30 to-cyan-200/20 blur-3xl animate-float-slow"></div>
          <div className="absolute top-1/3 -right-32 w-[28rem] h-[28rem] rounded-full bg-gradient-to-br from-indigo-300/25 to-purple-200/20 blur-3xl animate-float-slow" style={{ animationDelay: "-6s" }}></div>
          <div className="absolute bottom-0 left-1/3 w-80 h-80 rounded-full bg-gradient-to-br from-emerald-200/20 to-teal-200/15 blur-3xl animate-float-slow" style={{ animationDelay: "-10s" }}></div>
        </div>
        <div className="relative z-10">
        {active && <StickyHeader client={active} />}
        {!hydrated ? (
          <div className="h-screen flex items-center justify-center text-slate-400 text-sm">
            加载中...
          </div>
        ) : !active ? (
          <EmptyState onCreate={handleCreate} />
        ) : (
          <Dashboard client={active} onChangeClient={handleChangeClient} />
        )}
        </div>
      </main>
    </div>
  )
}

function StickyHeader({ client }: { client: Client }) {
  function handlePrint() {
    window.print()
  }
  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-200/60 shadow-sm shadow-slate-200/40 sticky-header">
      <div className="max-w-7xl mx-auto px-8 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <img src="/logo.jpg" alt="" className="h-8 w-auto rounded-lg ring-1 ring-slate-200 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-wide bg-gradient-to-r from-[#004B73] to-[#0077B6] bg-clip-text text-transparent">
              势途 GEO · 市场情报大盘
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              当前客户：<span className="font-medium text-slate-700">{client.name}</span>
              {client.industry && <span className="text-slate-400"> · {client.industry}</span>}
            </div>
          </div>
        </div>
        <button
          onClick={handlePrint}
          className="no-print inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-lg bg-gradient-to-r from-[#004B73] to-[#0077B6] text-white hover:shadow-lg hover:shadow-blue-300/40 hover:-translate-y-0.5 transition-all whitespace-nowrap"
        >
          <Printer className="h-3.5 w-3.5" />
          导出 PDF 报告
        </button>
      </div>
    </header>
  )
}

function EmptyState({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState("")
  return (
    <div className="h-screen flex flex-col items-center justify-center px-6 animate-fade-in-up">
      <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-[#004B73] via-[#0077B6] to-[#00B4D8] flex items-center justify-center mb-7 shadow-2xl shadow-blue-300/40 animate-pulse-ring">
        <Sparkles className="h-12 w-12 text-white" />
      </div>
      <h2 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent">
        欢迎使用势途 GEO 市场情报终端
      </h2>
      <p className="text-sm text-slate-500 mt-3 max-w-md text-center leading-relaxed">
        每个客户的调研数据、诊断结果与生成策略会自动保存在浏览器本地，刷新不丢失。
      </p>
      <div className="mt-8 flex gap-2 w-full max-w-sm">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && name.trim()) {
              onCreate(name.trim())
              setName("")
            }
          }}
          placeholder="输入第一个客户名称（如：势途 / 客户A）"
          className="flex-1 px-4 py-3 text-sm rounded-xl border border-slate-200 bg-white/70 backdrop-blur outline-none focus:border-[#0077B6] focus:ring-2 focus:ring-[#0077B6]/20 transition-all"
        />
        <button
          onClick={() => {
            if (name.trim()) {
              onCreate(name.trim())
              setName("")
            }
          }}
          className="px-5 py-3 text-sm rounded-xl bg-gradient-to-r from-[#004B73] to-[#0077B6] hover:shadow-lg hover:shadow-blue-300/40 hover:-translate-y-0.5 text-white font-medium transition-all"
        >
          创建
        </button>
      </div>
    </div>
  )
}

function Dashboard({
  client,
  onChangeClient,
}: {
  client: Client
  onChangeClient: (patch: Partial<Client>) => void
}) {
  return (
    <div className="max-w-7xl mx-auto px-8 py-8 animate-fade-in-up print-container">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <div className="text-[11px] text-slate-400 mb-1.5 tracking-[0.18em] uppercase font-medium">
            当前客户
          </div>
          <h1 className="text-3xl font-bold tracking-tight shimmer-text">
            {client.name}
          </h1>
          {client.industry && (
            <span className="inline-flex items-center gap-1.5 mt-2.5 text-xs px-2.5 py-1 rounded-full bg-white/70 backdrop-blur border border-slate-200 text-slate-600 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-blue-500 to-cyan-400"></span>
              {client.industry}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-400">
          创建于 {new Date(client.createdAt).toLocaleDateString("zh-CN")}
        </div>
      </header>

      <section className="space-y-6">
        <PenetrationModule client={client} onChangeClient={onChangeClient} />
        <DiagnosisModule client={client} onChangeClient={onChangeClient} />
        <StrategyModule client={client} onChangeClient={onChangeClient} />
      </section>
    </div>
  )
}
