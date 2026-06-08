const PLATFORM_NAMES: string[] = [
  // 内容社区 / UGC
  "小红书", "xiaohongshu", "rednote", "red", "小红薯",
  "抖音", "douyin", "tiktok",
  "快手", "kuaishou",
  "b站", "bilibili", "哔哩哔哩",
  "知乎", "zhihu",
  "微博", "weibo",
  "微信", "wechat", "weixin",
  "公众号", "微信公众号", "视频号", "朋友圈",
  "今日头条", "头条号", "toutiao",
  "百家号", "百度百家",
  "csdn",
  "掘金", "稀土掘金", "juejin",
  "简书", "jianshu",
  "豆瓣", "douban",
  "贴吧", "百度贴吧", "tieba",
  "虎扑", "hupu",
  "脉脉", "maimai",
  "什么值得买", "smzdm",
  "酷安", "coolapk",
  "github", "gitee", "码云",
  "stackoverflow", "stack overflow",
  "v2ex", "segmentfault", "思否",
  "medium", "dev.to", "reddit", "x.com", "twitter", "推特", "facebook", "linkedin", "领英", "instagram",
  // 电商
  "淘宝", "taobao",
  "天猫", "tmall",
  "1688", "阿里巴巴", "alibaba",
  "京东", "jd", "jd.com",
  "拼多多", "pdd", "pinduoduo",
  "唯品会",
  "苏宁",
  "当当",
  "美团", "meituan",
  "大众点评", "dianping",
  "饿了么", "ele.me",
  "亚马逊", "amazon",
  "ebay", "易贝",
  // 搜索 / 通用入口
  "百度", "baidu",
  "谷歌", "google",
  "bing", "必应",
  "搜狗", "sogou",
  "360搜索", "360 搜索", "360",
  "夸克", "quark",
  "yandex",
  "duckduckgo",
  // 应用市场
  "app store", "appstore", "苹果应用商店", "ios 应用商店",
  "google play", "play store",
  "华为应用市场", "应用宝", "小米应用商店", "vivo 应用商店", "oppo 软件商店",
  // AI 大模型本体（这些是"工具/平台"，不是行业品牌；除非用户就在问"AI 大模型"，否则不应当作行业品牌入榜）
  "豆包", "doubao",
  "deepseek", "深度求索",
  "通义", "通义千问", "qwen", "qwen2", "qwen3",
  "kimi", "月之暗面", "moonshot",
  "chatgpt", "openai", "gpt", "gpt-4", "gpt-5", "gpt4", "gpt5",
  "文心", "文心一言", "ernie",
  "claude", "anthropic",
  "gemini", "bard",
  "智谱", "chatglm", "智谱清言", "glm",
  "腾讯元宝", "元宝", "混元", "hunyuan", "tencent hunyuan",
  "讯飞星火", "星火", "spark",
  "perplexity", "phind", "you.com",
  "copilot", "github copilot", "ms copilot", "microsoft copilot",
  "midjourney", "stable diffusion", "sora",
  // 云厂商 / 基建（默认不当行业品牌；如果用户行业是"云服务"再人工取消注释）
  "阿里云", "aliyun",
  "腾讯云", "tencent cloud",
  "华为云", "huawei cloud",
  "百度智能云", "百度云",
  "火山引擎", "volcengine",
  "aws", "azure", "gcp",
]

const NORMALIZED = new Set(
  PLATFORM_NAMES.map(s => s.toLowerCase().replace(/\s+/g, ""))
)

// 明显作为"渠道/媒体/平台"后缀出现的词，例如 "XX 平台" / "XX 商城" / "XX 应用市场"
const PLATFORM_SUFFIX_RE = /(平台|商城|集市|应用市场|应用商店|搜索引擎|网站|官网|官方网站|媒体|网|网络|社区|论坛|频道|视频号|公众号|博客|生态|矩阵)$/

// 含 URL / 域名特征的也排除（避免把 "xx.com" 这种当品牌）
const URL_LIKE_RE = /(https?:\/\/|www\.|\.com|\.cn|\.net|\.io|\.top)/i

export function isPlatformName(name: string): boolean {
  if (!name) return false
  const trimmed = name.trim()
  const n = trimmed.toLowerCase().replace(/\s+/g, "")
  if (NORMALIZED.has(n)) return true
  if (PLATFORM_SUFFIX_RE.test(trimmed)) return true
  if (URL_LIKE_RE.test(trimmed)) return true
  // 长度 <= 1 的"品牌"基本是噪声
  if (trimmed.length <= 1) return true
  return false
}
