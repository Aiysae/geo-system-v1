import type {
  AnalysisSubjectType,
  PenetrationByModel,
} from "@/types"
import {
  collectObservedBrands,
  createBrandResolver,
  parseAliasLine,
  type BrandResolverInput,
  type CanonicalBrand,
} from "@/lib/brand-canonicalization"
import { isPlatformName } from "@/lib/platform-blacklist"

export interface SubjectResolverInput extends BrandResolverInput {
  subjectType?: AnalysisSubjectType
}

const GENERIC_PERSON_WORDS = new Set([
  "医生",
  "医师",
  "律师",
  "老师",
  "教授",
  "专家",
  "主任",
  "院长",
  "博主",
  "主播",
  "达人",
  "创始人",
  "负责人",
  "工作人员",
  "从业者",
  "患者",
  "用户",
  "作者",
  "记者",
  "品牌",
  "公司",
  "医院",
  "律所",
  "机构",
  "平台",
])

const PERSON_PREFIX_RE = /^(?:dr\.?|doctor|prof\.?|教授|专家)\s*/iu
const PERSON_SUFFIX_RE =
  /(?:主任医师|副主任医师|主治医师|住院医师|执业医师|医师|医生|执业律师|律师|教授|研究员|专家|老师|博士|院长|主任|总监|创始人|先生|女士)+$/u
const PERSON_ORGANIZATION_RE =
  /(?:医院|诊所|门诊部|卫生院|律所|律师事务所|事务所|公司|集团|企业|学校|大学|学院|中心|机构|平台|协会|委员会|研究院|研究所|政府|部门)$/u

export function normalizePersonKey(value: string): string {
  let normalized = value
    .trim()
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/gu, "")
    .replace(PERSON_PREFIX_RE, "")
    .replace(/[，,。:：;；"'“”‘’`~!！?？_/\\|｜]+/gu, "")
    .trim()

  const withoutTitle = normalized.replace(PERSON_SUFFIX_RE, "").trim()
  if (isPlausiblePersonBase(withoutTitle)) normalized = withoutTitle

  return normalized
    .replace(/[\s　·・\-]+/gu, match => match.includes("·") || match.includes("・") ? "·" : "")
    .trim()
}

export function isUsablePersonName(value: string): boolean {
  const raw = value.trim()
  const key = normalizePersonKey(raw)
  if (!raw || !key || isPlatformName(raw)) return false
  if (GENERIC_PERSON_WORDS.has(raw) || GENERIC_PERSON_WORDS.has(key)) return false
  if (PERSON_ORGANIZATION_RE.test(raw) || PERSON_ORGANIZATION_RE.test(key)) return false
  if (/(?:某医生|某律师|某专家|相关人士|业内人士|工作人员|专业人士)$/u.test(raw)) return false
  return isPlausiblePersonBase(key)
}

export function arePersonVariants(a: string, b: string): boolean {
  const left = normalizePersonKey(a)
  const right = normalizePersonKey(b)
  return Boolean(left && right && left === right)
}

export function createSubjectResolver(input: SubjectResolverInput) {
  if (input.subjectType !== "person") return createBrandResolver(input)
  return createPersonResolver(input)
}

export function isSameSubject(
  a: string,
  b: string,
  subjectType: AnalysisSubjectType = "brand",
): boolean {
  if (subjectType === "person") return arePersonVariants(a, b)
  const resolver = createBrandResolver({
    ourBrand: b,
    observedBrands: [a],
  })
  return resolver.canonicalize(a)?.isTarget === true
}

export function collectObservedSubjects(
  byModel: PenetrationByModel,
  subjectType: AnalysisSubjectType = "brand",
): string[] {
  if (subjectType === "brand") return collectObservedBrands(byModel)
  const names: string[] = []
  for (const items of Object.values(byModel)) {
    for (const item of items || []) names.push(...(item.mentionedBrands || []))
  }
  return names
}

function createPersonResolver(input: SubjectResolverInput) {
  const targetName = input.ourBrand?.trim() || ""
  const explicitGroups = [
    ...(targetName
      ? [{
          canonical: targetName,
          aliases: uniquePersonNames(input.brandAliases || [], true),
          isTarget: true,
        }]
      : []),
    ...(input.competitors || [])
      .map(parseAliasLine)
      .filter((group): group is NonNullable<ReturnType<typeof parseAliasLine>> => !!group)
      .map(group => ({
        ...group,
        aliases: uniquePersonNames(group.aliases, true),
      })),
  ]

  const canonicalByKey = new Map<string, CanonicalBrand>()
  for (const group of explicitGroups) {
    const canonicalKey = normalizePersonKey(group.canonical)
    if (!canonicalKey) continue
    const canonical: CanonicalBrand = {
      key: group.isTarget ? `target:${canonicalKey}` : `person:${canonicalKey}`,
      display: group.canonical.trim(),
      isTarget: group.isTarget === true,
    }
    for (const name of [group.canonical, ...group.aliases]) {
      const key = normalizePersonKey(name)
      if (key) canonicalByKey.set(key, canonical)
    }
  }

  for (const observed of input.observedBrands || []) {
    if (!isUsablePersonName(observed)) continue
    const key = normalizePersonKey(observed)
    if (!key || canonicalByKey.has(key)) continue
    canonicalByKey.set(key, {
      key: `person:${key}`,
      display: observed.trim(),
      isTarget: false,
    })
  }

  function canonicalize(value: string): CanonicalBrand | null {
    const raw = value.trim()
    const key = normalizePersonKey(raw)
    if (!raw || !key) return null
    const known = canonicalByKey.get(key)
    if (known) return known
    if (!isUsablePersonName(raw)) return null
    return {
      key: `person:${key}`,
      display: raw,
      isTarget: false,
    }
  }

  function canonicalizeList(values: string[]): CanonicalBrand[] {
    const seen = new Set<string>()
    const result: CanonicalBrand[] = []
    for (const value of values) {
      const canonical = canonicalize(value)
      if (!canonical || seen.has(canonical.key)) continue
      seen.add(canonical.key)
      result.push(canonical)
    }
    return result
  }

  return {
    canonicalize,
    canonicalizeList,
    explicitGroups,
    targetNames: uniquePersonNames(
      explicitGroups
        .filter(group => group.isTarget)
        .flatMap(group => [group.canonical, ...group.aliases]),
      true,
    ),
    knownNames: uniquePersonNames(
      explicitGroups.flatMap(group => [group.canonical, ...group.aliases]),
      true,
    ),
    observedNames: uniquePersonNames(input.observedBrands || []),
  }
}

function uniquePersonNames(values: string[], force = false): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const raw = value.trim()
    const key = normalizePersonKey(raw)
    if (!raw || !key || seen.has(key)) continue
    if (!force && !isUsablePersonName(raw)) continue
    seen.add(key)
    result.push(raw)
  }
  return result
}

function isPlausiblePersonBase(value: string): boolean {
  if (/^[\u3400-\u9fff]{2,6}$/u.test(value)) return true
  if (/^[\u3400-\u9fff]{1,8}(?:·[\u3400-\u9fff]{1,8})+$/u.test(value)) return true
  if (/^[a-z][a-z.'-]{1,30}(?:\s+[a-z][a-z.'-]{1,30})+$/iu.test(value)) return true
  return /^[a-z]{3,40}$/iu.test(value)
}
