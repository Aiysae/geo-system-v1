/* eslint-disable @next/next/no-img-element -- private live browser frames are data URLs */
"use client"

import Link from "next/link"
import Image from "next/image"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Bold,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Globe,
  Heading2,
  Italic,
  LayoutGrid,
  Link2,
  List,
  Monitor,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  Quote,
  Search,
  Send,
  ShieldCheck,
  Upload,
  Users,
  X,
} from "lucide-react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import type {
  LoginSnapshot,
  PublishingAccount,
  PublishingArticle,
  PublishingAsset,
  PublishingContentType,
  PublishingSnapshot,
  PublishingTask,
} from "@/lib/local-publishing/types"
import s from "./publishing-console.module.css"
import platformLogos from "./platform-logos.json"

function PlatformMark({
  name,
  platform = "",
  small = false,
}: {
  name: string
  platform?: string
  small?: boolean
}) {
  const src = platformLogos[platform as keyof typeof platformLogos]
  return (
    <span
      className={`${s.platformMark} ${small ? s.smallMark : ""}`}
      data-platform={platform}
      title={`${name} Logo`}
      aria-hidden="true"
    >
      {src ? (
        <Image src={src} alt="" width={40} height={40} sizes={small ? "20px" : "40px"} unoptimized={src.endsWith(".ico")} />
      ) : <Globe size={small ? 16 : 28} />}
      {platform === "DEMO_CSDN" && <span className={s.demoMark}>演</span>}
    </span>
  )
}
function Dialog({
  title,
  children,
  onClose,
  wide = false,
  errorMessage,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
  errorMessage?: string
}) {
  const box = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    box.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        close.current()
        return
      }
      if (event.key !== "Tab" || !box.current) return
      const elements = Array.from(
        box.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      )
      const first = elements[0],
        last = elements.at(-1)
      const outside =
        !box.current.contains(document.activeElement) || document.activeElement === box.current
      if (event.shiftKey && (outside || document.activeElement === first)) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && (outside || document.activeElement === last)) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener("keydown", keydown)
    return () => {
      document.removeEventListener("keydown", keydown)
      previous?.focus()
    }
  }, [])
  return (
    <div
      className={s.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <section
        ref={box}
        tabIndex={-1}
        className={`${s.dialog} ${wide ? s.wideDialog : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={s.dialogHead}>
          <h2>{title}</h2>
          <button aria-label="关闭弹窗" className={s.iconButton} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {errorMessage && (
          <p role="alert" className={s.error}>
            {errorMessage}
          </p>
        )}
        {children}
      </section>
    </div>
  )
}
function Pagination({
  page,
  total,
  onChange,
}: {
  page: number
  total: number
  onChange: (v: number) => void
}) {
  const count = Math.max(1, Math.ceil(total / 10)),
    current = Math.min(page, count)
  return (
    <div className={s.pagination}>
      <span>共 {total} 条</span>
      <span>10 条 / 页</span>
      <button aria-label="上一页" disabled={current <= 1} onClick={() => onChange(current - 1)}>
        <ChevronLeft size={15} />
      </button>
      <b>
        {current} / {count}
      </b>
      <button aria-label="下一页" disabled={current >= count} onClick={() => onChange(current + 1)}>
        <ChevronRight size={15} />
      </button>
    </div>
  )
}

const endpoint = "/api/local-publishing"
async function read<T>(action = "state", id = ""): Promise<T> {
  const response = await fetch(`${endpoint}?action=${action}&id=${encodeURIComponent(id)}`, {
    cache: "no-store",
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || "读取失败")
  return data
}
async function send<T = unknown>(action: string, input: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, input }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || "操作失败")
  return data
}
async function importRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || "文章导入失败")
  return data as T
}
const statusNames: Record<string, string> = {
  ready: "已登录",
  needs_login: "待登录",
  queued: "等待执行",
  waiting_login: "等待重新登录",
  running: "执行中",
  retry_wait: "等待自动重试",
  submitted: "已提交，待审核",
  auditing: "核验审核",
  audit_pending: "审核待核对",
  published: "已发布",
  draft: "草稿已保存",
  blocked: "存在远端依赖",
  needs_review: "提交结果待核对",
  failed: "执行失败",
  rejected: "审核未通过",
  cancelled: "已取消",
}
const contentNames: Record<PublishingContentType,string> = {
  article:"文章",video:"视频",imageText:"图文笔记",audio:"音频",wechat:"公众号内容包",dynamic:"短动态",
}
type ContentOverride = { title?:string; metadata?:{digest?:string;coverAssetId?:string} }
type FileImportPreview = { name:string; title:string; markdown:string; warnings:string[]; sourceHash:string; imageCount:number }
type ProductionClient = { id:string; name:string; teamId?:string }
type ProductionBatch = {
  id:string; clientId:string; promptTitle:string; createdAt:string; status:string; kind?:"batch"|"production_run";
  items:Array<{id:string; title:string; status:string; hasDraft:boolean; hasMediaVersion:boolean}>
}
type ProductionArticlePreview = { id:string; title:string; markdown:string; mediaMarkdown?:string }
const time = (v: number) => new Date(v).toLocaleString("zh-CN", { hour12: false })
const datetimeLocal = (v:number) => new Date(v-new Date(v).getTimezoneOffset()*60000).toISOString().slice(0,16)
const toggle = (values: string[], id: string) =>
  values.includes(id) ? values.filter((v) => v !== id) : [...values, id]

export default function PublishingConsole({ userName }: { userName: string }) {
  const [composing, setComposing] = useState(false),
    [editing, setEditing] = useState(false),
    [preview, setPreview] = useState(false)
  const [authOpen, setAuthOpen] = useState(false),
    [picker, setPicker] = useState<"accounts" | "articles" | null>(null),
    [pickerSearch, setPickerSearch] = useState("")
  const [accountSearch, setAccountSearch] = useState(""),
    [accountPlatform, setAccountPlatform] = useState(""),
    [accountStatus, setAccountStatus] = useState(""),
    [accountGroup,setAccountGroup]=useState("")
  const [articleSearch, setArticleSearch] = useState(""),
    [taskSearch, setTaskSearch] = useState(""),
    [taskStatus, setTaskStatus] = useState(""),
    [taskMode, setTaskMode] = useState("")
  const [grid, setGrid] = useState(false),
    [accountPage, setAccountPage] = useState(1),
    [articlePage, setArticlePage] = useState(1),
    [taskPage, setTaskPage] = useState(1)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const [state, setState] = useState<PublishingSnapshot | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false),
    [tab, setTab] = useState("accounts")
  const [platform, setPlatform] = useState("DEMO_CSDN"),
    [label, setLabel] = useState("")
  const [accounts, setAccounts] = useState<string[]>([]),
    [articles, setArticles] = useState<string[]>([])
  const [editId, setEditId] = useState(""),
    [title, setTitle] = useState(""),
    [markdown, setMarkdown] = useState("")
  const [contentType,setContentType]=useState<PublishingContentType>("article")
  const [assetIds,setAssetIds]=useState<string[]>([])
  const [coverAssetId,setCoverAssetId]=useState("")
  const [wechatEntries,setWechatEntries]=useState<Array<{title:string;markdown:string;coverAssetId:string}>>([])
  const [uploadKind,setUploadKind]=useState<PublishingAsset["kind"]>("image")
  const [importId,setImportId]=useState("")
  const [fileImportOpen,setFileImportOpen]=useState(false)
  const [fileImportFiles,setFileImportFiles]=useState<File[]>([])
  const [fileImportPreviews,setFileImportPreviews]=useState<FileImportPreview[]>([])
  const [fileImportSelected,setFileImportSelected]=useState<number[]>([])
  const [productionImportOpen,setProductionImportOpen]=useState(false)
  const [productionClients,setProductionClients]=useState<ProductionClient[]>([])
  const [productionClientId,setProductionClientId]=useState("")
  const [productionBatches,setProductionBatches]=useState<ProductionBatch[]>([])
  const [productionRuns,setProductionRuns]=useState<ProductionBatch[]>([])
  const [productionBatch,setProductionBatch]=useState<ProductionBatch|null>(null)
  const [productionIds,setProductionIds]=useState<string[]>([])
  const [productionVariant,setProductionVariant]=useState<"original"|"media">("original")
  const [productionPreview,setProductionPreview]=useState<ProductionArticlePreview|null>(null)
  const [importBusy,setImportBusy]=useState(false)
  const [importError,setImportError]=useState("")
  const [preflight,setPreflight]=useState<{ok:boolean;errors:Array<{message:string}>;warnings:Array<{message:string}>}|null>(null)
  const [overrides,setOverrides]=useState<Record<string,Record<string,ContentOverride>>>({})
  const [draftId,setDraftId]=useState("")
  const [draftName,setDraftName]=useState("")
  const [tags, setTags] = useState(""),
    [digest, setDigest] = useState(""),
    [cover, setCover] = useState(""),
    [original, setOriginal] = useState(false),
    [options, setOptions] = useState("{}")
  const [settingPlatform,setSettingPlatform]=useState("CSDN")
  const [mode, setMode] = useState("draft"),
    [schedule, setSchedule] = useState("")
  const [schedulePreviewNow, setSchedulePreviewNow] = useState(() => Date.now())
  const [intervalMinutes,setIntervalMinutes]=useState(0)
  const [dailyLimit,setDailyLimit]=useState(0)
  const batchKey = useRef<{ fingerprint: string; key: string } | null>(null)
  const [loginId, setLoginId] = useState(""),
    [frame, setFrame] = useState<{ id: string; data: LoginSnapshot } | null>(null),
    [inputText, setInputText] = useState("")
  const [demoPosts, setDemoPosts] = useState<Array<{ id: number; title: string; status: string }>>(
    [],
  )
  const [review, setReview] = useState<PublishingTask | null>(null),
    [remoteId, setRemoteId] = useState(""),
    [confirmed, setConfirmed] = useState(false)
  const refresh = useCallback(async () => {
    const data = await read<PublishingSnapshot>()
    setState(data)
    setSchedulePreviewNow(Date.now())
  }, [])
  useEffect(() => {
    let active = true
    const update = () =>
      read<PublishingSnapshot>()
        .then((data) => {
          if (active) {
            setState(data)
            setSchedulePreviewNow(Date.now())
          }
        })
        .catch((e) => {
          if (active) setError(e.message)
        })
    void update()
    const timer = setInterval(() => void update(), 2500)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])
  const loadArticle = useCallback(
    async (id: string) => {
      const a = await read<PublishingArticle>("article.get", id)
      setEditId(a.id)
      setTitle(a.title)
      setMarkdown(a.markdown || "")
      setContentType(a.metadata?.contentType||"article")
      setAssetIds(a.metadata?.assetIds||[])
      setCoverAssetId(a.metadata?.coverAssetId||"")
      setWechatEntries((a.metadata?.entries||[]).slice(1).map(e=>({title:e.title,markdown:e.markdown,coverAssetId:e.coverAssetId||""})))
      setTags(a.metadata?.tags?.join("，") || "")
      setDigest(a.metadata?.digest || "")
      setCover(a.metadata?.coverUrl || "")
      setOriginal(!!a.metadata?.original)
      setOptions(JSON.stringify(a.metadata?.platformOptions || {}, null, 2))
      setArticles((v) => (v.includes(id) ? v : [...v, id]))
      setTab("articles")
      setEditing(true)
      setPreview(false)
    },
    [setArticles, setTab],
  )
  async function convertToImageText(id:string){
    const source=await read<PublishingArticle>("article.get",id)
    const embedded=[...String(source.markdown||"").matchAll(/local-asset:([A-Za-z0-9_-]+)/g)].map(match=>match[1])
    setEditId("");setContentType("imageText");setTitle(source.title);setMarkdown(source.markdown||"")
    setAssetIds([...new Set([...(source.metadata?.assetIds||[]),...embedded])])
    setCoverAssetId(source.metadata?.coverAssetId||"");setCover(source.metadata?.coverUrl||"")
    setTags(source.metadata?.tags?.join("，")||"");setDigest(source.metadata?.digest||"")
    setOriginal(!!source.metadata?.original);setOptions(JSON.stringify(source.metadata?.platformOptions||{},null,2))
    setEditing(true);setTab("articles");setPreview(false)
    setNotice("已从文章建立图文副本；请检查图片顺序并另存为新内容")
  }
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("article")
    if (id)
      void Promise.resolve()
        .then(() => loadArticle(id))
        .catch((e) => setError(e.message))
  }, [loadArticle])
  useEffect(() => {
    if (!loginId) return
    let active = true,
      inflight = false
    const update = async () => {
      if (inflight) return
      inflight = true
      try {
        const result = await read<LoginSnapshot>("login.snapshot", loginId)
        if (active) setFrame({ id: loginId, data: result })
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "登录画面读取失败")
      } finally {
        inflight = false
      }
    }
    void update()
    const timer = setInterval(() => void update(), 1500)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [loginId])
  async function perform(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError("")
    setNotice("")
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败")
    } finally {
      setBusy(false)
    }
  }
  async function openLogin(id: string) {
    await send("login.open", { id })
    setLoginId(id)
    setInputText("")
  }
  async function addAccount(startLogin: boolean) {
    const a = await send<{ id: string }>("account.add", { platform, label })
    setLabel("")
    setAccounts((v) => [...v, a.id])
    setAuthOpen(false)
    setTab("accounts")
    if (startLogin) await openLogin(a.id)
    else setNotice("账号已加入工作台；需要验证或保存平台草稿时再登录")
  }
  async function interact(input: Record<string, unknown>) {
    await send("login.interact", { id: loginId, ...input })
  }
  async function saveArticle() {
    let platformOptions: unknown
    try {
      platformOptions = JSON.parse(options)
    } catch {
      throw new Error("平台补充选项需要是 JSON 对象")
    }
    const a = await send<PublishingArticle>("article.save", {
      id: editId || undefined,
      title,
      markdown,
      metadata: {
        tags: tags
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean),
        digest,
        contentType,
        assetIds,
        coverAssetId,
        entries:contentType==="wechat"?[{title,markdown,coverAssetId},...wechatEntries]:undefined,
        coverUrl: cover,
        original,
        platformOptions,
      },
    })
    setEditId(a.id)
    setArticles((v) => (v.includes(a.id) ? v : [...v, a.id]))
    setNotice(`${contentNames[contentType]}已保存在本机并加入本次分发选择`)
  }
  function platformOption(key:string){
    try{return String((JSON.parse(options)?.[settingPlatform]||{})[key]||"")}catch{return ""}
  }
  function setPlatformOption(key:string,value:string){
    let all:Record<string,Record<string,unknown>>={}
    try{all=JSON.parse(options)||{}}catch{throw new Error("请先修正平台高级 JSON 设置")}
    const current={...(all[settingPlatform]||{})};if(value)current[key]=value;else delete current[key]
    if(Object.keys(current).length)all[settingPlatform]=current;else delete all[settingPlatform]
    setOptions(JSON.stringify(all,null,2))
  }
  async function uploadAsset(file:File,kind:PublishingAsset["kind"]){
    const form=new FormData();form.set("file",file);form.set("kind",kind)
    const response=await fetch(`${endpoint}/assets`,{method:"POST",body:form})
    const data=await response.json()
    if(!response.ok)throw new Error(data.error||"素材上传失败")
    setNotice(`${file.name} 已加入本机素材库`)
    return data.asset as PublishingAsset
  }
  async function postArticleFiles(files:File[],mode:"preview"|"import") {
    const form = new FormData()
    form.set("mode",mode)
    for (const file of files) form.append("files",file)
    return importRequest<{
      items:Array<FileImportPreview & { article?:PublishingArticle; status?:string }>;
      importedCount?:number; reusedCount?:number
    }>(`${endpoint}/import/files`,{method:"POST",body:form})
  }
  async function previewArticleFiles(files:File[]) {
    if (!files.length) return
    setPicker(null)
    setFileImportFiles(files)
    setFileImportPreviews([])
    setFileImportSelected([])
    setFileImportOpen(true)
    setImportBusy(true)
    setImportError("")
    try {
      const result = await postArticleFiles(files,"preview")
      setFileImportPreviews(result.items)
      setFileImportSelected(result.items.map((_,index)=>index))
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "文章文件预览失败")
    } finally {
      setImportBusy(false)
    }
  }
  async function confirmArticleFiles() {
    if (!fileImportSelected.length || importBusy) return
    setImportBusy(true)
    setImportError("")
    try {
      const result = await postArticleFiles(fileImportSelected.map(index=>fileImportFiles[index]),"import")
      const ids = result.items.map(item=>item.article?.id).filter((id):id is string=>Boolean(id))
      if (ids.length !== result.items.length) throw new Error("部分文章导入结果缺少编号，请刷新内容库核对")
      setArticles(previous=>[...new Set([...previous,...ids])])
      await refresh()
      setArticlePage(1)
      setTab("articles")
      setEditing(false)
      setFileImportOpen(false)
      setFileImportFiles([])
      setFileImportPreviews([])
      setFileImportSelected([])
      setNotice(`已导入 ${result.items.length} 篇文章并加入分发选择；新导入 ${result.importedCount||0} 篇，复用 ${result.reusedCount||0} 篇。请检查正文后再创建任务。`)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "文章文件导入失败")
    } finally {
      setImportBusy(false)
    }
  }
  async function openProductionImport() {
    setPicker(null)
    setProductionImportOpen(true)
    setProductionClientId("")
    setProductionBatches([])
    setProductionRuns([])
    setProductionBatch(null)
    setProductionIds([])
    setProductionVariant("original")
    setProductionPreview(null)
    setImportBusy(true)
    setImportError("")
    try {
      const result = await importRequest<{clients:ProductionClient[]}>(`${endpoint}/import`)
      setProductionClients(result.clients)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "读取内容生产客户失败")
    } finally {
      setImportBusy(false)
    }
  }
  async function selectProductionClient(id:string) {
    setProductionClientId(id)
    setProductionBatches([])
    setProductionRuns([])
    setProductionBatch(null)
    setProductionIds([])
    setProductionPreview(null)
    setImportError("")
    if (!id) return
    setImportBusy(true)
    try {
      const client = productionClients.find(item=>item.id===id)
      const query = new URLSearchParams({clientId:id})
      if (client?.teamId) query.set("teamId",client.teamId)
      const result = await importRequest<{batches:ProductionBatch[];runs?:ProductionBatch[]}>(`${endpoint}/import?${query}`)
      setProductionBatches(result.batches)
      setProductionRuns((result.runs||[]).map(run=>({...run,kind:"production_run",promptTitle:"按计划生产"})))
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "读取文章批次失败")
    } finally {
      setImportBusy(false)
    }
  }
  async function selectProductionBatch(id:string) {
    setProductionBatch(null)
    setProductionIds([])
    setProductionPreview(null)
    setImportError("")
    if (!id) return
    if (id.startsWith("run:")) {
      setProductionVariant("original")
      setProductionBatch(productionRuns.find(run=>run.id===id.slice(4))||null)
      return
    }
    setImportBusy(true)
    try {
      const result = await importRequest<{batch:ProductionBatch}>(`${endpoint}/import?batchId=${encodeURIComponent(id.slice(6))}`)
      setProductionBatch(result.batch)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "读取批次文章失败")
    } finally {
      setImportBusy(false)
    }
  }
  function productionItemReady(item:ProductionBatch["items"][number],variant=productionVariant) {
    if (productionBatch?.kind==="production_run") return item.hasDraft && ["ready","review_required"].includes(item.status)
    return item.hasDraft && !["queued","running","word_processing"].includes(item.status)
      && (variant==="original" || item.hasMediaVersion)
  }
  async function previewProductionArticle(id:string) {
    if (!productionBatch) return
    setImportBusy(true)
    setImportError("")
    try {
      if (productionBatch.kind==="production_run") {
        const query = new URLSearchParams({runId:productionBatch.id,itemId:id,clientId:productionClientId})
        const teamId = productionClients.find(client=>client.id===productionClientId)?.teamId
        if (teamId) query.set("teamId",teamId)
        const result = await importRequest<{preview:ProductionArticlePreview}>(`${endpoint}/import?${query}`)
        setProductionPreview(result.preview)
      } else {
        const result = await importRequest<ProductionArticlePreview>(`/api/article-generation/batches/${encodeURIComponent(productionBatch.id)}/items/${encodeURIComponent(id)}`)
        setProductionPreview(result)
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "读取文章正文失败")
    } finally {
      setImportBusy(false)
    }
  }
  async function confirmProductionArticles() {
    if (!productionBatch || !productionIds.length || importBusy) return
    setImportBusy(true)
    setImportError("")
    try {
      const teamId = productionClients.find(client=>client.id===productionClientId)?.teamId
      const result = await importRequest<{articleIds:string[];reused:number;warnings:string[]}>(`${endpoint}/import`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(productionBatch.kind==="production_run"
          ? {kind:"production_run",runId:productionBatch.id,clientId:productionClientId,teamId,itemIds:productionIds}
          : {kind:"batch",batchId:productionBatch.id,itemIds:productionIds,variant:productionVariant}),
      })
      setArticles(previous=>[...new Set([...previous,...result.articleIds])])
      await refresh()
      setArticlePage(1)
      setTab("articles")
      setEditing(false)
      setProductionImportOpen(false)
      setNotice(`已从内容生产导入 ${result.articleIds.length} 篇并加入分发选择；复用 ${result.reused} 篇。${result.warnings.length ? `其中 ${result.warnings.length} 篇待质量复核，请检查正文。` : "请检查正文后再创建任务。"}`)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "内容生产文章导入失败")
    } finally {
      setImportBusy(false)
    }
  }
  async function createBatch() {
    const input = {
      accountIds: accounts,
      articleIds: articles,
      mode,
      scheduledAt: schedule ? new Date(schedule).getTime() : undefined,
      intervalMinutes,dailyLimit,
      overrides,
    }
    const fingerprint = JSON.stringify({
      ...input,
      accountIds: [...accounts].sort(),
      articleIds: [...articles].sort(),
    })
    if (batchKey.current?.fingerprint !== fingerprint)
      batchKey.current = { fingerprint, key: crypto.randomUUID() }
    const check=await send<{ok:boolean;errors:Array<{message:string}>;warnings:Array<{message:string}>}>("batch.preflight",input)
    setPreflight(check)
    if(!check.ok)throw new Error(`预检发现 ${check.errors.length} 项问题，请查看页面提示`)
    const result = await send<{ reused: boolean }>("batch.create", {
      ...input,
      requestKey: batchKey.current.key,
    })
    setNotice(
      result.reused
        ? "这个批次已经提交，已找回原记录"
        : "分发批次已创建，页面关闭后仍由本机服务执行",
    )
    setTab("tasks")
    setComposing(false)
    setTaskPage(1)
  }
  const platformName = (id: string) => state?.platforms.find((p) => p.id === id)?.name || id
  const screen = frame?.id === loginId ? frame.data : null
  const currentAccount = state?.accounts.find((a) => a.id === loginId)
  const accountList = (state?.accounts || []).filter(
    (a) =>
      (!accountPlatform || a.platform === accountPlatform) &&
      (!accountStatus || a.state === accountStatus) &&
      (!accountGroup || a.group_name === accountGroup) &&
      `${a.label} ${a.remote_name} ${platformName(a.platform)}`
        .toLowerCase()
        .includes(accountSearch.toLowerCase()),
  )
  const articleList = (state?.articles || []).filter((a) =>
    a.title.toLowerCase().includes(articleSearch.toLowerCase()),
  )
  const taskList = (state?.tasks || []).filter(
    (t) =>
      (!taskStatus || t.state === taskStatus) &&
      (!taskMode || t.mode === taskMode) &&
      `${t.title} ${t.account_name}`.toLowerCase().includes(taskSearch.toLowerCase()),
  )
  const pageItems = <T,>(items: T[], page: number) =>
    items.slice(
      (Math.min(page, Math.max(1, Math.ceil(items.length / 10))) - 1) * 10,
      Math.min(page, Math.max(1, Math.ceil(items.length / 10))) * 10,
    )
  const selectedAccounts = state?.accounts.filter((a) => accounts.includes(a.id)) || []
  const selectedArticles = state?.articles.filter((a) => articles.includes(a.id)) || []
  function setVariant(accountId:string,contentId:string,change:ContentOverride){
    setOverrides(previous=>({...previous,[accountId]:{...(previous[accountId]||{}),[contentId]:{
      ...(previous[accountId]?.[contentId]||{}),...change,
      metadata:{...(previous[accountId]?.[contentId]?.metadata||{}),...(change.metadata||{})},
    }}}))
    setPreflight(null)
  }
  function loadDraft(draft:NonNullable<PublishingSnapshot["drafts"]>[number]){
    setDraftId(draft.id);setDraftName(draft.name)
    setAccounts(draft.payload.accountIds);setArticles(draft.payload.articleIds)
    setOverrides(draft.payload.overrides||{})
    setSchedule(draft.payload.scheduledAt?datetimeLocal(draft.payload.scheduledAt):"")
    setIntervalMinutes(draft.payload.intervalMinutes||0);setDailyLimit(draft.payload.dailyLimit||0)
    setMode("draft");setPreflight(null);setTab("tasks");setComposing(true)
  }
  const isComposer = tab === "tasks" && composing
  function newArticle() {
    if (busy) return
    setNotice("")
    setError("")
    setEditId("")
    setTitle("")
    setMarkdown("")
    setContentType("article")
    setAssetIds([])
    setCoverAssetId("")
    setWechatEntries([])
    setTags("")
    setDigest("")
    setCover("")
    setOptions("{}")
    setOriginal(false)
    setPreview(false)
    setEditing(true)
    setTab("articles")
  }
  function openPicker(kind: "accounts" | "articles") {
    setPickerSearch("")
    setPicker(kind)
  }
  function format(before: string, after = "") {
    const input = editorRef.current
    if (!input) return
    const start = input.selectionStart,
      end = input.selectionEnd,
      selected = markdown.slice(start, end)
    setMarkdown(markdown.slice(0, start) + before + selected + after + markdown.slice(end))
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }
  const accountIdentity = (a: PublishingAccount) => (
    <div className={s.identity}>
      <PlatformMark name={platformName(a.platform)} platform={a.platform} />
      <div>
        <b>{a.label}</b>
        <small>
          {platformName(a.platform)}
          {a.remote_name ? ` · ${a.remote_name}` : ""}
          {a.group_name ? ` · ${a.group_name}` : ""}
        </small>
      </div>
    </div>
  )
  const accountActions = (a: PublishingAccount) => (
    <div className={s.actions}>
      <button
        className={s.textButton}
        disabled={busy}
        onClick={() => void perform(() => openLogin(a.id))}
      >
        {a.state === "ready" ? "打开账号窗口" : "扫码 / 登录"}
      </button>
      <details className={s.more}>
        <summary aria-label={`${a.label} 更多操作`}>
          <MoreHorizontal size={18} />
        </summary>
        <div>
          <form className={s.groupForm} onSubmit={e=>{e.preventDefault();const field=e.currentTarget.elements.namedItem("groupName") as HTMLInputElement;void perform(async()=>{await send("account.group",{id:a.id,groupName:field.value});setNotice("账号分组已更新")})}}>
            <input name="groupName" aria-label={`${a.label} 所属分组`} defaultValue={a.group_name} placeholder="输入分组名称" maxLength={60}/>
            <button type="submit" disabled={busy}>保存分组</button>
          </form>
          <button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await send("account.logout", { id: a.id })
              })
            }
          >
            退出登录
          </button>
          {!state?.tasks.some((t) => t.account_id === a.id) && (
            <button
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await send("account.remove", { id: a.id })
                  setAccounts((v) => v.filter((id) => id !== a.id))
                })
              }
            >
              移除账号
            </button>
          )}
        </div>
      </details>
    </div>
  )
  return (
    <main className={`${s.page} ${isComposer ? s.composerShell : ""}`}>
      <aside className={s.sidebar}>
        <Link href="/workspace" className={s.brand} title="返回 GEO 工作台">
          <Image src="/brand/shitu-lockup.jpg" alt="势途 Logo" width={36} height={42} sizes="36px" loading="eager" />
          <div>
            势途 GEO<small>内容分发工作台</small>
          </div>
        </Link>
        <div className={s.team}>
          <span className={s.avatar}>{userName.slice(0, 1).toUpperCase()}</span>
          <div>
            <b>我的工作空间</b>
            <small>{userName}</small>
          </div>
        </div>
        <nav aria-label="分发功能">
          <button
            className={tab === "tasks" ? s.navActive : ""}
            onClick={() => {
              setTab("tasks")
              setComposing(false)
            }}
          >
            <Send size={18} />
            <span>发布</span>
          </button>
          <button
            className={tab === "accounts" ? s.navActive : ""}
            onClick={() => setTab("accounts")}
          >
            <Users size={18} />
            <span>账号</span>
          </button>
          <button
            className={tab === "articles" ? s.navActive : ""}
            onClick={() => {
              setTab("articles")
              setEditing(false)
            }}
          >
            <FileText size={18} />
            <span>内容库</span>
          </button>
          <button className={tab === "assets" ? s.navActive : ""} onClick={() => setTab("assets")}>
            <LayoutGrid size={18} />
            <span>多媒体素材</span>
          </button>
          <button
            className={tab === "platforms" ? s.navActive : ""}
            onClick={() => setTab("platforms")}
          >
            <ShieldCheck size={18} />
            <span>平台状态</span>
          </button>
        </nav>
        <div className={s.sidebarFoot}>
          <Link href="/workspace">
            <ArrowLeft size={15} />
            <span>返回 GEO 工作台</span>
          </Link>
          <p>
            <span className={state?.runtime.running ? s.dot : s.offDot} />
            <span>{state?.runtime.running ? "分发执行器已连接" : "连接执行器…"}</span>
          </p>
          <small>独立运行 · 由 GEO 管理</small>
        </div>
      </aside>
      <div className={s.workspace}>
        <header className={s.topbar}>
          <div className={s.topTabs}>
            <PanelLeftClose size={17} className={s.headerIcon} />
            {tab === "accounts" ? (
              <>
                <h1>账号管理</h1>
                <button onClick={() => setTab("platforms")}>平台验证状态</button>
              </>
            ) : tab === "articles" ? (
              <>
                <button className={!editing ? s.topActive : ""} onClick={() => setEditing(false)}>
                  内容库 <span>{state?.articles.length || 0}</span>
                </button>
                <button className={editing ? s.topActive : ""} onClick={() => setEditing(true)}>
                  {editId ? "编辑内容" : "新建内容"}
                </button>
              </>
            ) : tab === "assets" ? (
              <h1>多媒体素材库</h1>
            ) : tab === "tasks" ? (
              <>
                <button
                  className={!composing ? s.topActive : ""}
                  onClick={() => setComposing(false)}
                >
                  发布记录
                </button>
                <button className={composing ? s.topActive : ""} onClick={() => setComposing(true)}>
                  批量分发
                </button>
              </>
            ) : (
              <h1>平台状态</h1>
            )}
          </div>
          <div className={s.topUtilities}>
            <span>
              <Monitor size={16} />
              <i className={state?.runtime.running ? s.dot : s.offDot} />
              <span>本机已连接</span>
            </span>
            <button
              title={state?.paused ? "恢复自动执行" : "暂停后新任务会等待恢复"}
              disabled={busy || !state}
              onClick={() =>
                void perform(async () => {
                  await send("queue.pause", { paused: !state?.paused })
                })
              }
            >
              {state?.paused ? "恢复队列" : "暂停队列"}
            </button>
          </div>
        </header>
        <div className={s.content}>
          {error && !authOpen && (
            <div role="alert" className={s.error}>
              {error}
              <button aria-label="关闭错误" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className={s.notice}>
              <Check size={16} />
              <span>{notice}</span>
              <button aria-label="关闭提示" onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {!state && <div className={s.empty}>正在读取账号和任务…</div>}
          {tab === "accounts" && (
            <div className={s.accountLayout}>
              <aside className={s.filters}>
                <h2>平台</h2>
                <button
                  className={!accountPlatform ? s.filterActive : ""}
                  onClick={() => {
                    setAccountPlatform("")
                    setAccountPage(1)
                  }}
                >
                  <span>全部平台</span>
                  <b>{state?.accounts.length || 0}</b>
                </button>
                {state?.platforms
                  .filter((p) => state.accounts.some((a) => a.platform === p.id))
                  .map((p) => (
                    <button
                      key={p.id}
                      className={accountPlatform === p.id ? s.filterActive : ""}
                      onClick={() => {
                        setAccountPlatform(p.id)
                        setAccountPage(1)
                      }}
                    >
                      <span>
                        <PlatformMark name={p.name} platform={p.id} small />
                        {p.name}
                      </span>
                      <b>{state.accounts.filter((a) => a.platform === p.id).length}</b>
                    </button>
                  ))}
                <div className={s.filterDivider} />
                <h2>登录状态</h2>
                {[
                  ["", "全部状态"],
                  ["ready", "正常"],
                  ["needs_login", "待登录 / 已失效"],
                ].map(([key, name]) => (
                  <button
                    key={key}
                    className={accountStatus === key ? s.filterActive : ""}
                    onClick={() => {
                      setAccountStatus(key)
                      setAccountPage(1)
                    }}
                  >
                    <span>{name}</span>
                    <b>{state?.accounts.filter((a) => !key || a.state === key).length || 0}</b>
                  </button>
                ))}
                <div className={s.filterDivider} />
                <h2>账号分组</h2>
                {["",...[...new Set((state?.accounts||[]).map(a=>a.group_name).filter(Boolean))]].map(group=><button key={group||"all"} className={accountGroup===group?s.filterActive:""} onClick={()=>{setAccountGroup(group);setAccountPage(1)}}>
                  <span>{group||"全部分组"}</span><b>{(state?.accounts||[]).filter(a=>!group||a.group_name===group).length}</b>
                </button>)}
                <div className={s.filterNote}>
                  <ShieldCheck size={17} />
                  <p>
                    每个账号独立登录
                    <br />
                    登录状态加密保存在本机
                  </p>
                </div>
              </aside>
              <section className={s.accountsPanel}>
                <div className={s.listToolbar}>
                  <label className={s.search}>
                    <Search size={16} />
                    <input
                      aria-label="搜索账号"
                      placeholder="搜索账号名称"
                      value={accountSearch}
                      onChange={(e) => {
                        setAccountSearch(e.target.value)
                        setAccountPage(1)
                      }}
                    />
                  </label>
                  <div className={s.actions}>
                    <div className={s.viewSwitch}>
                      <button
                        aria-label="宫格视图"
                        aria-pressed={grid}
                        onClick={() => setGrid(true)}
                      >
                        <LayoutGrid size={16} />
                      </button>
                      <button
                        aria-label="列表视图"
                        aria-pressed={!grid}
                        onClick={() => setGrid(false)}
                      >
                        <List size={16} />
                      </button>
                    </div>
                    <button
                      disabled={busy || !accounts.length}
                      onClick={() =>
                        void perform(async () => {
                          for (const id of accounts.slice(0, 5)) await openLogin(id)
                          setNotice("已打开选中账号的登录窗口，请依次完成平台认证")
                        })
                      }
                    >
                      批量登录{accounts.length ? ` (${accounts.length})` : ""}
                    </button>
                    <button className={s.primary} onClick={() => setAuthOpen(true)}>
                      <Plus size={16} />
                      授权账号
                    </button>
                  </div>
                </div>
                {grid ? (
                  <div className={s.accountGrid}>
                    {pageItems(accountList, accountPage).map((a) => (
                      <article key={a.id} className={s.accountCard}>
                        <div className={s.sectionHead}>
                          {accountIdentity(a)}
                          <input
                            aria-label={`选择账号 ${a.label}`}
                            type="checkbox"
                            checked={accounts.includes(a.id)}
                            onChange={() => setAccounts((v) => toggle(v, a.id))}
                          />
                        </div>
                        <p className={a.state === "ready" ? s.good : s.danger}>
                          {a.state === "ready" ? "● 正常" : "● 待登录 / 已失效"}
                        </p>
                        <small>
                          {a.checked_at ? `最近检查 ${time(a.checked_at)}` : "尚未连接平台"}
                        </small>
                        {accountActions(a)}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className={s.tableWrap}>
                    <table>
                      <thead>
                        <tr>
                          <th>
                            <input
                              aria-label="选择当前页全部账号"
                              type="checkbox"
                              checked={
                                !!accountList.length &&
                                pageItems(accountList, accountPage).every((a) =>
                                  accounts.includes(a.id),
                                )
                              }
                              onChange={(e) =>
                                setAccounts((v) =>
                                  e.target.checked
                                    ? Array.from(
                                        new Set([
                                          ...v,
                                          ...pageItems(accountList, accountPage).map((a) => a.id),
                                        ]),
                                      )
                                    : v.filter(
                                        (id) =>
                                          !pageItems(accountList, accountPage).some(
                                            (a) => a.id === id,
                                          ),
                                      ),
                                )
                              }
                            />
                          </th>
                          <th>账号信息</th>
                          <th>登录状态</th>
                          <th>最近检查</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageItems(accountList, accountPage).map((a) => (
                          <tr key={a.id}>
                            <td>
                              <input
                                aria-label={`选择账号 ${a.label}`}
                                type="checkbox"
                                checked={accounts.includes(a.id)}
                                onChange={() => setAccounts((v) => toggle(v, a.id))}
                              />
                            </td>
                            <td>{accountIdentity(a)}</td>
                            <td>
                              <span className={a.state === "ready" ? s.good : s.danger}>
                                {a.state === "ready" ? "正常" : statusNames[a.state] || a.state}
                              </span>
                              {a.error && <small className={s.errorText}>{a.error}</small>}
                            </td>
                            <td className={s.muted}>{a.checked_at ? time(a.checked_at) : "—"}</td>
                            <td>{accountActions(a)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {!accountList.length && (
                  <div className={s.empty}>
                    <Users size={30} />
                    <p>
                      {state?.accounts.length
                        ? "没有符合筛选条件的账号"
                        : "添加第一个分发账号，扫码后即可保存草稿"}
                    </p>
                    <button onClick={() => setAuthOpen(true)}>添加账号</button>
                  </div>
                )}
                <Pagination
                  page={accountPage}
                  total={accountList.length}
                  onChange={setAccountPage}
                />
                {!!state?.loginWindows.length && (
                  <div className={s.windowList}>
                    登录窗口：
                    {state.loginWindows.map((w) => (
                      <button key={w.id} onClick={() => setLoginId(w.id)}>
                        {state.accounts.find((a) => a.id === w.id)?.label}
                      </button>
                    ))}
                  </div>
                )}
                <details className={s.demo}>
                  <summary>本地演示与故障恢复测试</summary>
                  <p>
                    演示平台账号使用 2–40 位字母数字，密码 <code>demo1234</code>。记录只保存在本机。
                  </p>
                  {state?.accounts
                    .filter((a) => a.platform === "DEMO_CSDN" && a.remote_id)
                    .map((a) => (
                      <div key={a.id} className={s.actions}>
                        <b>{a.label}</b>
                        {[
                          ["expire", "模拟登录过期"],
                          ["quota", "模拟限流 12 秒"],
                          ["drop", "模拟提交后断网"],
                          ["restore", "恢复演示接口"],
                        ].map(([kind, name]) => (
                          <button
                            key={kind}
                            disabled={busy}
                            onClick={() =>
                              void perform(async () => {
                                await send("demo.fault", { id: a.id, kind })
                                setNotice(`${name}已设置；下一次任务将触发对应处理`)
                              })
                            }
                          >
                            {name}
                          </button>
                        ))}
                        <button
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => setDemoPosts(await read("demo.posts", a.id)))
                          }
                        >
                          核对演示平台文章
                        </button>
                      </div>
                    ))}
                  {!!demoPosts.length && (
                    <ul>
                      {demoPosts.map((p) => (
                        <li key={p.id}>
                          编号 {p.id} · {p.title} · {p.status === "64" ? "已发布" : "草稿"}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </section>
            </div>
          )}
          {tab === "articles" && !editing && (
            <section className={s.library}>
              <div className={s.listToolbar}>
                <label className={s.search}>
                  <Search size={16} />
                  <input
                    aria-label="搜索文章"
                    placeholder="搜索文章标题"
                    value={articleSearch}
                    onChange={(e) => {
                      setArticleSearch(e.target.value)
                      setArticlePage(1)
                    }}
                  />
                </label>
                <div className={s.actions}>
                  <button disabled={busy || importBusy} onClick={() => void openProductionImport()}>
                    从内容生产导入
                  </button>
                  <label className={s.fileChoose}>
                    <Upload size={15} /> 上传文章文件
                    <input type="file" accept=".md,.txt,.docx" multiple disabled={busy || importBusy}
                      onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value="";void previewArticleFiles(files)}} />
                  </label>
                  <button
                    disabled={!articles.length}
                    onClick={() => {
                      setTab("tasks")
                      setComposing(true)
                    }}
                  >
                    批量分发{articles.length ? ` (${articles.length})` : ""}
                    <ArrowRight size={15} />
                  </button>
                  <button className={s.primary} disabled={busy} onClick={newArticle}>
                    <Plus size={16} />
                    新建文章
                  </button>
                </div>
              </div>
              <div className={s.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>选择</th>
                      <th>内容素材</th>
                      <th>类型</th>
                      <th>版本</th>
                      <th>更新时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems(articleList, articlePage).map((a) => (
                      <tr key={a.id}>
                        <td>
                          <input
                            aria-label={`选择文章 ${a.title}`}
                            type="checkbox"
                            checked={articles.includes(a.id)}
                            onChange={() => setArticles((v) => toggle(v, a.id))}
                          />
                        </td>
                        <td>
                          <div className={s.identity}>
                            <span className={s.fileIcon}>
                              <FileText size={21} />
                            </span>
                            <button
                              className={s.articleTitle}
                              onClick={() => void perform(() => loadArticle(a.id))}
                            >
                              {a.title}
                            </button>
                          </div>
                        </td>
                        <td>{contentNames[a.contentType||"article"]}</td>
                        <td>v{a.version}</td>
                        <td className={s.muted}>{time(a.updated_at)}</td>
                        <td>
                          <button
                            className={s.textButton}
                            onClick={() => void perform(() => loadArticle(a.id))}
                          >
                            编辑内容
                          </button>
                          {(a.contentType||"article")==="article"&&<button className={s.textButton} onClick={()=>void perform(()=>convertToImageText(a.id))}>转图文副本</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!articleList.length && (
                <div className={s.empty}>
                  <FileText size={30} />
                  <p>还没有符合条件的内容</p>
                  <button disabled={busy} onClick={newArticle}>
                    新建内容
                  </button>
                </div>
              )}
              <Pagination page={articlePage} total={articleList.length} onChange={setArticlePage} />
              <p className={s.hint}>
                可从内容生产导入，也可上传 Markdown、TXT、Word 文章文件；平台草稿的执行结果可在“发布记录”中查看。
              </p>
            </section>
          )}
          {tab === "articles" && editing && (
            <div className={s.editLayout}>
              <section className={s.editorCard}>
                <div className={s.editorHeading}>
                  <h2>{editId ? `编辑${contentNames[contentType]}` : `新建${contentNames[contentType]}`}</h2>
                  <div className={s.actions}>
                    <button onClick={() => setPreview((v) => !v)}>
                      {preview ? "继续编辑" : "预览"}
                    </button>
                    <button
                      className={s.primary}
                      disabled={busy || !title.trim() || (["article","imageText","dynamic","wechat"].includes(contentType)&&!markdown.trim())}
                      onClick={() => void perform(saveArticle)}
                    >
                      保存到本机并选择
                    </button>
                  </div>
                </div>
                <label className={s.contentTypeField}>内容类型
                  <select value={contentType} onChange={e=>{setContentType(e.target.value as PublishingContentType);setAssetIds([])}}>
                    {Object.entries(contentNames).map(([key,name])=><option key={key} value={key}>{name}</option>)}
                  </select>
                </label>
                <label className={s.titleField}>
                  <span className={s.srOnly}>标题</span>
                  <input
                    required
                    maxLength={200}
                    placeholder={`请输入${contentNames[contentType]}标题`}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <div className={s.formatbar}>
                  <span>{contentType==="video"||contentType==="audio"?"介绍文案":"正文"}</span>
                  {[
                    [Bold, "加粗", "**", "**"],
                    [Italic, "斜体", "*", "*"],
                    [Heading2, "二级标题", "## ", ""],
                    [List, "项目列表", "- ", ""],
                    [Quote, "引用", "> ", ""],
                    [Link2, "插入链接", "[", "](https://)"],
                  ].map(([Icon, name, before, after]) => {
                    const Tool = Icon as typeof Bold
                    return (
                      <button
                        key={name as string}
                        aria-label={name as string}
                        title={name as string}
                        disabled={preview}
                        onClick={() => format(before as string, after as string)}
                      >
                        <Tool size={16} />
                      </button>
                    )
                  })}
                  <small>Markdown</small>
                </div>
                {preview ? (
                  <div className={s.markdown}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url=>
                      /^local-asset:[A-Za-z0-9_-]+$/.test(url)
                        ? `${endpoint}/assets/${url.slice("local-asset:".length)}`
                        : defaultUrlTransform(url)}>
                      {markdown || "在编辑区输入正文后，即可查看排版。"}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <textarea
                    ref={editorRef}
                    className={s.bodyField}
                    aria-label="正文（支持 Markdown）"
                    placeholder={contentType==="video"||contentType==="audio"?"输入内容介绍（可选）…":"输入或粘贴内容正文…"}
                    value={markdown}
                    onChange={(e) => setMarkdown(e.target.value)}
                  />
                )}
                <div className={s.editorFoot}>
                  <span>
                    正文 {markdown.length} 字符
                    {editId
                      ? ` · 本地版本 v${state?.articles.find((a) => a.id === editId)?.version || 1}`
                      : " · 尚未保存"}
                  </span>
                  <button
                    className={s.textButton}
                    disabled={busy || !title.trim() || (["article","imageText","dynamic","wechat"].includes(contentType)&&!markdown.trim())}
                    onClick={() =>
                      void perform(async () => {
                        await saveArticle()
                        setTab("tasks")
                        setComposing(true)
                      })
                    }
                  >
                    保存并安排分发
                    <ArrowRight size={15} />
                  </button>
                </div>
              </section>
              <aside className={s.articleSettings}>
                <h2>{contentNames[contentType]}设置</h2>
                <div className={s.mediaPicker}>
                  <strong>{contentType==="video"?"视频文件":contentType==="audio"?"音频文件":contentType==="imageText"?"图片组":"本机素材"}</strong>
                  <small>素材留在本机；平台草稿另需通过预检。</small>
                  <label className={s.fileChoose}>上传文件
                    <input type="file" accept={contentType==="video"?"video/mp4":contentType==="audio"?"audio/mpeg,audio/wav,audio/mp4": "image/jpeg,image/png,image/webp"}
                      onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;const kind=contentType==="video"?"video":contentType==="audio"?"audio":"image";void perform(async()=>{const asset=await uploadAsset(file,kind);if(contentType==="video"||contentType==="audio")setAssetIds([asset.id]);else setAssetIds(v=>[...v,asset.id])})}} />
                  </label>
                  <div className={s.mediaOptions}>
                    {(state?.assets||[]).filter(a=>a.kind===(contentType==="video"?"video":contentType==="audio"?"audio":"image")).map(a=><label key={a.id}>
                      <input type={contentType==="video"||contentType==="audio"?"radio":"checkbox"} name="content-assets" checked={assetIds.includes(a.id)}
                        onChange={()=>setAssetIds(v=>contentType==="video"||contentType==="audio"?[a.id]:toggle(v,a.id))}/>
                      {a.kind==="image"&&<img src={`${endpoint}/assets/${a.id}`} alt="" />}
                      <span>{a.name}</span>
                    </label>)}
                  </div>
                  {contentType==="imageText"&&assetIds.length>1&&<div className={s.assetOrder}>
                    <strong>图片顺序</strong>{assetIds.map((id,index)=><div key={id}>
                      <span>{index+1}. {state?.assets.find(a=>a.id===id)?.name||id}</span>
                      <button disabled={index===0} onClick={()=>setAssetIds(v=>{const copy=[...v];[copy[index-1],copy[index]]=[copy[index],copy[index-1]];return copy})}>上移</button>
                      <button disabled={index===assetIds.length-1} onClick={()=>setAssetIds(v=>{const copy=[...v];[copy[index+1],copy[index]]=[copy[index],copy[index+1]];return copy})}>下移</button>
                    </div>)}
                  </div>}
                  {!(state?.assets||[]).some(a=>a.kind===(contentType==="video"?"video":contentType==="audio"?"audio":"image"))&&<small>还没有对应素材，可先上传。</small>}
                  {contentType==="article"&&assetIds.length>0&&<button onClick={()=>{const asset=state?.assets.find(a=>a.id===assetIds[0]);if(asset){setMarkdown(v=>`${v}\n\n![${asset.name}](local-asset:${asset.id})\n`);setNotice("已插入图片；真实平台图片转存尚待验证")}}}>把首张选中图片插入正文</button>}
                </div>
                <label>本机封面图片
                  <select value={coverAssetId} onChange={e=>setCoverAssetId(e.target.value)}>
                    <option value="">不设置</option>
                    {(state?.assets||[]).filter(a=>a.kind==="image").map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
                {contentType==="wechat"&&<div className={s.wechatEntries}>
                  <strong>公众号多篇内容包（最多 8 篇）</strong>
                  <small>当前编辑区是第 1 篇；每篇都需选择封面，平台执行待验证。</small>
                  {wechatEntries.map((entry,index)=><div key={index}>
                    <label>第 {index+2} 篇标题<input value={entry.title} onChange={e=>setWechatEntries(v=>v.map((x,i)=>i===index?{...x,title:e.target.value}:x))}/></label>
                    <label>正文<textarea rows={4} value={entry.markdown} onChange={e=>setWechatEntries(v=>v.map((x,i)=>i===index?{...x,markdown:e.target.value}:x))}/></label>
                    <label>封面<select value={entry.coverAssetId} onChange={e=>setWechatEntries(v=>v.map((x,i)=>i===index?{...x,coverAssetId:e.target.value}:x))}><option value="">请选择封面</option>{(state?.assets||[]).filter(a=>a.kind==="image").map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
                    <button onClick={()=>setWechatEntries(v=>v.filter((_,i)=>i!==index))}>移除这篇</button>
                  </div>)}
                  <button disabled={wechatEntries.length>=7} onClick={()=>setWechatEntries(v=>[...v,{title:"",markdown:"",coverAssetId:""}])}>添加一篇</button>
                </div>}
                <label>
                  标签（逗号分隔）
                  <input
                    placeholder="例如：GEO，企业营销"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                  />
                </label>
                <label>
                  封面图片网址
                  <input
                    type="url"
                    placeholder="https://…"
                    value={cover}
                    onChange={(e) => setCover(e.target.value)}
                  />
                </label>
                <label>
                  摘要
                  <textarea
                    rows={4}
                    maxLength={300}
                    placeholder="简要介绍文章内容"
                    value={digest}
                    onChange={(e) => setDigest(e.target.value)}
                  />
                </label>
                <label className={s.check}>
                  <input
                    type="checkbox"
                    checked={original}
                    onChange={(e) => setOriginal(e.target.checked)}
                  />
                  这是原创文章
                </label>
                <details>
                  <summary>平台补充选项</summary>
                  <p className={s.hint}>按平台填写分类、栏目、专辑等字段；真实有效性仍以平台预检和回执为准。</p>
                  <div className={s.platformFields}>
                    <label>目标平台<span className={s.platformSelect}>
                      <PlatformMark name={platformName(settingPlatform)} platform={settingPlatform} small />
                      <select value={settingPlatform} onChange={e=>setSettingPlatform(e.target.value)}>
                      {(state?.platforms||[]).filter(p=>!p.demo&&!p.custom).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                    </select></span></label>
                    {(contentType==="audio"?[['album','专辑 / 播客编号']]:[['categoryId','分类编号'],['columnId','栏目编号'],['contentSourceUrl','原文 HTTPS 链接']]).map(([key,label])=><label key={key}>{label}<input value={platformOption(key)} onChange={e=>{try{setPlatformOption(key,e.target.value)}catch(error){setError(error instanceof Error?error.message:"平台设置格式错误")}}}/></label>)}
                  </div>
                  <p className={s.hint}>高级字段仍可在下方 JSON 中编辑；账号凭据和文件路径不允许填写。</p>
                  <textarea
                    aria-label="平台补充选项"
                    rows={5}
                    value={options}
                    onChange={(e) => setOptions(e.target.value)}
                  />
                </details>
                <p className={s.hint}>已创建的任务使用提交时的文章版本，修改素材后可创建新批次。</p>
                <button disabled={busy} onClick={newArticle}>
                  <Plus size={15} />
                  新建另一篇
                </button>
              </aside>
            </div>
          )}
          {tab === "tasks" && !composing && (
            <section className={s.records}>
              <div className={s.listToolbar}>
                <div className={s.recordFilters}>
                  <label className={s.search}>
                    <Search size={16} />
                    <input
                      aria-label="搜索任务"
                      placeholder="搜索文章标题或账号"
                      value={taskSearch}
                      onChange={(e) => {
                        setTaskSearch(e.target.value)
                        setTaskPage(1)
                      }}
                    />
                  </label>
                  <select
                    aria-label="任务状态"
                    value={taskStatus}
                    onChange={(e) => {
                      setTaskStatus(e.target.value)
                      setTaskPage(1)
                    }}
                  >
                    <option value="">全部任务状态</option>
                    {Object.entries(statusNames)
                      .filter(([key]) => !["ready", "needs_login"].includes(key))
                      .map(([key, name]) => (
                        <option key={key} value={key}>
                          {name}
                        </option>
                      ))}
                  </select>
                  <select
                    aria-label="筛选执行方式"
                    value={taskMode}
                    onChange={(e) => {
                      setTaskMode(e.target.value)
                      setTaskPage(1)
                    }}
                  >
                    <option value="">全部执行方式</option>
                    <option value="draft">保存平台草稿</option>
                    <option value="publish">提交发布</option>
                  </select>
                </div>
                <button className={s.primary} onClick={() => setComposing(true)}>
                  <Plus size={16} />
                  新增分发
                </button>
              </div>
              <div className={s.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>文章 / 账号</th>
                      <th>执行方式</th>
                      <th>状态</th>
                      <th>进度说明</th>
                      <th>更新时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems(taskList, taskPage).map((t) => (
                      <tr key={t.id} data-task-id={t.id}>
                        <td>
                          <div className={s.taskTitle}>{t.title}</div>
                          <small className={s.platformCaption}>
                            <PlatformMark name={platformName(t.platform)} platform={t.platform} small />
                            {t.account_name} · {platformName(t.platform)}
                          </small>
                        </td>
                        <td>
                          <span className={s.badge}>
                            {t.mode === "draft" ? "平台草稿" : "提交发布"}
                          </span>
                        </td>
                        <td>
                          <span
                            className={
                              ["published", "draft"].includes(t.state)
                                ? s.good
                                : ["failed", "rejected", "blocked", "needs_review"].includes(
                                      t.state,
                                    )
                                  ? s.danger
                                  : s.badge
                            }
                          >
                            {statusNames[t.state] || t.state}
                          </span>
                          <small>
                            尝试 {t.attempts} 次{t.remote_id ? ` · 编号 ${t.remote_id}` : ""}
                          </small>
                        </td>
                        <td className={s.taskMessage}>
                          {t.message}
                          {["queued", "retry_wait"].includes(t.state) && (
                            <small>下次执行：{time(t.next_run)}</small>
                          )}
                        </td>
                        <td className={s.date}>{time(t.updated_at)}</td>
                        <td>
                          <div className={s.actions}>
                            {["queued", "retry_wait", "waiting_login"].includes(t.state) && (
                              <button
                                className={s.textButton}
                                disabled={busy}
                                onClick={() =>
                                  void perform(async () => {
                                    await send("task.action", { id: t.id, action: "cancel" })
                                  })
                                }
                              >
                                取消
                              </button>
                            )}
                            {["needs_review", "audit_pending", "submitted"].includes(t.state) && (
                              <button
                                className={s.textButton}
                                onClick={() => {
                                  setReview(t)
                                  setRemoteId(t.remote_id || "")
                                  setConfirmed(false)
                                }}
                              >
                                核对结果
                              </button>
                            )}
                            {["failed", "rejected", "blocked"].includes(t.state) && (
                              <button
                                className={s.textButton}
                                disabled={busy}
                                onClick={() =>
                                  void perform(async () => {
                                    await send("task.action", { id: t.id, action: "retry" })
                                  })
                                }
                              >
                                重试
                              </button>
                            )}
                            {t.state === "waiting_login" && (
                              <button
                                className={s.textButton}
                                disabled={busy}
                                onClick={() => void perform(() => openLogin(t.account_id))}
                              >
                                重新登录
                              </button>
                            )}
                            <button className={s.textButton} onClick={()=>{
                              const batch=state?.tasks.filter(item=>item.batch_id===t.batch_id)||[t]
                              setAccounts([...new Set(batch.map(item=>item.account_id))])
                              setArticles([...new Set(batch.map(item=>item.article_id))])
                              setOverrides({});setSchedule("");setMode("draft");setIntervalMinutes(0);setDailyLimit(0)
                              setDraftId("");setDraftName(`${t.title} · 重新编排`)
                              setPreflight(null);setComposing(true)
                            }}>复制编排</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!taskList.length && (
                <div className={s.empty}>
                  <Send size={30} />
                  <p>没有符合条件的分发记录</p>
                  <button onClick={() => setComposing(true)}>创建分发任务</button>
                </div>
              )}
              <Pagination page={taskPage} total={taskList.length} onChange={setTaskPage} />
              <details>
                <summary>最近执行日志</summary>
                <ul className={s.log}>
                  {state?.events.map((e) => (
                    <li key={e.sequence}>
                      <time>{time(e.created_at)}</time>
                      {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )}
          {isComposer && (
            <div className={s.composeLayout}>
              <aside className={s.publishAccounts}>
                <div className={s.sectionHead}>
                  <div>
                    <h2>分发账号</h2>
                    <small>共 {selectedAccounts.length} 个账号</small>
                  </div>
                  <button aria-label="添加分发账号" onClick={() => openPicker("accounts")}>
                    <Plus size={16} />
                  </button>
                </div>
                <div className={s.batchLabel}>
                  <LayoutGrid size={17} />
                  批量设置
                </div>
                {selectedAccounts.map((a) => (
                  <div key={a.id} className={s.selectedAccount}>
                    {accountIdentity(a)}
                    <button
                      aria-label={`取消选择账号 ${a.label}`}
                      className={s.iconButton}
                      onClick={() => setAccounts((v) => v.filter((id) => id !== a.id))}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {!selectedAccounts.length && (
                  <p className={s.hint}>添加账号后，统一安排文章分发。</p>
                )}
                <button
                  className={s.textButton}
                  onClick={() => {
                    setTab("accounts")
                    setAuthOpen(true)
                  }}
                >
                  <Plus size={15} />
                  授权新账号
                </button>
              </aside>
              <div className={s.batchWorkspace}>
                <div className={s.batchIntro}>
                  <span className={s.segment}>批量设置任务</span>
                  <h2>批量设置任务</h2>
                  <p>选择内容和账号后，逐项预检；已接入的草稿类型可试存，未支持的类型会被拦截。</p>
                </div>
                <section className={s.batchCard}>
                  <div className={s.sectionHead}>
                    <h3>
                      <FileText size={18} />
                      选择内容素材
                    </h3>
                    <div className={s.actions}>
                      <small>已添加 {selectedArticles.length} 条内容</small>
                      <button className={s.primary} onClick={() => openPicker("articles")}>
                        添加内容
                      </button>
                    </div>
                  </div>
                  {selectedArticles.length ? (
                    <div className={s.selectedArticles}>
                      {selectedArticles.map((a) => (
                        <div key={a.id}>
                          <FileText size={18} />
                          <span>
                            {a.title}
                            <small>{contentNames[a.contentType||"article"]} · 版本 {a.version}</small>
                          </span>
                          <button
                            aria-label={`取消选择文章 ${a.title}`}
                            className={s.iconButton}
                            onClick={() => setArticles((v) => v.filter((id) => id !== a.id))}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <button className={s.dropzone} onClick={() => openPicker("articles")}>
                      点击“添加内容”，从内容库选择需要分发的素材
                    </button>
                  )}
                </section>
                {!!selectedAccounts.length&&!!selectedArticles.length&&<section className={s.batchCard}>
                  <details className={s.variants}><summary>逐账号内容差异（可选）</summary>
                    <p className={s.hint}>只填写需要覆盖的标题、摘要或封面；其余沿用内容库原稿。提交时固化为各账号独立快照。</p>
                    {selectedAccounts.map(account=><div key={account.id}>
                      <strong className={s.platformCaption}><PlatformMark name={platformName(account.platform)} platform={account.platform} small />{account.label} · {platformName(account.platform)}</strong>
                      {selectedArticles.map(content=>{const variant=overrides[account.id]?.[content.id]||{};return <div className={s.variantRow} key={content.id}>
                        <small>{content.title}</small>
                        <input aria-label={`${account.label} ${content.title} 标题`} placeholder="使用原稿标题" value={variant.title||""} onChange={e=>setVariant(account.id,content.id,{title:e.target.value})}/>
                        <input aria-label={`${account.label} ${content.title} 摘要`} placeholder="使用原稿摘要" value={variant.metadata?.digest||""} onChange={e=>setVariant(account.id,content.id,{metadata:{digest:e.target.value}})}/>
                        <select aria-label={`${account.label} ${content.title} 封面`} value={variant.metadata?.coverAssetId||""} onChange={e=>setVariant(account.id,content.id,{metadata:{coverAssetId:e.target.value}})}>
                          <option value="">使用原稿封面</option>{(state?.assets||[]).filter(a=>a.kind==="image").map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </div>})}
                    </div>)}
                  </details>
                </section>}
                <section className={s.batchCard}>
                  <div className={s.sectionHead}>
                    <h3>
                      <Users size={18} />
                      选择账号
                    </h3>
                    <div className={s.actions}>
                      <small>已添加 {selectedAccounts.length} 个账号</small>
                      <button className={s.primary} onClick={() => openPicker("accounts")}>
                        添加账号
                      </button>
                    </div>
                  </div>
                  {selectedAccounts.length ? (
                    <div className={s.accountChips}>
                      {selectedAccounts.map((a) => (
                        <div key={a.id}>
                          <PlatformMark
                            name={platformName(a.platform)}
                            platform={a.platform}
                            small
                          />
                          <span>
                            {a.label}
                            <small>{a.state === "ready" ? "已登录" : "等待登录"}</small>
                          </span>
                          <button
                            aria-label={`移除分发账号 ${a.label}`}
                            className={s.iconButton}
                            onClick={() => setAccounts((v) => v.filter((id) => id !== a.id))}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <button className={s.dropzone} onClick={() => openPicker("accounts")}>
                      点击“添加账号”，选择需要分发的媒体账号
                    </button>
                  )}
                </section>
                <section className={s.batchCard}>
                  <h3>
                    <Clock3 size={18} />
                    执行设置
                  </h3>
                  <div className={s.two}>
                    <label>
                      执行方式
                      <select
                        aria-label="执行方式"
                        value={mode}
                        onChange={(e) => setMode(e.target.value)}
                      >
                        <option value="draft">保存平台草稿</option>
                        <option value="publish" disabled>正式发布（本轮不执行）</option>
                      </select>
                    </label>
                    <label>
                      定时时间（留空立即执行）
                      <input
                        type="datetime-local"
                        value={schedule}
                        onChange={(e) => setSchedule(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className={s.two}>
                    <label>同账号任务间隔（分钟）<input type="number" min="0" max="1440" value={intervalMinutes} onChange={e=>setIntervalMinutes(Number(e.target.value)||0)}/></label>
                    <label>每账号每日上限（0 表示不限）<input type="number" min="0" max="100" value={dailyLimit} onChange={e=>setDailyLimit(Number(e.target.value)||0)}/></label>
                  </div>
                  {!!selectedArticles.length&&<p className={s.hint}>排期预览（每个账号）：{selectedArticles.map((_,index)=>{
                    const start=schedule?new Date(schedule).getTime():schedulePreviewNow
                    const runAt=start+(dailyLimit?Math.floor(index/dailyLimit)*86400000:0)+(dailyLimit?index%dailyLimit:index)*intervalMinutes*60000
                    return time(runAt)
                  }).join("、")}</p>}
                  <p className={s.modeHint}>
                    <CircleHelp size={15} />
                    {mode === "draft"
                      ? "只有该内容类型的原生草稿已验证，才会向平台提交；本地保存不会自动变成平台草稿。"
                      : "本轮只验证草稿流程。"}
                  </p>
                </section>
                <section className={s.batchCard}>
                  <h3>分发方案</h3>
                  <div className={s.draftControls}>
                    <label>方案名称<input value={draftName} placeholder="例如：本周视频草稿" maxLength={100} onChange={e=>setDraftName(e.target.value)}/></label>
                    <button disabled={busy||!draftName.trim()} onClick={()=>void perform(async()=>{
                      const saved=await send<{id:string}>("batch.draft.save",{id:draftId||undefined,name:draftName,accountIds:accounts,articleIds:articles,scheduledAt:schedule?new Date(schedule).getTime():null,intervalMinutes,dailyLimit,overrides})
                      setDraftId(saved.id);setNotice("分发方案已保存在本机，可稍后继续编辑")
                    })}>保存方案</button>
                  </div>
                  {!!state?.drafts.length&&<div className={s.savedDrafts}><strong>已保存方案</strong>{state.drafts.map(draft=><div key={draft.id}>
                    <button onClick={()=>loadDraft(draft)}>{draft.name} · {time(draft.updated_at)}</button>
                    <button aria-label={`删除方案 ${draft.name}`} disabled={busy} onClick={()=>void perform(async()=>{await send("batch.draft.delete",{id:draft.id});if(draftId===draft.id)setDraftId("");setNotice("方案已删除")})}><X size={14}/></button>
                  </div>)}</div>}
                </section>
                <div className={s.batchBottom}>
                  <div>
                    <b>
                      {selectedArticles.length} 条内容 × {selectedAccounts.length} 个账号 ={" "}
                      {selectedArticles.length * selectedAccounts.length} 个任务
                    </b>
                    <small>同一账号顺序执行 · 本机服务和电脑需保持运行</small>
                  </div>
                  <div className={s.actions}>
                    <button disabled={busy || !accounts.length || !articles.length} onClick={()=>void perform(async()=>{
                      const check=await send<{ok:boolean;errors:Array<{message:string}>;warnings:Array<{message:string}>}>("batch.preflight",{accountIds:accounts,articleIds:articles,mode:"draft",scheduledAt:schedule?new Date(schedule).getTime():undefined,intervalMinutes,dailyLimit,overrides})
                      setPreflight(check);setNotice(check.ok?"预检通过，可创建平台草稿任务":`预检发现 ${check.errors.length} 项需要处理`)
                    })}>检查可用性</button>
                    <button
                      onClick={() => {
                        batchKey.current = null
                        setNotice("已准备新的批次，请确认账号与文章后提交")
                      }}
                    >
                      准备新批次
                    </button>
                    <button
                      className={s.primary}
                      disabled={busy || !accounts.length || !articles.length}
                      onClick={() => void perform(createBatch)}
                    >
                      <Send size={16} />
                      创建分发批次
                    </button>
                  </div>
                </div>
                {preflight&&<div className={preflight.ok?s.notice:s.error} role="status">
                  <strong>{preflight.ok?"预检通过":"本批次暂不能提交平台草稿"}</strong>
                  {[...preflight.errors,...preflight.warnings].slice(0,12).map((issue,index)=><p key={index}>{issue.message}</p>)}
                </div>}
                <p className={s.hint}>
                  重复提交相同选择会找回原批次；再次分发前，先点“准备新批次”。
                </p>
              </div>
            </div>
          )}
          {tab === "assets" && (
            <section className={s.platformSection}>
              <div className={s.sectionHead}><div><h2>本机素材库</h2><p>上传图片、MP4 视频及 MP3/WAV/M4A 音频；账号之间复用同一份素材。</p></div></div>
              <div className={s.assetUpload}>
                <label>素材类型<select value={uploadKind} onChange={e=>setUploadKind(e.target.value as PublishingAsset["kind"])}>
                  <option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option>
                </select></label>
                <label className={s.fileChoose}>选择并上传文件<input type="file" accept={uploadKind==="image"?"image/jpeg,image/png,image/webp":uploadKind==="video"?"video/mp4":"audio/mpeg,audio/wav,audio/mp4"}
                  onChange={e=>{const files=[...e.target.files||[]];e.target.value="";void perform(async()=>{for(const file of files)await uploadAsset(file,uploadKind)})}} multiple /></label>
                <small>图片 12MB、视频 250MB、音频 100MB 上限；只保存在本机。</small>
              </div>
              <div className={s.assetUpload}>
                <label>从 GEO 配图批次导入图片
                  <input value={importId} placeholder="amia_ 图片素材编号" onChange={e=>setImportId(e.target.value.trim())}/>
                </label>
                <button disabled={busy||!importId} onClick={()=>void perform(async()=>{
                  const response=await fetch(`${endpoint}/assets/import`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:importId})})
                  const data=await response.json();if(!response.ok)throw new Error(data.error||"导入失败")
                  setImportId("");setNotice("GEO 图片已导入本机分发素材库")
                })}>导入已有图片</button>
              </div>
              <div className={s.assetGrid}>
                {(state?.assets||[]).map(asset=><article key={asset.id}>
                  {asset.kind==="image"?<img src={`${endpoint}/assets/${asset.id}`} alt={asset.name}/>:<div className={s.assetSymbol}>{asset.kind==="video"?"视频":"音频"}</div>}
                  <strong>{asset.name}</strong>
                  <small>{asset.kind==="image"?"图片":asset.kind==="video"?"视频":"音频"} · {(asset.size/1024/1024).toFixed(1)} MB</small>
                  <button className={s.textButton} onClick={()=>{newArticle();setContentType(asset.kind==="video"?"video":asset.kind==="audio"?"audio":"imageText");setAssetIds([asset.id])}}>用此素材新建内容</button>
                </article>)}
              </div>
              {!state?.assets.length&&<p className={s.hint}>还没有素材。上传后可在内容编辑器中选择、排序和设置封面。</p>}
            </section>
          )}
          {tab === "platforms" && (
            <section className={s.platformSection}>
              <div className={s.sectionHead}>
                <div>
                  <h2>按内容类型的平台能力</h2>
                  <p>客户端代码覆盖不等于真实可用；草稿试存成功并从平台回读后才标记为已验证。</p>
                </div>
                <span className={s.badge}>演示平台单独标记</span>
              </div>
              <div className={s.platforms}>
                {state?.platforms.map((p) => (
                  <article key={p.id}>
                    <div className={s.identity}>
                      <PlatformMark name={p.name} platform={p.id} />
                      <h3>{p.name}</h3>
                    </div>
                    <p className={p.demo ? s.good : s.badge}>{p.readiness}</p>
                    <div className={s.capabilityList}>{p.contentTypes.map(type=><span key={type}>{contentNames[type]} · {p.draftTypes.includes(type)?"可尝试草稿":"草稿待验证"}</span>)}</div>
                    <small>
                      {p.demo
                        ? "本地演示，验证完整流程"
                        : p.custom
                          ? "可先添加账号，稍后登录；草稿需要实号验收，正式发布暂未开放"
                        : p.login
                          ? "支持页面内登录；执行能力按类型预检"
                          : "登录适配待补齐"}
                    </small>
                    <button
                      className={s.textButton}
                      onClick={() => {
                        setPlatform(p.id)
                        setAuthOpen(true)
                      }}
                    >
                      添加账号
                      <ArrowRight size={14} />
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
        <footer className={s.footer}>
          <ShieldCheck size={13} />
          登录状态加密保存 · 账号、文章与任务由 GEO 独立管理
        </footer>
      </div>
      {authOpen && (
        <Dialog title="添加账号" wide errorMessage={error} onClose={() => setAuthOpen(false)}>
          <div className={s.authTabs}>
            <b>本机授权</b>
            <span>扫码和登录均在页面内完成</span>
          </div>
          <div className={s.platformPicker}>
            {state?.platforms.map((p) => (
              <button
                aria-label={`选择平台 ${p.name}`}
                aria-pressed={platform === p.id}
                className={platform === p.id ? s.selectedPlatform : ""}
                key={p.id}
                onClick={() => setPlatform(p.id)}
              >
                <PlatformMark name={p.name} platform={p.id} />
                <span>{p.name}</span>
                {platform === p.id && <Check size={13} />}
              </button>
            ))}
          </div>
          <form
            className={s.authForm}
            onSubmit={(e) => {
              e.preventDefault()
              void perform(() => addAccount(true))
            }}
          >
            <label>
              账号备注
              <input
                required
                maxLength={80}
                placeholder="例如：公司主账号"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <button className={s.primary} disabled={busy || !state || !label.trim()}>
              添加账号并登录
              <ArrowRight size={15} />
            </button>
            <button type="button" className={s.textButton} disabled={busy || !state || !label.trim()} onClick={() => void perform(() => addAccount(false))}>
              仅添加账号，稍后登录
            </button>
          </form>
          <p className={`${s.hint} ${s.platformCaption}`}><PlatformMark name={platformName(platform)} platform={platform} small />已选择：{platformName(platform)}。每个账号使用独立浏览器会话。</p>
        </Dialog>
      )}
      {picker && (
        <Dialog
          title={picker === "accounts" ? "选择分发账号" : "选择文章素材"}
          wide
          onClose={() => setPicker(null)}
        >
          <label className={s.search}>
            <Search size={16} />
            <input
              aria-label="搜索选择项"
              placeholder={picker === "accounts" ? "搜索账号或平台" : "搜索文章标题"}
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
            />
          </label>
          <div className={s.pickerList}>
            {picker === "accounts"
              ? (state?.accounts || [])
                  .filter((a) => `${a.label} ${platformName(a.platform)}`.includes(pickerSearch))
                  .map((a) => (
                    <label key={a.id} className={s.pickerRow}>
                      <input
                        aria-label={`选择分发账号 ${a.label}`}
                        type="checkbox"
                        checked={accounts.includes(a.id)}
                        onChange={() => setAccounts((v) => toggle(v, a.id))}
                      />
                      {accountIdentity(a)}
                      <span className={a.state === "ready" ? s.good : s.danger}>
                        {a.state === "ready" ? "正常" : "待登录"}
                      </span>
                    </label>
                  ))
              : (state?.articles || [])
                  .filter((a) => a.title.includes(pickerSearch))
                  .map((a) => (
                    <label key={a.id} className={s.pickerRow}>
                      <input
                        aria-label={`选择分发文章 ${a.title}`}
                        type="checkbox"
                        checked={articles.includes(a.id)}
                        onChange={() => setArticles((v) => toggle(v, a.id))}
                      />
                      <span className={s.fileIcon}>
                        <FileText size={20} />
                      </span>
                      <span>
                        {a.title}
                        <small>
                          版本 {a.version} · {time(a.updated_at)}
                        </small>
                      </span>
                    </label>
                  ))}
          </div>
          <div className={s.dialogFoot}>
            <span>
              已选择 {picker === "accounts" ? accounts.length : articles.length}{" "}
              {picker === "accounts" ? "个账号" : "篇文章"}
            </span>
            <div className={s.actions}>
              {picker === "articles" && (
                <>
                <button disabled={busy || importBusy} onClick={() => void openProductionImport()}>
                  从内容生产导入
                </button>
                <label className={s.fileChoose}>
                  <Upload size={15} /> 上传文章文件
                  <input type="file" accept=".md,.txt,.docx" multiple disabled={busy || importBusy}
                    onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value="";void previewArticleFiles(files)}} />
                </label>
                <button
                  disabled={busy}
                  onClick={() => {
                    setPicker(null)
                    newArticle()
                  }}
                >
                  <Plus size={15} />
                  新建文章
                </button>
                </>
              )}
              <button className={s.primary} onClick={() => setPicker(null)}>
                确定选择
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {fileImportOpen && (
        <Dialog title="上传文章文件" wide errorMessage={importError}
          onClose={()=>{if(importBusy)return;setFileImportOpen(false);setFileImportFiles([]);setFileImportPreviews([])}}>
          <p className={s.hint}>支持一次上传 1～20 个 .md、.txt、.docx 文件。先在这里核对标题、正文和解析提示，确认后才加入内容库；不会提交给内容平台。</p>
          {importBusy && !fileImportPreviews.length && <p role="status" className={s.hint}>正在解析文章文件…</p>}
          <div className={s.importItems}>
            {fileImportPreviews.map((item,index)=>(
              <article key={`${item.sourceHash}-${index}`} className={s.importItem}>
                <label className={s.importChoice}>
                  <input type="checkbox" checked={fileImportSelected.includes(index)} disabled={importBusy}
                    onChange={()=>setFileImportSelected(previous=>previous.includes(index)?previous.filter(value=>value!==index):[...previous,index])} />
                  <span><strong>{item.title}</strong><small>{item.name} · {item.imageCount} 张内嵌图片</small></span>
                </label>
                {item.warnings.length>0 && <ul className={s.importWarnings}>{item.warnings.map((warning,warningIndex)=><li key={warningIndex}>{warning}</li>)}</ul>}
                <details><summary>查看正文预览</summary><pre className={s.importExcerpt}>{item.markdown.replace(/data:image\/[^)\s]+/g,"[内嵌图片]").slice(0,1800)}{item.markdown.length>1800?"\n…（仅显示前 1800 字，导入后可查看全文）":""}</pre></details>
              </article>
            ))}
          </div>
          <div className={s.dialogFoot}>
            <span>已选择 {fileImportSelected.length} / {fileImportPreviews.length} 篇；Word 复杂排版请对照原文检查。</span>
            <div className={s.actions}>
              <button disabled={importBusy} onClick={()=>{setFileImportOpen(false);setFileImportFiles([]);setFileImportPreviews([])}}>取消</button>
              <button className={s.primary} disabled={importBusy || !fileImportSelected.length} onClick={()=>void confirmArticleFiles()}>
                {importBusy?"处理中…":"确认导入内容库"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {productionImportOpen && (
        <Dialog title="从内容生产导入文章" wide errorMessage={importError}
          onClose={()=>{if(!importBusy)setProductionImportOpen(false)}}>
          <p className={s.hint}>选择已生成的文章，可单篇或批量导入。分发台保存独立副本，后续编辑不会改动内容生产原稿。</p>
          <div className={s.importFields}>
            <label>内容生产客户
              <select value={productionClientId} disabled={importBusy}
                onChange={event=>void selectProductionClient(event.target.value)}>
                <option value="">选择客户</option>
                {productionClients.map(client=><option key={`${client.id}:${client.teamId||"personal"}`} value={client.id}>{client.name}{client.teamId?" · 团队共享":""}</option>)}
              </select>
            </label>
            <label>文章批次
              <select value={productionBatch?`${productionBatch.kind==="production_run"?"run":"batch"}:${productionBatch.id}`:""} disabled={importBusy || !productionClientId}
                onChange={event=>void selectProductionBatch(event.target.value)}>
                <option value="">选择批次</option>
                {productionBatches.map(batch=><option key={batch.id} value={`batch:${batch.id}`}>{batch.promptTitle || "文章批次"} · {new Date(batch.createdAt).toLocaleDateString("zh-CN")}</option>)}
                {productionRuns.map(run=><option key={run.id} value={`run:${run.id}`}>按计划生产 · {new Date(run.createdAt).toLocaleDateString("zh-CN")} · {run.items.length} 篇</option>)}
              </select>
            </label>
            <label>导入版本
              <select value={productionVariant} disabled={importBusy || !productionBatch || productionBatch.kind==="production_run"}
                onChange={event=>{const variant=event.target.value as "original"|"media";setProductionVariant(variant);setProductionIds(previous=>previous.filter(id=>productionBatch?.items.some(item=>item.id===id&&productionItemReady(item,variant))))}}>
                <option value="original">原文</option>
                {productionBatch?.kind!=="production_run" && <option value="media">图文版（仅可选已生成配图的文章）</option>}
              </select>
            </label>
          </div>
          {importBusy && <p role="status" className={s.hint}>正在读取或导入文章…</p>}
          {!importBusy && !productionClients.length && !importError && <p className={s.hint}>暂无可访问的内容生产客户。</p>}
          {productionClientId && !productionBatches.length && !productionRuns.length && !importBusy && !importError && <p className={s.hint}>该客户暂无可导入的文章批次或按计划生产记录。</p>}
          {productionBatch && <>
            <div className={s.importSelectionHead}>
              <strong>{productionBatch.promptTitle || "文章批次"} · 已选 {productionIds.length} 篇</strong>
              <button type="button" disabled={importBusy} onClick={()=>setProductionIds(productionBatch.items.filter(item=>productionItemReady(item)).map(item=>item.id))}>选择本批可用文章</button>
            </div>
            <div className={s.importItems}>
              {productionBatch.items.map(item=>(
                <article key={item.id} className={s.importItem}>
                  <div className={s.importChoice}>
                    <label><input type="checkbox" checked={productionIds.includes(item.id)} disabled={importBusy || !productionItemReady(item)}
                      onChange={()=>setProductionIds(previous=>previous.includes(item.id)?previous.filter(id=>id!==item.id):[...previous,item.id])} />
                      <span><strong>{item.title}</strong><small>{item.hasDraft?item.hasMediaVersion?"原文、图文版均可用":"原文可用，图文版待生成":"正文尚未生成"}</small></span>
                    </label>
                    <button type="button" disabled={importBusy || !item.hasDraft} onClick={()=>void previewProductionArticle(item.id)}>预览正文</button>
                  </div>
                </article>
              ))}
            </div>
            {productionPreview && <section className={s.importPreview}>
              <strong>《{productionPreview.title}》{productionVariant==="media"?"图文版":"原文"}预览</strong>
              <pre className={s.importExcerpt}>{(productionVariant==="media"?productionPreview.mediaMarkdown:productionPreview.markdown)?.slice(0,2200)||"该版本暂无正文"}</pre>
              <small>仅显示前 2200 字；导入后可在内容编辑器查看全文。</small>
            </section>}
          </>}
          <div className={s.dialogFoot}>
            <span>导入只保存到 GEO 内容库，不会正式发布文章。</span>
            <div className={s.actions}>
              <button disabled={importBusy} onClick={()=>setProductionImportOpen(false)}>取消</button>
              <button className={s.primary} disabled={importBusy || !productionIds.length} onClick={()=>void confirmProductionArticles()}>
                {importBusy?"处理中…":`确认导入 ${productionIds.length} 篇`}
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {loginId && (
        <div className={s.overlay}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="平台账号登录"
            className={s.loginDialog}
          >
            <div className={s.sectionHead}>
              <div>
                <h2 className={s.platformCaption}>{currentAccount && <PlatformMark name={platformName(currentAccount.platform)} platform={currentAccount.platform} small />}{currentAccount?.label} · 登录窗口</h2>
                <p>{screen?.message || "正在载入画面…"}</p>
              </div>
              <button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    setLoginId("")
                    setInputText("")
                    await send("login.close", { id: loginId })
                  })
                }
              >
                关闭登录窗口
              </button>
            </div>
            <div className={s.actions}>
              {state?.loginWindows.map((w) => (
                <button key={w.id} onClick={() => setLoginId(w.id)}>
                  {state.accounts.find((a) => a.id === w.id)?.label}
                </button>
              ))}
            </div>
            {screen && (
              <>
                <p className={s.hint}>
                  {screen.url} ·{" "}
                  {screen.ready
                    ? "登录已保存，等待任务自动继续"
                    : "点击下方画面选择输入框，使用下方输入区填写；二维码可直接扫码"}
                </p>
                {/* Screenshots are private, short-lived browser frames, not remote assets. */}
                <img
                  className={s.browserScreen}
                  aria-busy={busy}
                  style={{
                    pointerEvents: busy ? "none" : "auto",
                    cursor: busy ? "progress" : "crosshair",
                  }}
                  src={`data:image/jpeg;base64,${screen.image}`}
                  alt="平台登录实时画面"
                  onClick={(e) => {
                    const b = e.currentTarget.getBoundingClientRect()
                    void perform(() =>
                      interact({
                        kind: "click",
                        x: ((e.clientX - b.left) * screen.width) / b.width,
                        y: ((e.clientY - b.top) * screen.height) / b.height,
                      }),
                    )
                  }}
                />
                <form
                  className={s.inlineForm}
                  onSubmit={(e) => {
                    e.preventDefault()
                    const value = inputText
                    setInputText("")
                    void perform(() => interact({ kind: "text", text: value }))
                  }}
                >
                  <label>
                    输入到已选中的平台输入框
                    <input
                      type="password"
                      autoComplete="off"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                    />
                  </label>
                  <button disabled={busy}>发送输入</button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void perform(() => interact({ kind: "key", key: "Enter" }))}
                  >
                    回车
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void perform(() => interact({ kind: "key", key: "Tab" }))}
                  >
                    下一个输入框
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void perform(() => interact({ kind: "key", key: "ControlOrMeta+A" }))
                    }
                  >
                    全选当前输入
                  </button>
                </form>
                <div className={s.actions}>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(() => interact({ kind: "scroll", direction: "up" }))
                    }
                  >
                    向上滚动
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(() => interact({ kind: "scroll", direction: "down" }))
                    }
                  >
                    向下滚动
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void perform(() => interact({ kind: "reload" }))}
                  >
                    刷新平台页面
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await send("login.verify", { id: loginId })
                      })
                    }
                  >
                    检查登录状态
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {review && (
        <div className={s.overlay}>
          <section
            className={s.reviewDialog}
            role="dialog"
            aria-modal="true"
            aria-label="核对提交结果"
          >
            <h2>核对：{review.title}</h2>
            <p>平台可能已经接收文章。先检查平台草稿箱或已发布列表，再选择后续处理。</p>
            <label>
              平台文章编号
              <input value={remoteId} onChange={(e) => setRemoteId(e.target.value)} />
            </label>
            <div className={s.actions}>
              <button
                className={s.primary}
                disabled={busy || !remoteId}
                onClick={() =>
                  void perform(async () => {
                    await send("task.action", { id: review.id, action: "reconcile", remoteId })
                    setReview(null)
                  })
                }
              >
                保存编号并核验
              </button>
            </div>
            {review.state === "needs_review" && (
              <>
                <label className={s.check}>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  我已核对，平台没有这篇文章或草稿
                </label>
                <button
                  disabled={busy || !confirmed}
                  onClick={() =>
                    void perform(async () => {
                      await send("task.action", {
                        id: review.id,
                        action: "retry",
                        confirmedNotPublished: true,
                      })
                      setReview(null)
                    })
                  }
                >
                  确认后重新提交
                </button>
              </>
            )}
            <button onClick={() => setReview(null)}>关闭</button>
          </section>
        </div>
      )}
    </main>
  )
}
