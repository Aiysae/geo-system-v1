// Decides which web sources an article may rely on. Live search results mix
// government pages with document mills, shopping portals and GEO advertorials;
// articles may only cite national bodies, authoritative institutions and
// authoritative media.

export type SourceAuthorityTier =
  | "national"
  | "international"
  | "institution"
  | "media"
  | "government"

export interface SourceAuthority {
  tier: SourceAuthorityTier
  label: string
}

// Lower ranks are preferred when hits are ordered for the writer.
const TIER_RANK: Record<SourceAuthorityTier, number> = {
  national: 0,
  international: 1,
  institution: 2,
  media: 3,
  government: 4,
}

// Central government, NPC, courts, regulators and national platforms: the
// label directly before "gov.cn" (e.g. "samr" in openstd.samr.gov.cn).
// Local governments such as changsha.gov.cn are classified separately.
const NATIONAL_GOV_AGENCIES = new Set([
  "npc", "court", "spp", "ccdi",
  "ndrc", "moe", "most", "miit", "mps", "mca",
  "moj", "mof", "mohrss", "mnr", "mee", "mohurd",
  "mot", "mwr", "moa", "mofcom", "mct", "nhc",
  "mem", "pbc", "audit", "sasac", "customs",
  "chinatax", "samr", "nfra", "csrc", "stats",
  "cnipa", "cac", "nmpa", "sac", "ccgp", "gsxt",
  "nda", "nppa", "nrta", "safe", "ncac",
])

const INTERNATIONAL_SITES = new Set([
  "un.org", "who.int", "wto.org", "worldbank.org", "imf.org", "oecd.org", "iso.org",
  "itu.int", "wipo.int", "ilo.org", "unesco.org", "iec.ch", "w3.org",
])

const INSTITUTION_SITES = new Set([
  "cas.cn", "cass.cn", "cae.cn", "caict.ac.cn", "cnnic.cn", "cnnic.net.cn", "cesi.cn",
  "cnis.ac.cn", "cnki.net", "nature.com", "science.org", "thelancet.com", "nejm.org",
])

const MEDIA_SITES = new Set([
  // National and central media.
  "news.cn", "xinhuanet.com", "people.com.cn", "cctv.com", "cctv.cn", "cnr.cn", "cri.cn",
  "chinadaily.com.cn", "gmw.cn", "ce.cn", "chinanews.com.cn", "chinanews.com", "china.com.cn",
  "youth.cn", "cyol.com", "legaldaily.com.cn", "workercn.cn", "qstheory.cn", "jjckb.cn",
  "cnstock.com", "cs.com.cn", "stcn.com", "financialnews.com.cn", "cet.com.cn",
  // Authoritative financial and public-interest media.
  "caixin.com", "yicai.com", "21jingji.com", "eeo.com.cn", "thepaper.cn", "bjnews.com.cn",
  "jiemian.com",
  // International media.
  "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk", "nytimes.com", "wsj.com", "ft.com",
  "economist.com", "bloomberg.com", "theguardian.com", "nikkei.com", "afp.com",
])

// Paid placements and GEO advertorials often sit on authoritative domains;
// their titles promise rankings or buying advice rather than reporting.
const ADVERTORIAL_TITLE =
  /推荐|排行|排名|榜单|十大|top\s*\d|哪家好|哪家强|哪家靠谱|靠谱|口碑|选型参考|选购指南|避坑|品牌盘点|服务商盘点|首选|优选|第一梯队|测评|评测|软文|广告/i

// User-generated sections of otherwise authoritative domains.
const USER_CONTENT_HOST = /^(?:blog|bbs|home|my|tieba|club|forum|t|weibo)\./i

function parseHost(url: string): { host: string; path: string } | null {
  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol)) return null
    return { host: parsed.hostname.toLowerCase().replace(/^www\./, ""), path: parsed.pathname }
  } catch {
    return null
  }
}

function matchesSite(host: string, sites: Set<string>): boolean {
  const labels = host.split(".")
  for (let index = 0; index < labels.length - 1; index += 1) {
    if (sites.has(labels.slice(index).join("."))) return true
  }
  return false
}

function isNationalGovernmentHost(host: string): boolean {
  if (host === "gov.cn") return true
  const labels = host.split(".")
  return labels.length >= 3
    && labels.at(-2) === "gov"
    && labels.at(-1) === "cn"
    && NATIONAL_GOV_AGENCIES.has(labels.at(-3) || "")
}

function isHomepage(path: string): boolean {
  return /^\/?(?:(?:index|home|default)(?:\.(?:s?html?|php|aspx?|jsp))?)?\/?$/i.test(path)
}

/**
 * Classifies a source by its domain. Returns null for anything that is not a
 * national body, international organization, research institution or
 * authoritative media outlet, and for homepages, user-generated sections and
 * advertorial-style titles on those domains.
 */
export function classifySourceAuthority(url: string, title = ""): SourceAuthority | null {
  const parsed = parseHost(url)
  if (!parsed || USER_CONTENT_HOST.test(parsed.host)) return null
  if (isHomepage(parsed.path)) return null
  if (title && ADVERTORIAL_TITLE.test(title)) return null
  const { host } = parsed
  if (isNationalGovernmentHost(host)) return { tier: "national", label: "国家机关" }
  if (host.endsWith(".gov.cn") || host.endsWith(".gov") || /\.gov\.(?:hk|mo)$/.test(host)) {
    return { tier: "government", label: "政府机构" }
  }
  if (matchesSite(host, INTERNATIONAL_SITES)) return { tier: "international", label: "国际组织" }
  if (matchesSite(host, INSTITUTION_SITES) || host.endsWith(".edu.cn") || host.endsWith(".ac.cn")) {
    return { tier: "institution", label: "科研院所/高校" }
  }
  if (matchesSite(host, MEDIA_SITES)) return { tier: "media", label: "权威媒体" }
  return null
}

export function sourceAuthorityRank(authority: SourceAuthority): number {
  return TIER_RANK[authority.tier]
}

/** Hosts the user supplied as their own materials, which an article may cite. */
export function sourceHosts(urls: Array<string | undefined>): Set<string> {
  const hosts = new Set<string>()
  for (const url of urls) {
    const parsed = url ? parseHost(url.includes("://") ? url : `https://${url}`) : null
    if (parsed?.host) hosts.add(parsed.host)
  }
  return hosts
}

/** External links in a Markdown article that are neither authoritative nor user-supplied. */
export function findNonAuthoritativeCitations(article: string, allowedHosts: Set<string>): string[] {
  const urls = new Set<string>()
  for (const match of article.matchAll(/https?:\/\/[^\s)\]>"'，。；、]+/g)) urls.add(match[0])
  return [...urls].filter(url => {
    const parsed = parseHost(url)
    if (!parsed) return false
    if ([...allowedHosts].some(host => parsed.host === host || parsed.host.endsWith(`.${host}`))) return false
    return !classifySourceAuthority(url)
  })
}
