import type { PublishingPlan, PublishingTaskPackage } from "@/types/publishing-plan"

export function publishingPlanForViewer(
  plan: PublishingPlan,
  costsVisible: boolean,
): PublishingPlan {
  if (costsVisible) return plan
  return {
    ...plan,
    input: {
      ...plan.input,
      totalServiceFeeCents: 0,
      executionCostRateBps: 0,
      contentCreationCostsCents: {
        article: 0,
        authority_article: 0,
        video: 0,
      },
      platformConfigs: plan.input.platformConfigs.map(platform => ({
        ...platform,
        publishUnitCostCents: 0,
      })),
    },
    calculation: {
      ...plan.calculation,
      windows: plan.calculation.windows.map(window => ({
        ...window,
        budgetCents: 0,
        allocatedCostCents: 0,
        unallocatedCostCents: 0,
      })),
      platformQuotas: plan.calculation.platformQuotas.map(quota => ({
        ...quota,
        plannedCostCents: 0,
      })),
      tasks: plan.calculation.tasks.map(task => ({
        ...task,
        plannedCostCents: 0,
        claimToken: undefined,
      })),
      summary: {
        ...plan.calculation.summary,
        executionBudgetCents: 0,
        plannedCostCents: 0,
        unallocatedBudgetCents: 0,
      },
      warnings: plan.calculation.warnings.filter(message => !/预算|成本|金额|元|分预算/.test(message)),
    },
  }
}

export function publishingTaskPackageForViewer(
  value: PublishingTaskPackage,
  costsVisible: boolean,
): PublishingTaskPackage {
  if (costsVisible) return value
  return {
    ...value,
    task: { ...value.task, plannedCostCents: 0, claimToken: undefined },
    platform: { ...value.platform, publishUnitCostCents: 0 },
  }
}
