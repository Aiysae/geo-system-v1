export type TeamRole = "owner" | "admin" | "member"
export type TeamMemberStatus = "active" | "suspended"
export type TeamStatus = "active" | "archived"
export type TeamShareScope = "all" | "selected"

export type TeamModuleKey =
  | "client"
  | "penetration"
  | "research"
  | "diagnosis"
  | "difficulty"
  | "keyword"
  | "article"
  | "feedback"
  | "report"

export type TeamPermissionAction = "view" | "execute" | "edit" | "export" | "manage"
export type TeamPermissionKey = `${TeamModuleKey}.${TeamPermissionAction}`

export type TeamModuleDefinition = {
  key: TeamModuleKey
  label: string
  description: string
  actions: readonly TeamPermissionAction[]
}

export type TeamPermissionGroup = {
  key: string
  label: string
  description: string
  modules: readonly TeamModuleKey[]
}

export type TeamPermissionPresetKey =
  | "viewer"
  | "detector"
  | "strategist"
  | "editor"
  | "project_manager"
  | "custom"

export type TeamPermissionPreset = {
  key: TeamPermissionPresetKey
  label: string
  description: string
  permissions: readonly TeamPermissionKey[]
}

export const TEAM_MODULES: readonly TeamModuleDefinition[] = [
  {
    key: "client",
    label: "客户资料",
    description: "查看和维护客户基础资料",
    actions: ["view", "edit", "manage"],
  },
  {
    key: "penetration",
    label: "渗透率情报",
    description: "疑问句检测、历史结果与导出",
    actions: ["view", "execute", "edit", "export", "manage"],
  },
  {
    key: "research",
    label: "独立调研",
    description: "品牌与竞品调研",
    actions: ["view", "execute", "edit", "export", "manage"],
  },
  {
    key: "diagnosis",
    label: "AI 诊断",
    description: "网站 GEO 诊断",
    actions: ["view", "execute", "edit", "export", "manage"],
  },
  {
    key: "difficulty",
    label: "难度测评",
    description: "难度、周期与执行成本测评",
    actions: ["view", "execute", "edit", "export", "manage"],
  },
  {
    key: "keyword",
    label: "关键词策略",
    description: "疑问句、优势与发文策略",
    actions: ["view", "execute", "edit", "export", "manage"],
  },
  {
    key: "article",
    label: "文章生成",
    description: "单篇、批量、改写与下载",
    actions: ["view", "execute", "edit", "export", "manage"],
  },
  {
    key: "feedback",
    label: "执行反馈",
    description: "动作记录、周报和月报",
    actions: ["view", "edit", "export", "manage"],
  },
  {
    key: "report",
    label: "专业报告",
    description: "生成、查看和下载专业报告",
    actions: ["view", "execute", "edit", "export", "manage"],
  },
] as const

export const TEAM_PERMISSION_GROUPS: readonly TeamPermissionGroup[] = [
  {
    key: "workspace",
    label: "客户与成果",
    description: "客户资料、历史成果与专业报告",
    modules: ["client", "report"],
  },
  {
    key: "insight",
    label: "情报洞察",
    description: "AI 可见度、联网调研与竞品对比",
    modules: ["penetration", "research"],
  },
  {
    key: "assessment",
    label: "诊断评估",
    description: "网站 GEO 诊断、执行难度与成本",
    modules: ["diagnosis", "difficulty"],
  },
  {
    key: "strategy",
    label: "策略规划",
    description: "关键词、疑问句、优势和发布规划",
    modules: ["keyword"],
  },
  {
    key: "content",
    label: "内容生产",
    description: "单篇、批量、改写和按计划生产",
    modules: ["article"],
  },
  {
    key: "feedback",
    label: "执行复盘",
    description: "动作证据、进度、周报与月报",
    modules: ["feedback"],
  },
] as const

const MODULE_MAP = new Map(TEAM_MODULES.map(module => [module.key, module]))
const VALID_PERMISSION_KEYS = new Set<TeamPermissionKey>(
  TEAM_MODULES.flatMap(module => (
    module.actions.map(action => `${module.key}.${action}` as TeamPermissionKey)
  )),
)

const ACTION_DEPENDENCIES: Partial<Record<TeamPermissionAction, readonly TeamPermissionAction[]>> = {
  execute: ["view"],
  edit: ["view"],
  export: ["view"],
  manage: ["view", "edit"],
}

function permissionsFor(
  modules: readonly TeamModuleKey[],
  actions: readonly TeamPermissionAction[],
): TeamPermissionKey[] {
  return modules.flatMap(module => {
    const definition = MODULE_MAP.get(module)
    if (!definition) return []
    return actions
      .filter(action => definition.actions.includes(action))
      .map(action => `${module}.${action}` as TeamPermissionKey)
  })
}

export const ALL_TEAM_PERMISSIONS = normalizeTeamPermissions(
  TEAM_MODULES.flatMap(module => (
    module.actions.map(action => `${module.key}.${action}`)
  )),
)

export const TEAM_PERMISSION_PRESETS: readonly TeamPermissionPreset[] = [
  {
    key: "viewer",
    label: "只读成员",
    description: "查看已共享客户及各模块历史结果",
    permissions: permissionsFor(
      TEAM_MODULES.map(module => module.key),
      ["view"],
    ),
  },
  {
    key: "detector",
    label: "检测专员",
    description: "维护检测问题并运行渗透率情报",
    permissions: normalizeTeamPermissions([
      ...permissionsFor(["client"], ["view"]),
      ...permissionsFor(["penetration"], ["view", "execute", "edit", "export"]),
      ...permissionsFor(["research", "diagnosis", "difficulty", "report"], ["view"]),
    ]),
  },
  {
    key: "strategist",
    label: "策略专员",
    description: "查看检测结果并生成、修改关键词策略",
    permissions: normalizeTeamPermissions([
      ...permissionsFor(["client", "penetration", "research", "diagnosis", "difficulty"], ["view"]),
      ...permissionsFor(["keyword"], ["view", "execute", "edit", "export"]),
      ...permissionsFor(["report"], ["view", "export"]),
    ]),
  },
  {
    key: "editor",
    label: "内容编辑",
    description: "使用文章生成、改写、批量任务和下载",
    permissions: normalizeTeamPermissions([
      ...permissionsFor(["client", "penetration", "keyword"], ["view"]),
      ...permissionsFor(["article"], ["view", "execute", "edit", "export"]),
    ]),
  },
  {
    key: "project_manager",
    label: "项目负责人",
    description: "操作全部业务模块，但不管理团队和客户归属",
    permissions: normalizeTeamPermissions(
      TEAM_MODULES.flatMap(module => (
        module.actions
          .filter(action => action !== "manage")
          .map(action => `${module.key}.${action}`)
      )),
    ),
  },
  {
    key: "custom",
    label: "自定义",
    description: "逐模块设置查看、执行、编辑、导出和管理权限",
    permissions: [],
  },
] as const

export function normalizeTeamPermissions(value: unknown): TeamPermissionKey[] {
  const input = Array.isArray(value) ? value : []
  const selected = new Set<TeamPermissionKey>()

  for (const raw of input) {
    const permission = String(raw || "").trim() as TeamPermissionKey
    if (!VALID_PERMISSION_KEYS.has(permission)) continue
    selected.add(permission)
    const separator = permission.lastIndexOf(".")
    const moduleKey = permission.slice(0, separator) as TeamModuleKey
    const action = permission.slice(separator + 1) as TeamPermissionAction
    for (const dependency of ACTION_DEPENDENCIES[action] || []) {
      const dependencyKey = `${moduleKey}.${dependency}` as TeamPermissionKey
      if (VALID_PERMISSION_KEYS.has(dependencyKey)) selected.add(dependencyKey)
    }
  }

  return Array.from(selected).sort()
}

export function permissionsForPreset(
  key: TeamPermissionPresetKey,
): TeamPermissionKey[] {
  const preset = TEAM_PERMISSION_PRESETS.find(item => item.key === key)
  return normalizeTeamPermissions(preset?.permissions || [])
}

export function isTeamPermissionKey(value: unknown): value is TeamPermissionKey {
  return VALID_PERMISSION_KEYS.has(String(value || "") as TeamPermissionKey)
}

export function hasTeamPermission(
  permissions: readonly TeamPermissionKey[],
  module: TeamModuleKey,
  action: TeamPermissionAction,
): boolean {
  return permissions.includes(`${module}.${action}` as TeamPermissionKey)
}

export function teamPermissionLabel(action: TeamPermissionAction): string {
  return {
    view: "查看",
    execute: "执行",
    edit: "编辑",
    export: "导出",
    manage: "管理",
  }[action]
}

export function teamRoleLabel(role: TeamRole): string {
  return {
    owner: "团队所有者",
    admin: "团队管理员",
    member: "团队成员",
  }[role]
}
