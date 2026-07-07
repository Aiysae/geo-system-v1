import { isPlatformName } from "@/lib/platform-blacklist"

export interface BrandAliasGroup {
  canonical: string
  aliases: string[]
  isTarget?: boolean
}

export interface BrandResolverInput {
  ourBrand?: string
  brandAliases?: string[]
  competitors?: string[]
  observedBrands?: string[]
}

export interface CanonicalBrand {
  key: string
  display: string
  isTarget: boolean
}

const GENERIC_BRAND_WORDS = new Set([
  "深圳",
  "香港",
  "深港",
  "本地",
  "附近",
  "全国",
  "海外",
  "高端",
  "性价比",
  "靠谱",
  "可靠",
  "专业",
  "优质",
  "环保",
  "进口",
  "国产",
  "全屋定制",
  "整装",
  "装修",
  "家装",
  "家居",
  "家具",
  "设计",
  "施工",
  "木作",
  "衣柜",
  "橱柜",
  "板材",
  "工艺",
  "案例",
  "口碑",
  "售后",
  "门店",
  "工厂",
  "套餐",
  "方案",
  "供应链",
  "报价",
  "验收",
  "品牌",
  "公司",
  "服务商",
  "供应商",
  "厂家",
  "商家",
  "团队",
  "机构",
  "平台",
])

const COMPANY_SUFFIX_RE =
  /(有限责任公司|股份有限公司|集团股份有限公司|科技有限公司|数字科技有限公司|集团有限公司|有限公司|集团|公司)$/u

export function normalizeBrandKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[\s　·・,，.。:：;；"'“”‘’`~!！?？\-_/\\|｜]+/g, "")
    .replace(COMPANY_SUFFIX_RE, "")
}

function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value)
}

function hasLatin(value: string): boolean {
  return /[a-z]/i.test(value)
}

function isGenericBrandName(value: string): boolean {
  const raw = value.trim()
  const key = normalizeBrandKey(raw)
  if (!raw || !key) return true
  if (GENERIC_BRAND_WORDS.has(raw) || GENERIC_BRAND_WORDS.has(key)) return true
  if (/(?:这类|几类|类型|维度|角度|标准|清单|能力|建议|选择|推荐)$/u.test(raw)) return true
  return /^(?:深圳|香港|深港|本地|附近|全国|海外)?(?:高端|性价比|靠谱|可靠|专业|优质|环保|进口|国产)?(?:全屋定制|整装|装修|家装|家居|家具|设计|施工|木作|衣柜|橱柜|公司|品牌|服务商|供应商|厂家|商家|门店|工厂|团队|机构|平台)+$/u.test(
    raw,
  )
}

export function isUsableBrandName(value: string): boolean {
  const raw = value.trim()
  const key = normalizeBrandKey(raw)
  if (!raw || !key) return false
  if (isPlatformName(raw) || isGenericBrandName(raw)) return false
  return key.length > 1
}

export function areBrandVariants(a: string, b: string): boolean {
  const na = normalizeBrandKey(a)
  const nb = normalizeBrandKey(b)
  if (!na || !nb) return false
  if (na === nb) return true

  const shorter = na.length <= nb.length ? na : nb
  const longer = na.length <= nb.length ? nb : na
  if (shorter.length < 2) return false
  if (GENERIC_BRAND_WORDS.has(shorter)) return false

  const shorterLooksSpecific =
    shorter.length >= 3 ||
    (hasCjk(shorter) && shorter.length >= 2) ||
    (hasLatin(shorter) && shorter.length >= 3)

  return shorterLooksSpecific && longer.includes(shorter)
}

export function parseAliasLine(value: string): BrandAliasGroup | null {
  const parts = value
    .split(/[|｜]/)
    .map(part => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  return {
    canonical: parts[0],
    aliases: parts.slice(1),
  }
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    const key = normalizeBrandKey(trimmed)
    if (!trimmed || !key || seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

function collectExplicitGroups(input: BrandResolverInput): BrandAliasGroup[] {
  const groups: BrandAliasGroup[] = []
  const ourBrand = input.ourBrand?.trim()
  if (ourBrand) {
    groups.push({
      canonical: ourBrand,
      aliases: uniqueValues(input.brandAliases ?? []),
      isTarget: true,
    })
  }

  for (const competitor of input.competitors ?? []) {
    const group = parseAliasLine(competitor)
    if (!group || !group.canonical.trim()) continue
    groups.push(group)
  }

  return groups
}

function chooseObservedDisplay(names: string[], frequency: Map<string, number>): string {
  return [...names].sort((a, b) => {
    const fa = frequency.get(normalizeBrandKey(a)) ?? 0
    const fb = frequency.get(normalizeBrandKey(b)) ?? 0
    if (fb !== fa) return fb - fa
    const aMixed = hasCjk(a) && hasLatin(a)
    const bMixed = hasCjk(b) && hasLatin(b)
    if (aMixed !== bMixed) return aMixed ? -1 : 1
    return b.length - a.length
  })[0] ?? names[0] ?? ""
}

export function createBrandResolver(input: BrandResolverInput) {
  const explicitGroups = collectExplicitGroups(input)
  const frequency = new Map<string, number>()
  const displayByKey = new Map<string, string>()
  const allNames: string[] = []

  function addName(value: string, force = false) {
    const trimmed = value.trim()
    const key = normalizeBrandKey(trimmed)
    if (!trimmed || !key) return
    if (!force && !isUsableBrandName(trimmed)) return
    if (!displayByKey.has(key)) displayByKey.set(key, trimmed)
    frequency.set(key, (frequency.get(key) ?? 0) + 1)
    allNames.push(trimmed)
  }

  for (const group of explicitGroups) {
    addName(group.canonical, true)
    for (const alias of group.aliases) addName(alias, true)
  }
  for (const brand of input.observedBrands ?? []) addName(brand)

  const keys = Array.from(displayByKey.keys())
  const parent = new Map(keys.map(key => [key, key]))

  function find(key: string): string {
    const p = parent.get(key)
    if (!p || p === key) return key
    const root = find(p)
    parent.set(key, root)
    return root
  }

  function union(a: string, b: string) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(rb, ra)
  }

  for (const group of explicitGroups) {
    const groupKeys = uniqueValues([group.canonical, ...group.aliases])
      .map(normalizeBrandKey)
      .filter(key => parent.has(key))
    for (const key of groupKeys.slice(1)) union(groupKeys[0], key)
  }

  for (let i = 0; i < keys.length; i++) {
    const a = displayByKey.get(keys[i]) ?? keys[i]
    for (let j = i + 1; j < keys.length; j++) {
      const b = displayByKey.get(keys[j]) ?? keys[j]
      if (areBrandVariants(a, b)) union(keys[i], keys[j])
    }
  }

  const namesByRoot = new Map<string, string[]>()
  for (const key of keys) {
    const root = find(key)
    const names = namesByRoot.get(root) ?? []
    names.push(displayByKey.get(key) ?? key)
    namesByRoot.set(root, names)
  }

  const targetKeys = new Set<string>()
  const knownDisplayByRoot = new Map<string, string>()
  for (const group of explicitGroups) {
    const groupKeys = uniqueValues([group.canonical, ...group.aliases])
      .map(normalizeBrandKey)
      .filter(key => parent.has(key))
    if (groupKeys.length === 0) continue
    const root = find(groupKeys[0])
    if (group.isTarget) targetKeys.add(root)
    if (!knownDisplayByRoot.has(root)) knownDisplayByRoot.set(root, group.canonical.trim())
  }

  const resolvedByKey = new Map<string, CanonicalBrand>()
  for (const [root, names] of namesByRoot.entries()) {
    const isTarget = targetKeys.has(root)
    const display = isTarget
      ? input.ourBrand?.trim() || chooseObservedDisplay(names, frequency)
      : knownDisplayByRoot.get(root) || chooseObservedDisplay(names, frequency)
    const canonical: CanonicalBrand = {
      key: isTarget ? `target:${normalizeBrandKey(display)}` : `brand:${root}`,
      display,
      isTarget,
    }
    for (const name of names) {
      resolvedByKey.set(normalizeBrandKey(name), canonical)
    }
  }

  function canonicalize(value: string): CanonicalBrand | null {
    const raw = value.trim()
    const key = normalizeBrandKey(raw)
    if (!raw || !key) return null
    const known = resolvedByKey.get(key)
    if (known) return known
    if (!isUsableBrandName(raw)) return null
    return {
      key: `brand:${key}`,
      display: raw,
      isTarget: explicitGroups.some(
        group => group.isTarget && [group.canonical, ...group.aliases].some(alias => areBrandVariants(raw, alias)),
      ),
    }
  }

  function canonicalizeList(values: string[]): CanonicalBrand[] {
    const seen = new Set<string>()
    const out: CanonicalBrand[] = []
    for (const value of values) {
      const canonical = canonicalize(value)
      if (!canonical || seen.has(canonical.key)) continue
      seen.add(canonical.key)
      out.push(canonical)
    }
    return out
  }

  return {
    canonicalize,
    canonicalizeList,
    explicitGroups,
    targetNames: uniqueValues(
      explicitGroups
        .filter(group => group.isTarget)
        .flatMap(group => [group.canonical, ...group.aliases]),
    ),
    knownNames: uniqueValues(explicitGroups.flatMap(group => [group.canonical, ...group.aliases])),
    observedNames: uniqueValues(allNames),
  }
}

export function collectObservedBrands(byModel: { [key: string]: Array<{ mentionedBrands?: string[] }> | undefined }): string[] {
  const out: string[] = []
  for (const items of Object.values(byModel)) {
    for (const item of items ?? []) {
      out.push(...(item.mentionedBrands ?? []))
    }
  }
  return out
}
