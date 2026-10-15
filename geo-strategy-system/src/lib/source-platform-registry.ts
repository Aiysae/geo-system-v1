import type { SourcePlatformCategory } from "@/types/geo-strategy"

export interface SourcePlatformDefinition {
  key: string
  name: string
  category: SourcePlatformCategory
  domains: string[]
  aliases: string[]
}

export type SourcePlatformResolution = SourcePlatformDefinition & {
  hostname: string
  known: boolean
}

export const SOURCE_PLATFORM_DEFINITIONS: SourcePlatformDefinition[] = [
  { key: "wechat", name: "微信公众号", category: "self_media", domains: ["mp.weixin.qq.com"], aliases: ["微信公众平台", "微信公号", "公众号"] },
  { key: "baijiahao", name: "百家号", category: "self_media", domains: ["baijiahao.baidu.com"], aliases: ["百度百家号"] },
  { key: "baidu-zhidao", name: "百度知道", category: "self_media", domains: ["zhidao.baidu.com"], aliases: [] },
  { key: "baidu-tieba", name: "百度贴吧", category: "self_media", domains: ["tieba.baidu.com"], aliases: ["贴吧"] },
  { key: "sohu", name: "搜狐", category: "self_media", domains: ["sohu.com"], aliases: ["搜狐号", "搜狐网"] },
  { key: "csdn", name: "CSDN", category: "self_media", domains: ["csdn.net"], aliases: ["CSDN博客"] },
  { key: "zhihu", name: "知乎", category: "self_media", domains: ["zhihu.com"], aliases: ["知乎专栏"] },
  { key: "toutiao", name: "今日头条", category: "self_media", domains: ["toutiao.com"], aliases: ["头条号", "头条"] },
  { key: "netease", name: "网易号", category: "self_media", domains: ["163.com"], aliases: ["网易", "网易新闻"] },
  { key: "tencent-news", name: "腾讯新闻", category: "self_media", domains: ["new.qq.com", "news.qq.com"], aliases: ["企鹅号", "腾讯网"] },
  { key: "sina", name: "新浪", category: "self_media", domains: ["sina.com.cn"], aliases: ["新浪网", "新浪新闻"] },
  { key: "weibo", name: "微博", category: "self_media", domains: ["weibo.com", "weibo.cn"], aliases: ["新浪微博"] },
  { key: "xiaohongshu", name: "小红书", category: "self_media", domains: ["xiaohongshu.com"], aliases: [] },
  { key: "bilibili", name: "哔哩哔哩", category: "self_media", domains: ["bilibili.com"], aliases: ["B站", "B站专栏"] },
  { key: "douyin", name: "抖音", category: "self_media", domains: ["douyin.com"], aliases: [] },
  { key: "kuaishou", name: "快手", category: "self_media", domains: ["kuaishou.com"], aliases: [] },
  { key: "jianshu", name: "简书", category: "self_media", domains: ["jianshu.com"], aliases: [] },
  { key: "douban", name: "豆瓣", category: "self_media", domains: ["douban.com"], aliases: [] },
  { key: "juejin", name: "掘金", category: "self_media", domains: ["juejin.cn"], aliases: ["稀土掘金"] },
  { key: "segmentfault", name: "SegmentFault", category: "industry_vertical", domains: ["segmentfault.com"], aliases: ["思否"] },
  { key: "oschina", name: "开源中国", category: "industry_vertical", domains: ["oschina.net"], aliases: [] },
  { key: "tubatu", name: "土巴兔", category: "industry_vertical", domains: ["tubatu.com", "to8to.com"], aliases: ["土巴兔装修网"] },
  { key: "autohome", name: "汽车之家", category: "industry_vertical", domains: ["autohome.com.cn"], aliases: [] },
  { key: "pcauto", name: "太平洋汽车", category: "industry_vertical", domains: ["pcauto.com.cn"], aliases: ["太平洋汽车网"] },
  { key: "zol", name: "中关村在线", category: "industry_vertical", domains: ["zol.com.cn"], aliases: ["ZOL"] },
  { key: "smzdm", name: "什么值得买", category: "industry_vertical", domains: ["smzdm.com"], aliases: [] },
  { key: "fang", name: "房天下", category: "industry_vertical", domains: ["fang.com"], aliases: ["搜房网"] },
  { key: "dianping", name: "大众点评", category: "industry_vertical", domains: ["dianping.com"], aliases: [] },
  { key: "36kr", name: "36氪", category: "industry_vertical", domains: ["36kr.com"], aliases: [] },
  { key: "huxiu", name: "虎嗅", category: "industry_vertical", domains: ["huxiu.com"], aliases: ["虎嗅网"] },
  { key: "chinaz", name: "站长之家", category: "industry_vertical", domains: ["chinaz.com"], aliases: [] },
  { key: "people", name: "人民网", category: "authority_media", domains: ["people.com.cn"], aliases: ["人民日报人民网"] },
  { key: "xinhua", name: "新华网", category: "authority_media", domains: ["xinhuanet.com", "news.cn"], aliases: ["新华社", "新华通讯社"] },
  { key: "cctv", name: "央视网", category: "authority_media", domains: ["cctv.com", "cntv.cn"], aliases: ["中央电视台", "央视"] },
  { key: "cnr", name: "央广网", category: "authority_media", domains: ["cnr.cn"], aliases: ["中央人民广播电台"] },
  { key: "china-com-cn", name: "中国网", category: "authority_media", domains: ["china.com.cn"], aliases: [] },
  { key: "chinanews", name: "中国新闻网", category: "authority_media", domains: ["chinanews.com.cn"], aliases: ["中新网"] },
  { key: "gmw", name: "光明网", category: "authority_media", domains: ["gmw.cn"], aliases: ["光明日报"] },
  { key: "ce", name: "中国经济网", category: "authority_media", domains: ["ce.cn"], aliases: ["经济日报"] },
  { key: "chinadaily", name: "中国日报网", category: "authority_media", domains: ["chinadaily.com.cn"], aliases: ["中国日报"] },
  { key: "youth", name: "中国青年网", category: "authority_media", domains: ["youth.cn"], aliases: ["中青网"] },
  { key: "legaldaily", name: "法治网", category: "authority_media", domains: ["legaldaily.com.cn"], aliases: ["法制日报", "法治日报"] },
  { key: "stdaily", name: "科技日报", category: "authority_media", domains: ["stdaily.com"], aliases: [] },
  { key: "thepaper", name: "澎湃新闻", category: "authority_media", domains: ["thepaper.cn"], aliases: ["澎湃"] },
  { key: "bjnews", name: "新京报", category: "authority_media", domains: ["bjnews.com.cn"], aliases: [] },
  { key: "nfnews", name: "南方+", category: "authority_media", domains: ["nfnews.com", "southcn.com"], aliases: ["南方日报", "南方网"] },
]

const SORTED_DEFINITIONS = [...SOURCE_PLATFORM_DEFINITIONS].sort((left, right) => (
  Math.max(...right.domains.map(domain => domain.length))
  - Math.max(...left.domains.map(domain => domain.length))
))

const NAME_LOOKUP = new Map<string, SourcePlatformDefinition>()
for (const definition of SOURCE_PLATFORM_DEFINITIONS) {
  for (const name of [definition.key, definition.name, ...definition.aliases]) {
    NAME_LOOKUP.set(normalizeSourcePlatformName(name), definition)
  }
}

export function normalizeSourcePlatformName(value: string): string {
  return String(value || "").toLowerCase().replace(/[\s·•/\\_\-—（）()]+/g, "")
}

export function sourcePlatformDomainMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

export function resolveSourcePlatformByName(value: string): SourcePlatformDefinition | null {
  const normalized = normalizeSourcePlatformName(value)
  if (!normalized) return null
  return NAME_LOOKUP.get(normalized) || null
}

export function resolveSourcePlatformByDomain(rawHostname: string): SourcePlatformResolution | null {
  const hostname = String(rawHostname || "").trim().toLowerCase().replace(/^www\./, "")
  if (!hostname) return null
  const known = SORTED_DEFINITIONS.find(definition => (
    definition.domains.some(domain => sourcePlatformDomainMatches(hostname, domain))
  ))
  if (known) return { ...known, hostname, known: true }
  if (hostname === "gov.cn" || hostname.endsWith(".gov.cn")) {
    return {
      key: `government:${hostname}`,
      name: "政府网站",
      category: "government_association",
      domains: [hostname],
      aliases: [],
      hostname,
      known: false,
    }
  }
  return {
    key: `domain:${hostname}`,
    name: hostname,
    category: "other",
    domains: [hostname],
    aliases: [],
    hostname,
    known: false,
  }
}

export function resolveSourcePlatformByUrl(rawUrl: string): SourcePlatformResolution | null {
  try {
    const parsed = new URL(String(rawUrl || "").trim())
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    return resolveSourcePlatformByDomain(parsed.hostname)
  } catch {
    return null
  }
}

export function sourcePlatformOptions(): Array<Pick<SourcePlatformDefinition, "key" | "name" | "category">> {
  return SOURCE_PLATFORM_DEFINITIONS.map(({ key, name, category }) => ({ key, name, category }))
}
