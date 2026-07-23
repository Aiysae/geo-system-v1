import "server-only"

import type {
  GeoAuditBotPolicy,
  GeoAuditCategory,
  GeoAuditCheck,
  GeoAuditDimension,
  GeoAuditPage,
  GeoAuditResource,
  WebsiteGeoAudit,
} from "@/types"

interface ScoreAuditInput {
  expectedEntityName: string
  pages: GeoAuditPage[]
  resources: GeoAuditResource[]
  botPolicies: GeoAuditBotPolicy[]
}

interface CheckInput {
  id: string
  category: GeoAuditCategory
  label: string
  score: number
  maxScore: number
  summary: string
  evidence?: string[]
  urls?: string[]
  recommendation: string
  priority?: "P0" | "P1" | "P2"
}

const CATEGORY_LABELS: Record<GeoAuditCategory, string> = {
  crawlability: "抓取与索引",
  discoverability: "页面发现",
  contentStructure: "内容结构",
  structuredData: "结构化数据",
  trust: "专业可信度",
  aiReadability: "AI 阅读辅助",
}

function unique(values: string[], max = 8): string[] {
  return Array.from(new Set(values.filter(Boolean))).slice(0, max)
}

function createCheck(input: CheckInput): GeoAuditCheck {
  const score = Math.max(0, Math.min(input.maxScore, Math.round(input.score)))
  const status = score >= input.maxScore
    ? "pass"
    : score <= 0
      ? "fail"
      : "warning"
  return {
    ...input,
    score,
    status,
    evidence: unique(input.evidence || []),
    urls: unique(input.urls || [], 12),
    priority: status === "pass"
      ? "P2"
      : input.priority || (status === "fail" ? "P1" : "P2"),
  }
}

function scaled(count: number, total: number, maxScore: number): number {
  if (total <= 0) return 0
  return Math.round((count / total) * maxScore)
}

function hasNoIndex(page: GeoAuditPage): boolean {
  return /(^|[,\s])noindex([,\s]|$)/i.test(`${page.robotsMeta} ${page.xRobotsTag}`)
}

function canonicalUrl(page: GeoAuditPage): URL | null {
  if (!page.canonical) return null
  try {
    return new URL(page.canonical, page.finalUrl)
  } catch {
    return null
  }
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s\-_.·]/g, "")
}

function policy(input: ScoreAuditInput, key: GeoAuditBotPolicy["key"]): GeoAuditBotPolicy | undefined {
  return input.botPolicies.find(item => item.key === key)
}

export function scoreWebsiteAudit(input: ScoreAuditInput): {
  checks: GeoAuditCheck[]
  dimensions: GeoAuditDimension[]
  score: number
  summary: WebsiteGeoAudit["aiSummary"]
} {
  const pages = input.pages.filter(page => !page.error && page.status >= 200 && page.status < 300)
  const homepage = input.pages[0]
  const pageUrls = pages.map(page => page.finalUrl)
  const robots = input.resources.find(resource => resource.kind === "robots")
  const sitemap = input.resources.find(resource => resource.kind === "sitemap")
  const llms = input.resources.find(resource => resource.kind === "llms")
  const genericPolicy = policy(input, "generic")
  const oaiPolicy = policy(input, "oaiSearch")

  const homepageScore = homepage?.status === 200 ? 5 : homepage?.status && homepage.status < 300 ? 4 : 0
  const genericScore = genericPolicy?.status === "allowed"
    ? genericPolicy.explicit ? 6 : robots?.available ? 5 : 4
    : genericPolicy?.status === "blocked" ? 0 : 1
  const oaiScore = oaiPolicy?.status === "allowed"
    ? oaiPolicy.explicit ? 5 : 4
    : oaiPolicy?.status === "blocked" ? 0 : 1
  const indexable = pages.filter(page => !hasNoIndex(page))
  const serverReadable = pages.filter(page => !page.jsShellRisk && page.textLength >= 200)

  const validCanonicals = pages.filter(page => {
    const canonical = canonicalUrl(page)
    if (!canonical) return false
    return canonical.origin === new URL(page.finalUrl).origin
  })
  const clearTitles = pages.filter(page => (
    page.title.length >= 4
    && page.title.length <= 120
    && page.h1.length === 1
    && page.h1[0].length >= 2
    && page.h1[0].length <= 120
  ))
  const orderlyHeadings = pages.filter(page => page.h2.length >= 2 && page.headingLevelSkips === 0)
  const conciseLeads = pages.filter(page => page.leadText.length >= 40 && page.leadText.length <= 500)
  const visibleQuestionTotal = pages.reduce((sum, page) => sum + page.visibleQuestionCount, 0)

  const pagesWithJsonLd = pages.filter(page => page.structuredDataTypes.length > 0)
  const jsonLdErrors = pages.reduce((sum, page) => sum + page.structuredDataErrors, 0)
  const entityTypePattern = /Organization|Person|LocalBusiness|WebSite/i
  const entitySchemaPages = pages.filter(page => page.structuredDataTypes.some(type => entityTypePattern.test(type)))
  const expected = normalized(input.expectedEntityName)
  const namedEntityPages = pages.filter(page => (
    expected
    && [page.title, ...page.h1, ...page.entityNames].some(value => normalized(value).includes(expected))
  ))
  const qaSchemaPages = pages.filter(page => page.structuredDataTypes.some(type => /FAQPage|QAPage|Question|Answer/i.test(type)))
  const visibleQaPages = pages.filter(page => page.visibleQuestionCount > 0)
  const supportSchemaTypes = new Set(
    pages.flatMap(page => page.structuredDataTypes)
      .filter(type => /BreadcrumbList|Article|NewsArticle|Product|Service|ProfilePage/i.test(type)),
  )

  const authorPages = pages.filter(page => page.authorSignals.length > 0 || page.credentialSignals.length > 0)
  const trustPages = pages.filter(page => page.trustLinks.length > 0)
  const sourcedPages = pages.filter(page => page.dateSignals.length > 0 || page.externalCitationCount > 0)
  const semanticPages = pages.filter(page => page.semanticLandmarks.includes("main") || page.semanticLandmarks.includes("article"))
  const languagePages = pages.filter(page => Boolean(page.language))
  const linkedPages = pages.filter(page => page.internalLinkCount >= 3)

  const checks: GeoAuditCheck[] = [
    createCheck({
      id: "homepage-status",
      category: "crawlability",
      label: "首页可访问",
      score: homepageScore,
      maxScore: 5,
      summary: homepageScore === 5 ? "首页正常返回 HTTP 200。" : `首页返回 HTTP ${homepage?.status || 0}。`,
      evidence: homepage ? [`最终地址：${homepage.finalUrl}`, `加载耗时：${homepage.loadTimeMs}ms`] : [],
      urls: homepage ? [homepage.finalUrl] : [],
      recommendation: "确保主入口稳定返回 HTTP 200，并避免登录、验证码或地区限制。",
      priority: "P0",
    }),
    createCheck({
      id: "robots-generic",
      category: "crawlability",
      label: "通用爬虫访问规则",
      score: genericScore,
      maxScore: 6,
      summary: genericPolicy?.note || "无法确认通用爬虫访问规则。",
      evidence: robots ? [robots.summary] : [],
      urls: robots ? [robots.url] : [],
      recommendation: "在根目录提供可读取的 robots.txt，并确认公开内容没有被 Disallow。",
      priority: "P0",
    }),
    createCheck({
      id: "robots-oai-search",
      category: "crawlability",
      label: "ChatGPT 搜索访问",
      score: oaiScore,
      maxScore: 5,
      summary: oaiPolicy?.note || "无法确认 OAI-SearchBot 访问规则。",
      evidence: oaiPolicy?.matchingLine ? [`匹配 robots.txt 第 ${oaiPolicy.matchingLine} 行`] : [],
      urls: robots ? [robots.url] : [],
      recommendation: "需要被 ChatGPT 搜索发现时，确保 OAI-SearchBot 未被禁止；训练爬虫 GPTBot 应单独管理。",
      priority: "P0",
    }),
    createCheck({
      id: "page-indexability",
      category: "crawlability",
      label: "页面可索引性",
      score: scaled(indexable.length, pages.length, 5),
      maxScore: 5,
      summary: `${indexable.length}/${pages.length || 0} 个已读取页面未发现 noindex。`,
      evidence: pages.filter(hasNoIndex).map(page => `${page.title || page.finalUrl}：${page.robotsMeta || page.xRobotsTag}`),
      urls: pages.filter(hasNoIndex).map(page => page.finalUrl),
      recommendation: "移除公开核心页面的 noindex，并同步检查响应头 X-Robots-Tag。",
      priority: "P0",
    }),
    createCheck({
      id: "server-readable",
      category: "crawlability",
      label: "首屏 HTML 可读取",
      score: scaled(serverReadable.length, pages.length, 4),
      maxScore: 4,
      summary: `${serverReadable.length}/${pages.length || 0} 个页面在初始 HTML 中有足够正文。`,
      evidence: pages.filter(page => page.jsShellRisk).map(page => `${page.title || page.finalUrl}：初始正文仅 ${page.textLength} 字符`),
      urls: pages.filter(page => page.jsShellRisk).map(page => page.finalUrl),
      recommendation: "为核心正文使用服务端渲染或预渲染，避免只返回 JavaScript 空壳。",
      priority: "P0",
    }),
    createCheck({
      id: "sitemap",
      category: "discoverability",
      label: "Sitemap 可用性",
      score: sitemap?.valid ? 5 : sitemap?.available ? 1 : 0,
      maxScore: 5,
      summary: sitemap?.summary || "未发现可读取的 Sitemap。",
      evidence: sitemap?.error ? [sitemap.error] : [],
      urls: sitemap ? [sitemap.url] : [],
      recommendation: "提供有效的 sitemap.xml，列出规范化的公开页面绝对网址，并在 robots.txt 中声明。",
    }),
    createCheck({
      id: "canonical",
      category: "discoverability",
      label: "Canonical 一致性",
      score: scaled(validCanonicals.length, pages.length, 4),
      maxScore: 4,
      summary: `${validCanonicals.length}/${pages.length || 0} 个页面提供同站规范地址。`,
      evidence: pages.filter(page => !canonicalUrl(page)).map(page => `${page.title || page.finalUrl}：未设置有效 canonical`),
      urls: pages.filter(page => !canonicalUrl(page)).map(page => page.finalUrl),
      recommendation: "为每个核心页面设置指向自身规范地址的 canonical，避免实体与内容信号分散。",
    }),
    createCheck({
      id: "internal-links",
      category: "discoverability",
      label: "站内可抓取链接",
      score: scaled(linkedPages.length, pages.length, 4),
      maxScore: 4,
      summary: `${linkedPages.length}/${pages.length || 0} 个页面包含至少 3 个标准站内链接。`,
      evidence: pages.slice(0, 5).map(page => `${page.title || page.finalUrl}：${page.internalLinkCount} 个站内链接`),
      urls: pages.filter(page => page.internalLinkCount < 3).map(page => page.finalUrl),
      recommendation: "使用标准 <a href> 将首页、服务、案例、FAQ、作者和联系页面互相连接。",
    }),
    createCheck({
      id: "representative-pages",
      category: "discoverability",
      label: "代表页面覆盖",
      score: pages.length >= 5 ? 2 : pages.length >= 3 ? 1 : 0,
      maxScore: 2,
      summary: `本次成功读取 ${pages.length} 个代表页面。`,
      evidence: pageUrls,
      urls: pageUrls,
      recommendation: "确保首页可以发现关于、产品或服务、内容、FAQ 和联系页面。",
    }),
    createCheck({
      id: "title-h1",
      category: "contentStructure",
      label: "Title 与 H1 清晰度",
      score: scaled(clearTitles.length, pages.length, 6),
      maxScore: 6,
      summary: `${clearTitles.length}/${pages.length || 0} 个页面具有清晰标题和单一主标题。`,
      evidence: pages.slice(0, 6).map(page => `${page.title || "无 Title"}｜H1：${page.h1.join(" / ") || "无"}`),
      urls: pages.filter(page => !clearTitles.includes(page)).map(page => page.finalUrl),
      recommendation: "每页设置清晰且独特的 Title，并使用一个能准确概括页面主题的 H1。",
    }),
    createCheck({
      id: "heading-hierarchy",
      category: "contentStructure",
      label: "H2/H3 内容层级",
      score: scaled(orderlyHeadings.length, pages.length, 5),
      maxScore: 5,
      summary: `${orderlyHeadings.length}/${pages.length || 0} 个页面具有完整且连续的分层标题。`,
      evidence: pages.slice(0, 6).map(page => `${page.title || page.finalUrl}：H2 ${page.h2.length} 个，跳级 ${page.headingLevelSkips} 次`),
      urls: pages.filter(page => !orderlyHeadings.includes(page)).map(page => page.finalUrl),
      recommendation: "用 H2 拆分核心分论点、H3 承载证据与细节，不要使用字号样式代替标题层级。",
    }),
    createCheck({
      id: "answer-first",
      category: "contentStructure",
      label: "首段先给核心答案",
      score: scaled(conciseLeads.length, pages.length, 4),
      maxScore: 4,
      summary: `${conciseLeads.length}/${pages.length || 0} 个页面在正文开头提供了可抽取的说明。`,
      evidence: pages.filter(page => page.leadText).slice(0, 5).map(page => `${page.title || page.finalUrl}：${page.leadText}`),
      urls: pages.filter(page => !conciseLeads.includes(page)).map(page => page.finalUrl),
      recommendation: "在首段直接回答页面主题，再按 H2 展开依据、场景、方法和结论。",
    }),
    createCheck({
      id: "visible-qa",
      category: "contentStructure",
      label: "可见 Q&A 内容",
      score: visibleQuestionTotal >= 5 ? 5 : visibleQuestionTotal >= 2 ? 3 : visibleQuestionTotal === 1 ? 1 : 0,
      maxScore: 5,
      summary: `抽样页面共识别 ${visibleQuestionTotal} 个可见问题。`,
      evidence: visibleQaPages.map(page => `${page.title || page.finalUrl}：${page.visibleQuestionCount} 个问题`),
      urls: visibleQaPages.map(page => page.finalUrl),
      recommendation: "围绕真实搜索意图增加可见的问答内容，每个问题提供完整、具体、可验证的回答。",
    }),
    createCheck({
      id: "jsonld-valid",
      category: "structuredData",
      label: "JSON-LD 有效性",
      score: pagesWithJsonLd.length === 0 ? 0 : jsonLdErrors === 0 ? 4 : 2,
      maxScore: 4,
      summary: `${pagesWithJsonLd.length} 个页面包含 JSON-LD，发现 ${jsonLdErrors} 处解析错误。`,
      evidence: pagesWithJsonLd.slice(0, 5).map(page => `${page.title || page.finalUrl}：${page.structuredDataTypes.join("、")}`),
      urls: pages.filter(page => page.structuredDataErrors > 0).map(page => page.finalUrl),
      recommendation: "修复无效 JSON-LD，并确保标记内容与页面可见内容一致。",
    }),
    createCheck({
      id: "entity-schema",
      category: "structuredData",
      label: "品牌或人物实体标记",
      score: namedEntityPages.length > 0 && entitySchemaPages.length > 0 ? 5 : entitySchemaPages.length > 0 ? 3 : 0,
      maxScore: 5,
      summary: entitySchemaPages.length > 0
        ? `发现 ${entitySchemaPages.length} 个实体结构化页面。`
        : "未发现 Organization、Person、LocalBusiness 或 WebSite 实体标记。",
      evidence: pages.filter(page => page.entityNames.length > 0).map(page => `${page.finalUrl}：${page.entityNames.join("、")}`),
      urls: entitySchemaPages.map(page => page.finalUrl),
      recommendation: "使用 Organization 或 Person 等 Schema 明确主体名称、别名、官网、Logo、联系方式和 sameAs。",
    }),
    createCheck({
      id: "qa-schema",
      category: "structuredData",
      label: "Q&A 结构化对应",
      score: visibleQaPages.length > 0 && qaSchemaPages.length > 0 ? 3 : visibleQaPages.length > 0 ? 1 : 0,
      maxScore: 3,
      summary: `可见问答页面 ${visibleQaPages.length} 个，问答 Schema 页面 ${qaSchemaPages.length} 个。`,
      evidence: qaSchemaPages.map(page => `${page.title || page.finalUrl}：${page.structuredDataTypes.join("、")}`),
      urls: visibleQaPages.map(page => page.finalUrl),
      recommendation: "对真实可见的 FAQ 或问答使用匹配的 FAQPage、QAPage、Question 和 Answer 标记。",
    }),
    createCheck({
      id: "supporting-schema",
      category: "structuredData",
      label: "内容辅助 Schema",
      score: supportSchemaTypes.size >= 2 ? 3 : supportSchemaTypes.size === 1 ? 2 : 0,
      maxScore: 3,
      summary: supportSchemaTypes.size > 0
        ? `发现 ${Array.from(supportSchemaTypes).join("、")}。`
        : "未发现面包屑、文章、产品、服务或人物资料页标记。",
      evidence: Array.from(supportSchemaTypes),
      urls: pagesWithJsonLd.map(page => page.finalUrl),
      recommendation: "根据页面类型补充 BreadcrumbList、Article、Product、Service 或 ProfilePage。",
    }),
    createCheck({
      id: "entity-identity",
      category: "trust",
      label: "主体身份一致",
      score: scaled(namedEntityPages.length, pages.length, 4),
      maxScore: 4,
      summary: `${namedEntityPages.length}/${pages.length || 0} 个页面清晰出现目标主体名称。`,
      evidence: pages.filter(page => page.entityNames.length > 0).map(page => page.entityNames.join("、")),
      urls: namedEntityPages.map(page => page.finalUrl),
      recommendation: "统一主体全称、简称、别名和 Logo，并在首页、关于页及结构化数据中保持一致。",
    }),
    createCheck({
      id: "author-credentials",
      category: "trust",
      label: "作者与专业资质",
      score: scaled(authorPages.length, pages.length, 4),
      maxScore: 4,
      summary: `${authorPages.length}/${pages.length || 0} 个页面包含作者或专业资质信号。`,
      evidence: authorPages.slice(0, 6).map(page => `${page.title || page.finalUrl}：${[...page.authorSignals, ...page.credentialSignals].slice(0, 3).join("；")}`),
      urls: authorPages.map(page => page.finalUrl),
      recommendation: "为专业内容标明作者、审核人、真实资质和可验证身份页面。",
    }),
    createCheck({
      id: "about-contact",
      category: "trust",
      label: "关于与联系信息",
      score: trustPages.length >= 2 ? 3 : trustPages.length === 1 ? 2 : 0,
      maxScore: 3,
      summary: `在 ${trustPages.length} 个页面发现关于、联系、团队或合规入口。`,
      evidence: trustPages.flatMap(page => page.trustLinks).slice(0, 8),
      urls: trustPages.map(page => page.finalUrl),
      recommendation: "提供易发现的关于我们、团队、联系方式、隐私条款和主体备案信息。",
    }),
    createCheck({
      id: "dates-sources",
      category: "trust",
      label: "日期与外部依据",
      score: scaled(sourcedPages.length, pages.length, 4),
      maxScore: 4,
      summary: `${sourcedPages.length}/${pages.length || 0} 个页面包含日期或外部引用依据。`,
      evidence: sourcedPages.slice(0, 6).map(page => `${page.title || page.finalUrl}：日期 ${page.dateSignals.length}，外部引用 ${page.externalCitationCount}`),
      urls: sourcedPages.map(page => page.finalUrl),
      recommendation: "标明发布日期和更新时间，并链接到可核验的政策、研究、资质或原始数据来源。",
    }),
    createCheck({
      id: "llms-txt",
      category: "aiReadability",
      label: "LLMs 文本入口",
      score: llms?.valid ? 4 : llms?.available ? 1 : 0,
      maxScore: 4,
      summary: llms?.summary || "未发现 /llms.txt。",
      evidence: llms?.error ? [llms.error] : [],
      urls: llms ? [llms.url] : [],
      recommendation: "在 /llms.txt 提供简洁站点说明和关键 Markdown 资源链接；它是辅助入口，不替代 robots.txt 或 Sitemap。",
    }),
    createCheck({
      id: "semantic-html",
      category: "aiReadability",
      label: "语义化正文容器",
      score: scaled(semanticPages.length, pages.length, 3),
      maxScore: 3,
      summary: `${semanticPages.length}/${pages.length || 0} 个页面使用 main 或 article 容器。`,
      evidence: pages.slice(0, 6).map(page => `${page.title || page.finalUrl}：${page.semanticLandmarks.join("、") || "无语义容器"}`),
      urls: pages.filter(page => !semanticPages.includes(page)).map(page => page.finalUrl),
      recommendation: "使用 main、article、nav、header、footer 等语义标签组织页面。",
    }),
    createCheck({
      id: "language",
      category: "aiReadability",
      label: "页面语言声明",
      score: scaled(languagePages.length, pages.length, 1),
      maxScore: 1,
      summary: `${languagePages.length}/${pages.length || 0} 个页面声明了 HTML lang。`,
      evidence: languagePages.map(page => `${page.finalUrl}：${page.language}`),
      urls: pages.filter(page => !page.language).map(page => page.finalUrl),
      recommendation: "在 html 元素上声明正确的 lang，例如 zh-CN。",
    }),
    createCheck({
      id: "machine-links",
      category: "aiReadability",
      label: "机器可跟随链接",
      score: scaled(linkedPages.length, pages.length, 2),
      maxScore: 2,
      summary: `${linkedPages.length}/${pages.length || 0} 个页面提供足够的标准链接。`,
      evidence: linkedPages.slice(0, 5).map(page => `${page.title || page.finalUrl}：${page.internalLinkCount} 个`),
      urls: pages.filter(page => !linkedPages.includes(page)).map(page => page.finalUrl),
      recommendation: "核心导航和正文链接使用可直接读取的 href，不要只绑定点击脚本。",
    }),
  ]

  const categoryKeys = Object.keys(CATEGORY_LABELS) as GeoAuditCategory[]
  const dimensions = categoryKeys.map(key => {
    const categoryChecks = checks.filter(check => check.category === key)
    return {
      key,
      label: CATEGORY_LABELS[key],
      score: categoryChecks.reduce((sum, check) => sum + check.score, 0),
      maxScore: categoryChecks.reduce((sum, check) => sum + check.maxScore, 0),
    }
  })
  const score = checks.reduce((sum, check) => sum + check.score, 0)
  const strengths = checks.filter(check => check.status === "pass").map(check => check.label).slice(0, 5)
  const risks = checks.filter(check => check.status === "fail").map(check => `${check.label}：${check.summary}`).slice(0, 6)
  const actions = unique(
    checks
      .filter(check => check.status !== "pass")
      .sort((a, b) => a.priority.localeCompare(b.priority))
      .map(check => check.recommendation),
    8,
  )
  const level = score >= 85 ? "基础扎实" : score >= 70 ? "具备较好基础" : score >= 50 ? "存在明显改进空间" : "存在关键可见性障碍"

  return {
    checks,
    dimensions,
    score,
    summary: {
      executiveSummary: `本次网站 GEO 审计得分 ${score}/100，整体${level}。评分来自实际抓取页面、爬虫规则和结构证据。`,
      strengths,
      risks,
      actions,
    },
  }
}
