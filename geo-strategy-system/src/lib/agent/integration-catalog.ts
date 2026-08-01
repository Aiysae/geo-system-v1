export type AgentIntegrationKey =
  | "codex"
  | "claude"
  | "cursor"
  | "generic-mcp"
  | "cli"
  | "openapi"

export type AgentIntegration = {
  key: AgentIntegrationKey
  label: string
  shortLabel: string
  description: string
  recommended?: boolean
  fileName?: string
  setupLocation: string
}

export const AGENT_PUBLIC_BASE_URL = "https://shitugeo.top"
export const AGENT_MCP_URL = `${AGENT_PUBLIC_BASE_URL}/api/agent/mcp`
export const AGENT_OPENAPI_URL = `${AGENT_PUBLIC_BASE_URL}/api/agent/v1/openapi.json`

export const AGENT_INTEGRATIONS: readonly AgentIntegration[] = [
  {
    key: "codex",
    label: "Codex（桌面端 / CLI）",
    shortLabel: "Codex",
    description: "在 Codex 桌面端、CLI 和 IDE 扩展中使用同一套工具。",
    recommended: true,
    fileName: "shitu-geo-codex.toml",
    setupLocation: "Codex 设置 > MCP servers",
  },
  {
    key: "claude",
    label: "Claude Code",
    shortLabel: "Claude",
    description: "通过 Claude Code 的远程 HTTP MCP 直接调用势途 GEO。",
    fileName: "shitu-geo-claude.txt",
    setupLocation: "Claude Code 终端",
  },
  {
    key: "cursor",
    label: "Cursor Agent",
    shortLabel: "Cursor",
    description: "将势途 GEO 加入 Cursor 的 MCP 工具列表。",
    fileName: "shitu-geo-cursor.json",
    setupLocation: "~/.cursor/mcp.json",
  },
  {
    key: "generic-mcp",
    label: "其他 MCP Agent",
    shortLabel: "通用 MCP",
    description: "适用于支持 Streamable HTTP 和 Bearer Token 的 Agent。",
    fileName: "shitu-geo-mcp.json",
    setupLocation: "Agent 的 MCP 配置页",
  },
  {
    key: "cli",
    label: "势途 GEO CLI",
    shortLabel: "CLI",
    description: "用终端批量查询客户、提交任务和下载报告。",
    fileName: "shitu-geo-cli.txt",
    setupLocation: "macOS、Linux 或 Windows 终端",
  },
  {
    key: "openapi",
    label: "OpenAPI / 自建 Agent",
    shortLabel: "OpenAPI",
    description: "适用于企业自建 Agent、自动化平台和程序化集成。",
    fileName: "shitu-geo-api.txt",
    setupLocation: "你的 Agent 或自动化系统",
  },
] as const

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function integrationConfig(
  key: AgentIntegrationKey,
  token: string,
): string {
  const bearer = `Bearer ${token}`
  if (key === "codex") {
    return [
      "# 1. 先在系统环境变量中保存密钥，不要把明文写入 config.toml",
      '# macOS/Linux: export SHITU_GEO_TOKEN="<复制上方密钥>"',
      '# Windows PowerShell: [Environment]::SetEnvironmentVariable("SHITU_GEO_TOKEN", "<复制上方密钥>", "User")',
      "",
      "# 2. 添加到 ~/.codex/config.toml",
      "[mcp_servers.shitu_geo]",
      `url = \"${AGENT_MCP_URL}\"`,
      'bearer_token_env_var = "SHITU_GEO_TOKEN"',
      'default_tools_approval_mode = "writes"',
      "tool_timeout_sec = 120",
    ].join("\n")
  }
  if (key === "claude") {
    return `claude mcp add --transport http --scope user shitu-geo ${AGENT_MCP_URL} --header \"Authorization: ${bearer}\"`
  }
  if (key === "cursor" || key === "generic-mcp") {
    return json({
      mcpServers: {
        "shitu-geo": {
          type: "http",
          url: AGENT_MCP_URL,
          headers: { Authorization: bearer },
        },
      },
    })
  }
  if (key === "cli") {
    return [
      `curl -fsSL ${AGENT_PUBLIC_BASE_URL}/downloads/shitu-geo.mjs -o shitu-geo.mjs`,
      `node shitu-geo.mjs auth set --token \"${token}\" --base-url ${AGENT_PUBLIC_BASE_URL}`,
      "node shitu-geo.mjs auth status",
    ].join("\n")
  }
  return [
    `export SHITU_GEO_TOKEN=\"${token}\"`,
    `curl -H \"Authorization: Bearer $SHITU_GEO_TOKEN\" ${AGENT_PUBLIC_BASE_URL}/api/agent/v1/capabilities`,
    `OpenAPI: ${AGENT_OPENAPI_URL}`,
  ].join("\n")
}

export function integrationByKey(key: AgentIntegrationKey): AgentIntegration {
  return AGENT_INTEGRATIONS.find(item => item.key === key) || AGENT_INTEGRATIONS[0]
}
