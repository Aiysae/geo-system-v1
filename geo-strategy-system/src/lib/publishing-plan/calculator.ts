import type {
  PublishingBudgetWindow,
  PublishingContentAsset,
  PublishingContentType,
  PublishingPlanCalculation,
  PublishingPlanInput,
  PublishingPlatformConfig,
  PublishingPlatformQuota,
  PublishingTask,
} from "@/types/publishing-plan"

const MAX_PLAN_TASKS = 50_000
const PUBLISHING_CATEGORIES = new Set([
  "self_media",
  "industry_vertical",
  "authority_media",
  "government_association",
  "brand_official",
  "other",
])
const PUBLISHING_CONTENT_TYPES = new Set<PublishingContentType>([
  "article",
  "authority_article",
  "video",
])

export interface PublishingQuestionMaterial {
  id?: string
  question: string
  matchedAdvantage?: string
  promptKey?: string
}

export interface CalculatePublishingPlanContext {
  ownerUserId: string
  clientId: string
  planId: string
  planVersion: number
  questionMaterials?: PublishingQuestionMaterial[]
  now?: string
}

type Period = {
  index: number
  startDate: string
  endDate: string
  days: string[]
}

type WindowAllocation = {
  window: PublishingBudgetWindow
  counts: Map<string, number>
  actualCostCents: number
  capacityConstrainedPlatformIds: Set<string>
}

export function calculatePublishingPlan(
  rawInput: PublishingPlanInput,
  context: CalculatePublishingPlanContext,
): PublishingPlanCalculation {
  const input = normalizePublishingPlanInput(rawInput)
  const createdAt = context.now || new Date().toISOString()
  const executionBudgetCents = Math.floor(
    input.totalServiceFeeCents * input.executionCostRateBps / 10_000,
  )
  const periods = buildPeriods(input.startDate, input.endDate, input.periodMode)
  const periodBudgets = distributeInteger(
    executionBudgetCents,
    periodBudgetWeights(input, periods),
  )
  const windows = buildBudgetWindows(input, periods, periodBudgets)
  const enabledPlatforms = input.platformConfigs.filter(platform => platform.enabled)
  const warnings: string[] = []
  const allocations: WindowAllocation[] = []
  let remainingTaskCapacity = MAX_PLAN_TASKS

  for (const window of windows) {
    const allocation = allocateWindow(window, enabledPlatforms, input, remainingTaskCapacity)
    allocations.push(allocation)
    remainingTaskCapacity -= [...allocation.counts.values()].reduce((sum, count) => sum + count, 0)
    window.allocatedCostCents = allocation.actualCostCents
    window.unallocatedCostCents = Math.max(0, window.budgetCents - allocation.actualCostCents)
  }

  const assets: PublishingContentAsset[] = []
  const tasks: PublishingTask[] = []
  const questionMaterials = (context.questionMaterials || [])
    .map(item => ({
      ...item,
      question: String(item.question || "").trim(),
      matchedAdvantage: String(item.matchedAdvantage || "").trim() || undefined,
    }))
    .filter(item => item.question)
  let materialCursor = 0

  for (const [windowIndex, allocation] of allocations.entries()) {
    const days = dateRange(allocation.window.startDate, allocation.window.endDate)
    const configsByType = groupByContentType(enabledPlatforms)

    for (const contentType of Object.keys(configsByType) as PublishingContentType[]) {
      const configs = configsByType[contentType] || []
      const platformCounts = configs.map(config => allocation.counts.get(config.id) || 0)
      const totalCount = platformCounts.reduce((sum, count) => sum + count, 0)
      if (totalCount === 0) continue
      const reuseLimit = Math.max(
        1,
        Math.min(
          configs.length,
          ...configs.map(config => config.maxReusePlatforms),
        ),
      )
      const assetCount = requiredAssetCount(platformCounts, reuseLimit)
      const typedAssets: PublishingContentAsset[] = Array.from({ length: assetCount }, (_, index) => {
        const material = questionMaterials.length > 0
          ? questionMaterials[materialCursor++ % questionMaterials.length]
          : undefined
        const id = `asset_${safeId(context.planId)}_${windowIndex + 1}_${contentType}_${index + 1}`
        return {
          id,
          planId: context.planId,
          clientId: context.clientId,
          windowId: allocation.window.id,
          contentType,
          plannedDate: allocation.window.startDate,
          questionId: material?.id,
          question: material?.question,
          matchedAdvantage: material?.matchedAdvantage,
          promptKey: material?.promptKey,
          status: "planned",
          createdAt,
          updatedAt: createdAt,
        }
      })
      assets.push(...typedAssets)

      const assignmentCounts = new Map(typedAssets.map(asset => [asset.id, 0]))
      const creationCostCents = input.contentCreationCostsCents[contentType]
      const chargedAssets = new Set<string>()

      for (const config of configs) {
        const publicationCount = allocation.counts.get(config.id) || 0
        if (publicationCount <= 0) continue
        const selectedAssets = [...typedAssets]
          .sort((left, right) => (
            (assignmentCounts.get(left.id) || 0) - (assignmentCounts.get(right.id) || 0)
            || left.id.localeCompare(right.id)
          ))
          .slice(0, publicationCount)
        const tasksByDate = new Map<string, number>()

        selectedAssets.forEach((asset, index) => {
          assignmentCounts.set(asset.id, (assignmentCounts.get(asset.id) || 0) + 1)
          const dayIndex = publicationCount <= 1
            ? 0
            : Math.min(days.length - 1, Math.floor(index * days.length / publicationCount))
          const plannedDate = days[dayIndex]
          const dailyIndex = tasksByDate.get(plannedDate) || 0
          tasksByDate.set(plannedDate, dailyIndex + 1)
          const effectiveLimit = effectiveDailyLimit(config)
          const accountSlot = Math.floor(dailyIndex / effectiveLimit) + 1
          const creationCharge = chargedAssets.has(asset.id) ? 0 : creationCostCents
          chargedAssets.add(asset.id)
          if (plannedDate < asset.plannedDate) asset.plannedDate = plannedDate
          tasks.push({
            id: `pubtask_${safeId(context.planId)}_${windowIndex + 1}_${safeId(config.platformKey)}_${index + 1}`,
            ownerUserId: context.ownerUserId,
            planId: context.planId,
            planVersion: context.planVersion,
            clientId: context.clientId,
            assetId: asset.id,
            plannedDate,
            platformKey: config.platformKey,
            platformName: config.platformName,
            accountSlot,
            status: "planned",
            plannedCostCents: config.publishUnitCostCents + creationCharge,
            evidence: [],
            createdAt,
            updatedAt: createdAt,
          })
        })
      }
    }
  }

  if (tasks.length >= MAX_PLAN_TASKS) {
    warnings.push(`单个规划最多生成 ${MAX_PLAN_TASKS} 条发布任务，剩余预算暂未分配。`)
  }

  const platformQuotas = buildPlatformQuotas(enabledPlatforms, allocations, tasks, input.capacityMode)
  const plannedCostCents = tasks.reduce((sum, task) => sum + task.plannedCostCents, 0)
  const requiredAccountCount = platformQuotas.reduce((sum, item) => sum + item.requiredAccountCount, 0)
  const existingAccountCount = platformQuotas.reduce((sum, item) => sum + item.existingAccountCount, 0)
  const accountGap = platformQuotas.reduce((sum, item) => sum + item.accountGap, 0)
  const reusedPublicationCount = Math.max(0, tasks.length - assets.length)

  const constrainedPlatformIds = new Set(
    allocations.flatMap(allocation => [...allocation.capacityConstrainedPlatformIds]),
  )
  if (input.capacityMode === "existing_accounts" && constrainedPlatformIds.size > 0) {
    const names = enabledPlatforms
      .filter(platform => constrainedPlatformIds.has(platform.id))
      .map(platform => platform.platformName)
      .slice(0, 6)
    warnings.push(`已按现有账号容量限制 ${names.join("、")}${constrainedPlatformIds.size > names.length ? "等平台" : ""}的发布量，未分配预算不会生成虚拟账号任务。`)
  }
  if (input.capacityMode === "planned_expansion" && accountGap > 0) {
    warnings.push(`当前规划需新增 ${accountGap} 个平台账号，每个账号的日任务仍已限制在安全发布上限内。`)
  }
  if (plannedCostCents < executionBudgetCents) {
    warnings.push(`受整数篇数和平台单价影响，尚有 ${executionBudgetCents - plannedCostCents} 分预算未分配。`)
  }

  return {
    windows,
    platformQuotas,
    assets,
    tasks,
    summary: {
      executionBudgetCents,
      plannedCostCents,
      unallocatedBudgetCents: Math.max(0, executionBudgetCents - plannedCostCents),
      totalPublicationCount: tasks.length,
      uniqueContentCount: assets.length,
      reusedPublicationCount,
      reuseRate: tasks.length > 0
        ? Number((reusedPublicationCount / tasks.length).toFixed(4))
        : 0,
      requiredAccountCount,
      existingAccountCount,
      accountGap,
      activeDayCount: dateRange(input.startDate, input.endDate).length,
    },
    warnings,
    calculationVersion: "publishing-plan-v2",
  }
}

export function normalizePublishingPlanInput(raw: PublishingPlanInput): PublishingPlanInput {
  const startDate = normalizeDate(raw.startDate, "服务开始日期")
  const endDate = normalizeDate(raw.endDate, "服务结束日期")
  if (endDate < startDate) throw new Error("服务结束日期不能早于开始日期")
  if (dateRange(startDate, endDate).length > 3_660) throw new Error("发布规划最长支持 10 年")
  const totalServiceFeeCents = positiveInteger(raw.totalServiceFeeCents, "客户总服务费")
  if (totalServiceFeeCents > 10_000_000_000) throw new Error("客户总服务费超出规划上限")
  const executionCostRateBps = clampInteger(raw.executionCostRateBps, 3_000, 3_500, 3_250)
  const contentCreationCostsCents = {
    article: clampInteger(raw.contentCreationCostsCents?.article, 0, 10_000_000, 0),
    authority_article: clampInteger(raw.contentCreationCostsCents?.authority_article, 0, 10_000_000, 0),
    video: clampInteger(raw.contentCreationCostsCents?.video, 0, 10_000_000, 0),
  }
  const platformConfigs = (raw.platformConfigs || []).slice(0, 100).map((platform, index) => {
    const platformKey = String(platform.platformKey || `custom:${index + 1}`).trim().slice(0, 160) || `custom:${index + 1}`
    return {
      ...platform,
      id: safeId(platform.id || platformKey || `platform_${index + 1}`),
      platformKey,
      platformName: String(platform.platformName || "未命名平台").trim().slice(0, 120) || "未命名平台",
      category: PUBLISHING_CATEGORIES.has(platform.category) ? platform.category : "other",
      contentType: PUBLISHING_CONTENT_TYPES.has(platform.contentType) ? platform.contentType : "article",
      enabled: platform.enabled !== false,
      weightBps: clampInteger(platform.weightBps, 0, 10_000, 0),
      dailyLimitPerAccount: clampInteger(platform.dailyLimitPerAccount, 1, 1_000, 1),
      safeUtilizationBps: clampInteger(platform.safeUtilizationBps, 1_000, 10_000, 8_000),
      existingAccountCount: clampInteger(platform.existingAccountCount, 0, 10_000, 0),
      publishUnitCostCents: clampInteger(platform.publishUnitCostCents, 0, 10_000_000, 0),
      maxReusePlatforms: clampInteger(platform.maxReusePlatforms, 1, 100, 4),
    }
  })
  assertUniquePlatformFields(platformConfigs)
  const enabled = platformConfigs.filter(platform => platform.enabled)
  if (enabled.length === 0) throw new Error("请至少启用一个发布平台")
  if (enabled.every(platform => platform.weightBps <= 0)) throw new Error("已启用平台的权重不能全部为 0")
  if (enabled.some(platform => (
    platform.publishUnitCostCents + contentCreationCostsCents[platform.contentType] <= 0
  ))) {
    throw new Error("已启用平台的发布成本和对应内容制作成本不能同时为 0")
  }
  const normalizedEnabledWeights = normalizeWeights(enabled.map(platform => platform.weightBps), 10_000)
  let enabledIndex = 0
  const normalizedPlatforms = platformConfigs.map(platform => platform.enabled
    ? { ...platform, weightBps: normalizedEnabledWeights[enabledIndex++] }
    : platform)

  return {
    capacityMode: raw.capacityMode === "planned_expansion" ? "planned_expansion" : "existing_accounts",
    totalServiceFeeCents,
    executionCostRateBps,
    startDate,
    endDate,
    periodMode: raw.periodMode === "calendar" ? "calendar" : "service",
    customerStage: raw.customerStage === "maintenance" ? "maintenance" : "new_launch",
    firstMonthBudgetBps: clampInteger(raw.firstMonthBudgetBps, 1_000, 9_000, 5_000),
    firstSevenDaysBudgetBps: clampInteger(raw.firstSevenDaysBudgetBps, 1_000, 9_000, 5_000),
    servicePeriodWeightsBps: Array.isArray(raw.servicePeriodWeightsBps)
      ? raw.servicePeriodWeightsBps.slice(0, 120).map(value => clampInteger(value, 0, 10_000, 0))
      : undefined,
    contentCreationCostsCents,
    platformConfigs: normalizedPlatforms,
  }
}

function assertUniquePlatformFields(platforms: PublishingPlatformConfig[]): void {
  const ids = new Set<string>()
  const keys = new Set<string>()
  for (const platform of platforms) {
    if (ids.has(platform.id)) throw new Error(`平台 ID 重复：${platform.id}`)
    if (keys.has(platform.platformKey)) throw new Error(`平台标识重复：${platform.platformKey}`)
    ids.add(platform.id)
    keys.add(platform.platformKey)
  }
}

function allocateWindow(
  window: PublishingBudgetWindow,
  configs: PublishingPlatformConfig[],
  input: PublishingPlanInput,
  maxTasks: number,
): WindowAllocation {
  const counts = new Map(configs.map(config => [config.id, 0]))
  const capacityConstrainedPlatformIds = new Set<string>()
  if (maxTasks <= 0) return { window, counts, actualCostCents: 0, capacityConstrainedPlatformIds }
  const normalizedWeights = normalizeWeights(configs.map(config => config.weightBps), 10_000)
  const targetBudgets = distributeInteger(window.budgetCents, normalizedWeights)
  const windowDayCount = dateRange(window.startDate, window.endDate).length
  const platformCapacities = new Map(configs.map(config => [
    config.id,
    input.capacityMode === "existing_accounts"
      ? windowDayCount * effectiveDailyLimit(config) * config.existingAccountCount
      : maxTasks,
  ]))
  const effectiveCosts = configs.map(config => {
    const creationCost = input.contentCreationCostsCents[config.contentType]
    return Math.max(1, config.publishUnitCostCents + Math.ceil(creationCost / Math.max(1, config.maxReusePlatforms)))
  })

  configs.forEach((config, index) => {
    const requested = Math.max(0, Math.floor(targetBudgets[index] / effectiveCosts[index]))
    const capacity = platformCapacities.get(config.id) || 0
    if (requested > capacity) capacityConstrainedPlatformIds.add(config.id)
    counts.set(config.id, Math.min(requested, capacity))
  })

  let actualCost = allocationCost(counts, configs, input)
  let allocatedTasks = configs.reduce((sum, config) => sum + (counts.get(config.id) || 0), 0)
  if (allocatedTasks > maxTasks) {
    const limitedCounts = distributeInteger(
      maxTasks,
      configs.map(config => counts.get(config.id) || 0),
    )
    configs.forEach((config, index) => counts.set(config.id, limitedCounts[index]))
    allocatedTasks = maxTasks
    actualCost = allocationCost(counts, configs, input)
  }
  while (actualCost > window.budgetCents || allocatedTasks > maxTasks) {
    const removable = configs
      .filter(config => (counts.get(config.id) || 0) > 0)
      .sort((left, right) => {
        const leftIndex = configs.indexOf(left)
        const rightIndex = configs.indexOf(right)
        const leftRatio = ((counts.get(left.id) || 0) * effectiveCosts[leftIndex]) / Math.max(1, targetBudgets[leftIndex])
        const rightRatio = ((counts.get(right.id) || 0) * effectiveCosts[rightIndex]) / Math.max(1, targetBudgets[rightIndex])
        return rightRatio - leftRatio || right.publishUnitCostCents - left.publishUnitCostCents
      })[0]
    if (!removable) break
    counts.set(removable.id, (counts.get(removable.id) || 0) - 1)
    actualCost = allocationCost(counts, configs, input)
    allocatedTasks -= 1
  }

  let iterations = allocatedTasks
  while (iterations < maxTasks) {
    const candidates = configs.filter(config => (
      (counts.get(config.id) || 0) < (platformCapacities.get(config.id) || 0)
    )).map((config) => {
      const index = configs.indexOf(config)
      const nextCounts = new Map(counts)
      nextCounts.set(config.id, (nextCounts.get(config.id) || 0) + 1)
      const nextCost = allocationCost(nextCounts, configs, input)
      const currentWeightedSpend = (counts.get(config.id) || 0) * effectiveCosts[index]
      return {
        config,
        nextCost,
        deficit: targetBudgets[index] - currentWeightedSpend,
        weight: normalizedWeights[index],
      }
    }).filter(candidate => candidate.nextCost <= window.budgetCents)
    if (candidates.length === 0) break
    candidates.sort((left, right) => (
      right.deficit - left.deficit
      || right.weight - left.weight
      || left.nextCost - right.nextCost
      || left.config.platformName.localeCompare(right.config.platformName, "zh-CN")
    ))
    const selected = candidates[0]
    counts.set(selected.config.id, (counts.get(selected.config.id) || 0) + 1)
    actualCost = selected.nextCost
    iterations += 1
  }

  if (input.capacityMode === "existing_accounts" && actualCost < window.budgetCents) {
    for (const config of configs) {
      if ((counts.get(config.id) || 0) >= (platformCapacities.get(config.id) || 0)) {
        capacityConstrainedPlatformIds.add(config.id)
      }
    }
  }

  return { window, counts, actualCostCents: actualCost, capacityConstrainedPlatformIds }
}

function allocationCost(
  counts: Map<string, number>,
  configs: PublishingPlatformConfig[],
  input: PublishingPlanInput,
): number {
  let cost = 0
  const byType = groupByContentType(configs)
  for (const contentType of Object.keys(byType) as PublishingContentType[]) {
    const typedConfigs = byType[contentType] || []
    const typedCounts = typedConfigs.map(config => counts.get(config.id) || 0)
    const total = typedCounts.reduce((sum, count) => sum + count, 0)
    if (total === 0) continue
    const reuseLimit = Math.max(1, Math.min(
      typedConfigs.length,
      ...typedConfigs.map(config => config.maxReusePlatforms),
    ))
    cost += requiredAssetCount(typedCounts, reuseLimit) * input.contentCreationCostsCents[contentType]
    typedConfigs.forEach((config, index) => {
      cost += typedCounts[index] * config.publishUnitCostCents
    })
  }
  return cost
}

function requiredAssetCount(platformCounts: number[], reuseLimit: number): number {
  const total = platformCounts.reduce((sum, count) => sum + count, 0)
  return Math.max(
    ...platformCounts,
    Math.ceil(total / Math.max(1, reuseLimit)),
  )
}

function buildPlatformQuotas(
  configs: PublishingPlatformConfig[],
  allocations: WindowAllocation[],
  tasks: PublishingTask[],
  capacityMode: PublishingPlanInput["capacityMode"],
): PublishingPlatformQuota[] {
  return configs.map(config => {
    const platformTasks = tasks.filter(task => task.platformKey === config.platformKey)
    const countsByDate = new Map<string, number>()
    for (const task of platformTasks) {
      countsByDate.set(task.plannedDate, (countsByDate.get(task.plannedDate) || 0) + 1)
    }
    const peakDailyCount = Math.max(0, ...countsByDate.values())
    const limit = effectiveDailyLimit(config)
    const requiredAccountCount = peakDailyCount > 0 ? Math.ceil(peakDailyCount / limit) : 0
    const plannedAccountCount = requiredAccountCount
    const additionalAccountCount = Math.max(0, plannedAccountCount - config.existingAccountCount)
    const capacityConstrained = allocations.some(allocation => (
      allocation.capacityConstrainedPlatformIds.has(config.id)
    ))
    return {
      platformKey: config.platformKey,
      platformName: config.platformName,
      category: config.category,
      contentType: config.contentType,
      weightBps: config.weightBps,
      publicationCount: platformTasks.length,
      plannedCostCents: platformTasks.reduce((sum, task) => sum + task.plannedCostCents, 0),
      peakDailyCount,
      dailyLimitPerAccount: config.dailyLimitPerAccount,
      safeUtilizationBps: config.safeUtilizationBps,
      dailyCapacity: limit * (
        capacityMode === "existing_accounts"
          ? config.existingAccountCount
          : plannedAccountCount
      ),
      requiredAccountCount,
      plannedAccountCount,
      additionalAccountCount,
      existingAccountCount: config.existingAccountCount,
      accountGap: additionalAccountCount,
      effectiveDailyLimitPerAccount: limit,
      capacityMode,
      capacityConstrained,
      windowCounts: Object.fromEntries(allocations.map(allocation => [
        allocation.window.id,
        allocation.counts.get(config.id) || 0,
      ])),
    }
  }).sort((left, right) => right.publicationCount - left.publicationCount || left.platformName.localeCompare(right.platformName, "zh-CN"))
}

function periodBudgetWeights(input: PublishingPlanInput, periods: Period[]): number[] {
  const explicit = input.servicePeriodWeightsBps
  if (explicit?.length === periods.length && explicit.some(value => value > 0)) {
    return normalizeWeights(explicit, 10_000)
  }
  if (input.customerStage === "maintenance" || periods.length === 1) {
    return normalizeWeights(periods.map(period => period.days.length), 10_000)
  }
  const first = input.firstMonthBudgetBps
  const remaining = normalizeWeights(periods.slice(1).map(() => 1), 10_000 - first)
  return [first, ...remaining]
}

function buildBudgetWindows(
  input: PublishingPlanInput,
  periods: Period[],
  budgets: number[],
): PublishingBudgetWindow[] {
  const windows: PublishingBudgetWindow[] = []
  periods.forEach((period, index) => {
    if (index === 0 && input.customerStage === "new_launch" && period.days.length > 7) {
      const split = distributeInteger(budgets[index], [input.firstSevenDaysBudgetBps, 10_000 - input.firstSevenDaysBudgetBps])
      windows.push({
        id: "period_1_burst",
        label: "首月前 7 天冲刺",
        periodIndex: 1,
        startDate: period.days[0],
        endDate: period.days[6],
        budgetCents: split[0],
        allocatedCostCents: 0,
        unallocatedCostCents: split[0],
      })
      windows.push({
        id: "period_1_followup",
        label: "首月后续执行",
        periodIndex: 1,
        startDate: period.days[7],
        endDate: period.days[period.days.length - 1],
        budgetCents: split[1],
        allocatedCostCents: 0,
        unallocatedCostCents: split[1],
      })
      return
    }
    windows.push({
      id: `period_${index + 1}`,
      label: `${input.periodMode === "service" ? "服务" : "自然"}第 ${index + 1} 月`,
      periodIndex: index + 1,
      startDate: period.startDate,
      endDate: period.endDate,
      budgetCents: budgets[index],
      allocatedCostCents: 0,
      unallocatedCostCents: budgets[index],
    })
  })
  return windows
}

function buildPeriods(startDate: string, endDate: string, mode: PublishingPlanInput["periodMode"]): Period[] {
  const periods: Period[] = []
  let cursor = startDate
  let index = 0
  while (cursor <= endDate && index < 120) {
    const next = mode === "calendar"
      ? firstDayOfNextMonth(cursor)
      : addAnchoredMonths(startDate, index + 1)
    const periodEnd = minDate(endDate, addDays(next, -1))
    periods.push({
      index: index + 1,
      startDate: cursor,
      endDate: periodEnd,
      days: dateRange(cursor, periodEnd),
    })
    cursor = addDays(periodEnd, 1)
    index += 1
  }
  return periods
}

function groupByContentType(configs: PublishingPlatformConfig[]): Record<PublishingContentType, PublishingPlatformConfig[]> {
  return {
    article: configs.filter(config => config.contentType === "article"),
    authority_article: configs.filter(config => config.contentType === "authority_article"),
    video: configs.filter(config => config.contentType === "video"),
  }
}

function effectiveDailyLimit(config: PublishingPlatformConfig): number {
  return Math.max(1, Math.floor(config.dailyLimitPerAccount * config.safeUtilizationBps / 10_000))
}

export function distributeInteger(total: number, rawWeights: number[]): number[] {
  if (rawWeights.length === 0) return []
  const weights = rawWeights.map(value => Math.max(0, Number(value) || 0))
  const sum = weights.reduce((value, weight) => value + weight, 0)
  if (sum <= 0) return weights.map(() => 0)
  const exact = weights.map(weight => total * weight / sum)
  const values = exact.map(Math.floor)
  let remainder = Math.max(0, Math.floor(total) - values.reduce((value, item) => value + item, 0))
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)
  for (let index = 0; remainder > 0; index = (index + 1) % order.length) {
    values[order[index].index] += 1
    remainder -= 1
  }
  return values
}

function normalizeWeights(weights: number[], total: number): number[] {
  return distributeInteger(total, weights)
}

function normalizeDate(value: unknown, label: string): string {
  const date = String(value || "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`${label}格式无效`)
  }
  return date
}

function dateRange(startDate: string, endDate: string): string[] {
  const values: string[] = []
  for (let cursor = startDate; cursor <= endDate; cursor = addDays(cursor, 1)) values.push(cursor)
  return values
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function addAnchoredMonths(value: string, amount: number): string {
  const [year, month, day] = value.split("-").map(Number)
  const target = new Date(Date.UTC(year, month - 1 + amount, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`
}

function firstDayOfNextMonth(value: string): string {
  const [year, month] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month, 1))
  return date.toISOString().slice(0, 10)
}

function minDate(left: string, right: string): string {
  return left < right ? left : right
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label}必须大于 0`)
  return parsed
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function safeId(value: string): string {
  return String(value || "id").replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 180)
}
