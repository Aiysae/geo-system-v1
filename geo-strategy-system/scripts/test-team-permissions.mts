import assert from "node:assert/strict"
const importedModule = await import("../src/lib/team-permissions")

const permissionsModule = (
  "default" in importedModule
    ? importedModule.default
    : importedModule
) as typeof import("../src/lib/team-permissions")

const {
  ALL_TEAM_PERMISSIONS,
  TEAM_MODULES,
  hasTeamPermission,
  normalizeTeamPermissions,
  permissionsForPreset,
} = permissionsModule

const normalized = normalizeTeamPermissions([
  "penetration.execute",
  "keyword.edit",
  "keyword.invalid",
  "unknown.view",
])

assert.equal(hasTeamPermission(normalized, "penetration", "execute"), true)
assert.equal(hasTeamPermission(normalized, "penetration", "view"), true)
assert.equal(hasTeamPermission(normalized, "keyword", "edit"), true)
assert.equal(hasTeamPermission(normalized, "keyword", "view"), true)
assert.equal(normalized.includes("keyword.invalid" as never), false)

const detector = permissionsForPreset("detector")
assert.equal(hasTeamPermission(detector, "penetration", "execute"), true)
assert.equal(hasTeamPermission(detector, "keyword", "edit"), false)

const strategist = permissionsForPreset("strategist")
assert.equal(hasTeamPermission(strategist, "keyword", "edit"), true)
assert.equal(hasTeamPermission(strategist, "article", "execute"), false)

assert.ok(ALL_TEAM_PERMISSIONS.length >= TEAM_MODULES.length)
assert.equal(new Set(ALL_TEAM_PERMISSIONS).size, ALL_TEAM_PERMISSIONS.length)

const workspaceModule = await import("../src/lib/team-workspace-permissions")
const {
  workspacePermissionRequirements,
} = (
  "default" in workspaceModule
    ? workspaceModule.default
    : workspaceModule
) as typeof import("../src/lib/team-workspace-permissions")

assert.deepEqual(
  workspacePermissionRequirements({
    patch: { questions: ["问题一"] },
    unsetFields: [],
  }),
  [{ module: "penetration", action: "edit" }],
)

assert.deepEqual(
  workspacePermissionRequirements({
    current: {
      backgroundJobs: {
        diagnosis: { id: "old" } as never,
      },
    } as never,
    patch: {
      backgroundJobs: {
        diagnosis: { id: "new" } as never,
        keywordStrategy: { id: "keyword" } as never,
      },
    },
    unsetFields: [],
  }),
  [
    { module: "diagnosis", action: "execute" },
    { module: "keyword", action: "execute" },
  ],
)

console.log("Team permission catalog tests passed.")
