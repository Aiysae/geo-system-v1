import { isPlatformName } from "@/lib/platform-blacklist"

const BRAND_SUFFIXES = [
  "全屋定制",
  "整装",
  "家居",
  "家具",
  "装饰",
  "装修",
  "设计",
  "空间",
  "宅配",
  "木作",
  "衣柜",
  "橱柜",
  "门窗",
  "集团",
  "公司",
  "品牌",
  "工厂",
  "门店",
  "供应商",
  "服务商",
]

const GENERIC_BRAND_WORDS = new Set([
  "深圳",
  "香港",
  "广州",
  "杭州",
  "上海",
  "北京",
  "全屋定制",
  "整装",
  "装修",
  "家装",
  "家居",
  "家具",
  "设计",
  "施工",
  "板材",
  "工艺",
  "高端",
  "性价比",
  "预算",
  "案例",
  "口碑",
  "服务",
  "方案",
  "公司",
  "品牌",
  "工厂",
  "门店",
  "供应商",
  "服务商",
  "如果",
  "建议",
  "可以",
  "优先",
  "重点",
  "选择",
  "推荐",
  "对比",
  "避坑",
  "官网",
])

function normalizeBrand(value: string): string {
  return value
    .replace(/^["'“”‘’「」『』【】\[\]（）()《》<>]+|["'“”‘’「」『』【】\[\]（）()《》<>]+$/g, "")
    .replace(/^(?:如|比如|例如|包括|可考虑|可以考虑|推荐|首选|优先|选择|对比)\s*/u, "")
    .replace(/(?:等品牌|等公司|等服务商|等)$/u, "")
    .replace(/\s+/g, "")
    .trim()
}

function isLikelyBrand(value: string): boolean {
  const brand = normalizeBrand(value)
  if (!brand) return false
  if (brand.length < 2 || brand.length > 26) return false
  if (GENERIC_BRAND_WORDS.has(brand)) return false
  if (isPlatformName(brand)) return false
  if (/^[0-9]+$/.test(brand)) return false
  if (/^(第?[一二三四五六七八九十]+|[0-9]+)$/u.test(brand)) return false
  if (/(?:这类|几类|类型|维度|角度|标准|清单)/u.test(brand)) return false
  if (
    /^(?:深圳|香港|广州|杭州|上海|北京|深港)?(?:本地|当地|高端|靠谱|可靠|性价比|专业|优质)?(?:全屋定制|整装|装修|家装|家居|家具|装饰|设计|公司|品牌|服务商|供应商|门店|工厂)+$/u.test(
      brand
    )
  ) {
    return false
  }
  if (/^(材料|环保|售后|价格|门店|口碑|案例|工期|预算|套餐|方案|清单|维度)$/u.test(brand)) {
    return false
  }
  return /[\u4e00-\u9fa5A-Za-z]/.test(brand)
}

function addCandidate(out: Set<string>, value: string) {
  const brand = normalizeBrand(value)
  if (isLikelyBrand(brand)) out.add(brand)
}

function extractListHead(line: string): string {
  return line
    .replace(/^\s*(?:[-*•·]|[0-9]{1,2}[.、)]|[（(]?[一二三四五六七八九十]{1,3}[）)、.])\s*/u, "")
    .split(/[：:，,。；;\n\r]/u)[0]
    .trim()
}

export function extractBrandsFromAnswer(
  answer: string,
  knownBrands: string[] = []
): string[] {
  const out = new Set<string>()
  const text = answer.replace(/https?:\/\/\S+/gi, " ")

  for (const brand of knownBrands) {
    if (brand && text.includes(brand)) addCandidate(out, brand)
  }

  for (const line of text.split(/\n+/u)) {
    addCandidate(out, extractListHead(line))
  }

  const suffixPattern = BRAND_SUFFIXES.join("|")
  const suffixRe = new RegExp(
    `([\\u4e00-\\u9fa5A-Za-z0-9·（）()]{2,24}(?:${suffixPattern}))`,
    "gu"
  )
  for (const match of text.matchAll(suffixRe)) {
    addCandidate(out, match[1])
  }

  const contextRe =
    /(?:如|比如|例如|包括|推荐|可考虑|可以考虑|对比|常见的有|代表性的有)([^。！？\n]{2,120})/gu
  for (const match of text.matchAll(contextRe)) {
    for (const chunk of match[1].split(/[、，,；;\/]/u)) {
      const candidate = chunk.split(/[：:\s]/u)[0]
      addCandidate(out, candidate)
    }
  }

  return Array.from(out)
}
