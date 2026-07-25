import type { MembershipTier } from "@/types"

export type ActiveMembershipTier = Exclude<MembershipTier, "free">

export type MembershipLevelDefinition = {
  tier: ActiveMembershipTier
  minPaidCents: number
  clientAccountLimit: number
  teamMemberLimit: number
  title: string
  benefits: readonly string[]
}

export const MEMBERSHIP_LEVELS: readonly MembershipLevelDefinition[] = [
  {
    tier: "vip1",
    minPaidCents: 1,
    clientAccountLimit: 0,
    teamMemberLimit: 0,
    title: "正式会员",
    benefits: ["解锁自定义公司名称与 Logo 的白标报告", "保留充值、积分与报告历史记录"],
  },
  {
    tier: "vip2",
    minPaidCents: 10_000,
    clientAccountLimit: 1,
    teamMemberLimit: 0,
    title: "客户服务版",
    benefits: ["包含 VIP1 全部权益", "可创建 1 个客户专属账号"],
  },
  {
    tier: "vip3",
    minPaidCents: 60_000,
    clientAccountLimit: 3,
    teamMemberLimit: 0,
    title: "多客户服务版",
    benefits: ["包含 VIP2 全部权益", "可创建 3 个客户专属账号", "关键词策略疑问句可由 AI 裁判自动分配模板并批量成文"],
  },
  {
    tier: "vip4",
    minPaidCents: 150_000,
    clientAccountLimit: 10,
    teamMemberLimit: 5,
    title: "业务增长版",
    benefits: ["包含 VIP3 全部权益", "可创建 10 个客户专属账号", "创建团队并邀请 5 名协作成员"],
  },
  {
    tier: "vip5",
    minPaidCents: 300_000,
    clientAccountLimit: 30,
    teamMemberLimit: 15,
    title: "机构运营版",
    benefits: ["包含 VIP4 全部权益", "可创建 30 个客户专属账号", "团队成员上限提升至 15 人"],
  },
  {
    tier: "vip6",
    minPaidCents: 1_000_000,
    clientAccountLimit: 100,
    teamMemberLimit: 50,
    title: "企业规模版",
    benefits: ["包含 VIP5 全部权益", "可创建 100 个客户专属账号", "团队成员上限提升至 50 人"],
  },
] as const

export const FREE_MEMBERSHIP_BENEFITS = [
  "使用 GEO 全链路操作工具的基础功能",
  "云端保存客户资料与历史结果",
] as const

export function membershipLevelForTier(
  tier: MembershipTier,
): MembershipLevelDefinition | undefined {
  return MEMBERSHIP_LEVELS.find(level => level.tier === tier)
}

export function membershipTierLabel(tier: MembershipTier): string {
  return tier === "free" ? "普通用户" : tier.toUpperCase()
}

export function membershipTeamMemberLimit(tier: MembershipTier): number {
  return membershipLevelForTier(tier)?.teamMemberLimit || 0
}
