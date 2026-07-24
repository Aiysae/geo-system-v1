export const MANAGED_SERVICE_PLANS = [
  {
    key: "quarterly",
    name: "季度运营套餐",
    priceCents: 999_800,
    durationMonths: 3,
    badge: "启动优选",
    description: "适合完成首轮 GEO 基建、内容铺设和阶段复盘。",
  },
  {
    key: "half_year",
    name: "半年运营套餐",
    priceCents: 1_888_800,
    durationMonths: 6,
    badge: "持续增长",
    description: "适合持续优化品牌信源、内容矩阵与模型提及稳定性。",
  },
  {
    key: "annual",
    name: "年度运营套餐",
    priceCents: 3_388_800,
    durationMonths: 12,
    badge: "长期托管",
    description: "适合全年 GEO 运营、监测、内容执行和周期复盘。",
  },
] as const

export type ManagedServicePlanKey = (typeof MANAGED_SERVICE_PLANS)[number]["key"]
export type ManagedServicePlan = (typeof MANAGED_SERVICE_PLANS)[number]

export function getManagedServicePlan(key: string): ManagedServicePlan | null {
  return MANAGED_SERVICE_PLANS.find(plan => plan.key === key) || null
}
