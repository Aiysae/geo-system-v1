import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js"
import * as z from "zod/v4"
import { agentQuery, ShituAgentApiClient, ShituAgentClientError } from "@/agent/api-client"
import {
  AGENT_ACTIONS,
  agentActionInputSchema,
} from "@/lib/agent/action-catalog"
import type { AgentActionName } from "@/types/agent"

type ToolValue = Record<string, unknown> | unknown[] | string | number | boolean | null

function success(value: ToolValue) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: { result: value },
  }
}

function resourceLink(input: {
  uri: string
  name: string
  description: string
  mimeType: string
}) {
  return {
    content: [{
      type: "resource_link" as const,
      uri: input.uri,
      name: input.name,
      description: input.description,
      mimeType: input.mimeType,
    }],
    structuredContent: { result: input },
  }
}

function failure(error: unknown) {
  const normalized = error instanceof ShituAgentClientError
    ? {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        traceId: error.traceId,
      }
    : {
        code: "MCP_TOOL_ERROR",
        message: error instanceof Error ? error.message : "MCP 工具执行失败",
        retryable: false,
      }
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(normalized, null, 2) }],
    structuredContent: { error: normalized },
  }
}

function readOnlyAnnotations() {
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}

function actionAnnotations(input?: { readOnly?: boolean; destructive?: boolean }) {
  return {
    readOnlyHint: input?.readOnly === true,
    destructiveHint: input?.destructive === true,
    idempotentHint: true,
    openWorldHint: input?.readOnly !== true,
  }
}

const ACTION_TOOLS: ReadonlyArray<{
  tool: string
  action: AgentActionName
}> = AGENT_ACTIONS.flatMap(definition => definition.mcpTool
  ? [{ tool: definition.mcpTool, action: definition.name }]
  : [])

function actionMeta(action: AgentActionName) {
  const definition = AGENT_ACTIONS.find(item => item.name === action)
  if (!definition) throw new Error(`Agent 动作 ${action} 未注册`)
  return definition
}

function registerActionTools(server: McpServer, api: ShituAgentApiClient): void {
  for (const item of ACTION_TOOLS) {
    const definition = actionMeta(item.action)
    const schema = agentActionInputSchema(item.action) as z.ZodType<Record<string, unknown>>
    server.registerTool(item.tool, {
      title: definition.title,
      description: definition.readOnly
        ? definition.description
        : `${definition.description} 写操作必须提供稳定 requestId；首次执行建议先将 dryRun 设为 true。`,
      inputSchema: schema,
      annotations: actionAnnotations(definition),
    }, async args => {
      try {
        return success(await api.request(`/actions/${encodeURIComponent(item.action)}`, {
          method: "POST",
          body: args,
        }) as ToolValue)
      } catch (error) { return failure(error) }
    })
  }
}

function variable(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "")
}

export function createShituGeoMcpServer(input: {
  baseUrl: string
  token: string
  forwardedIp?: string
}): McpServer {
  const api = new ShituAgentApiClient(input)
  const server = new McpServer({ name: "shitu-geo", version: "1.10.0" }, {
    instructions: [
      "用户需求模糊、口语化或包含多个步骤时，首先调用 shitu_plan_request。",
      "任何客户业务必须先解析客户；匹配到多个客户时只追问一个关键问题，不得猜测 clientId。",
      "会扣积分或产生写入的动作先使用 dryRun=true，之后使用同一 requestId 正式提交。",
      "删除、取消和其他不可逆动作始终需要人工确认。",
      "后台任务创建后通过任务工具读取状态和真实结果，不重复提交相同业务。",
    ].join("\n"),
  })

  server.registerTool("shitu_plan_request", {
    title: "解析模糊需求并规划势途 GEO 工作流",
    description: "只读解释用户需求，匹配客户、模块、动作顺序和安全要求。不扣积分，不会直接执行业务。",
    inputSchema: {
      request: z.string().min(1).max(4_000).describe("用户原始需求，可以是口语化或模糊表达"),
      clientHint: z.string().max(300).optional().describe("可选的客户名、品牌名或人物名提示"),
    },
    annotations: readOnlyAnnotations(),
  }, async args => {
    try {
      return success(await api.request("/plan", { method: "POST", body: args }) as ToolValue)
    } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_list_clients", {
    title: "查看势途 GEO 客户",
    description: "列出当前 Agent Token 被授权访问的客户档案。开始任何客户相关操作前先获取 clientId 和 teamId。",
    annotations: readOnlyAnnotations(),
  }, async () => {
    try { return success(await api.request("/clients") as ToolValue) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_get_client", {
    title: "读取客户模块资料",
    description: "按区段读取客户资料与已有结果。只请求当前任务需要的 sections。",
    inputSchema: {
      clientId: z.string().min(1).describe("客户 ID"),
      teamId: z.string().optional().describe("团队共享客户必须提供团队 ID"),
      sections: z.array(z.enum(["core", "penetration", "research", "diagnosis", "difficulty", "knowledgeBase", "keywordStrategy", "articleGeneration", "jobs"])).default(["core"]),
    },
    annotations: readOnlyAnnotations(),
  }, async ({ clientId, teamId, sections }) => {
    try {
      return success(await api.request(`/clients/${encodeURIComponent(clientId)}${agentQuery({ teamId, sections: sections.join(",") })}`) as ToolValue)
    } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_list_tasks", {
    title: "查看后台任务",
    description: "分页查看检测、文章、报告等任务。任务创建后应轮询状态，不要重复提交相同 requestId。",
    inputSchema: {
      clientId: z.string().optional(),
      teamId: z.string().optional(),
      status: z.enum(["queued", "running", "retrying", "succeeded", "partial", "failed", "cancelled", "blocked"]).optional(),
      cursor: z.string().optional().describe("上一页返回的 nextCursor"),
      limit: z.number().int().min(1).max(100).default(50),
    },
    annotations: readOnlyAnnotations(),
  }, async args => {
    try { return success(await api.request(`/tasks${agentQuery(args)}`) as ToolValue) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_get_task", {
    title: "读取单个任务",
    description: "读取任务进度、阶段、错误与结果入口。",
    inputSchema: { taskId: z.string().min(1) },
    annotations: readOnlyAnnotations(),
  }, async ({ taskId }) => {
    try { return success(await api.request(`/tasks/${encodeURIComponent(taskId)}`) as ToolValue) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_get_task_result", {
    title: "读取任务真实结果",
    description: "读取任务对应的真实业务结果；任务尚未完成时会返回可重试错误。",
    inputSchema: { taskId: z.string().min(1) },
    annotations: readOnlyAnnotations(),
  }, async ({ taskId }) => {
    try { return success(await api.request(`/tasks/${encodeURIComponent(taskId)}/result`) as ToolValue) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_restore_task_result", {
    title: "恢复任务结果",
    description: "任务完成但工作区未显示时，从持久化任务记录恢复业务结果。",
    inputSchema: { taskId: z.string().min(1) },
    annotations: actionAnnotations(),
  }, async ({ taskId }) => {
    try { return success(await api.request(`/tasks/${encodeURIComponent(taskId)}/restore`, { method: "POST" }) as ToolValue) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_cancel_task", {
    title: "停止后台任务",
    description: "停止尚未完成且支持取消的任务。已完成部分会保留；调用前应向用户确认任务 ID。",
    inputSchema: { taskId: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ taskId }) => {
    try { return success(await api.request(`/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST" }) as ToolValue) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_list_outputs", {
    title: "查看历史业务产出",
    description: "分页列出 7 个业务模块产生的不可变云端历史产出。",
    inputSchema: {
      clientId: z.string().min(1),
      teamId: z.string().optional(),
      module: z.enum(["penetration", "research", "diagnosis", "difficulty", "keyword", "article", "feedback"]),
      status: z.enum(["succeeded", "partial", "failed", "cancelled"]).optional(),
      days: z.number().int().min(0).max(365).optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    },
    annotations: readOnlyAnnotations(),
  }, async args => {
    try { return success(await api.request(`/outputs${agentQuery(args)}`) as ToolValue) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_get_output", {
    title: "读取完整业务产出",
    description: "按 outputId 获取原始请求、完整结果和证据快照。",
    inputSchema: { outputId: z.string().min(1), teamId: z.string().optional() },
    annotations: readOnlyAnnotations(),
  }, async ({ outputId, teamId }) => {
    try { return success(await api.request(`/outputs/${encodeURIComponent(outputId)}${agentQuery({ teamId })}`) as ToolValue) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_list_reports", {
    title: "查看专业报告",
    description: "列出指定客户已生成或正在生成的专业报告。",
    inputSchema: {
      clientId: z.string().min(1),
      teamId: z.string().optional(),
      kind: z.string().optional(),
      status: z.string().optional(),
      days: z.number().int().min(0).max(365).optional(),
    },
    annotations: readOnlyAnnotations(),
  }, async args => {
    try { return success(await api.request(`/reports${agentQuery(args)}`) as ToolValue) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_get_report_pdf", {
    title: "获取专业报告 PDF",
    description: "返回受保护的 MCP PDF 资源链接，读取该资源即可获得完整报告文件。",
    inputSchema: { jobId: z.string().min(1) },
    annotations: readOnlyAnnotations(),
  }, async ({ jobId }) => resourceLink({
    uri: `shitu://reports/${encodeURIComponent(jobId)}/download.pdf`,
    name: `geo-report-${jobId}.pdf`,
    description: "势途 GEO 专业报告 PDF",
    mimeType: "application/pdf",
  }))

  server.registerTool("shitu_list_article_batches", {
    title: "查看批量文章任务",
    description: "列出指定客户的批量文章生成记录。",
    inputSchema: { clientId: z.string().min(1), teamId: z.string().optional() },
    annotations: readOnlyAnnotations(),
  }, async args => {
    try { return success(await api.request(`/articles/batches${agentQuery(args)}`) as ToolValue) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_get_article_settings", {
    title: "读取文章 Prompt 与模型目录",
    description: "读取当前系统实际可用的文章 Prompt、模型服务商、中转站和默认模型；生成前先调用，避免使用过期名称。",
    annotations: readOnlyAnnotations(),
  }, async () => {
    try { return success(await api.request("/articles/settings") as ToolValue) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_get_article_batch", {
    title: "读取批量文章结果",
    description: "读取批次进度、每篇文章质量状态及可下载范围。",
    inputSchema: { batchId: z.string().min(1) },
    annotations: readOnlyAnnotations(),
  }, async ({ batchId }) => {
    try { return success(await api.request(`/articles/batches/${encodeURIComponent(batchId)}`) as ToolValue) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_get_article_batch_zip", {
    title: "获取批量文章 ZIP",
    description: "返回受保护的 MCP ZIP 资源链接，可下载全部文章或仅质量通过的文章。",
    inputSchema: {
      batchId: z.string().min(1),
      scope: z.enum(["all", "passed", "direct"]).default("passed"),
      variant: z.enum(["original", "media"]).default("original"),
    },
    annotations: readOnlyAnnotations(),
  }, async ({ batchId, scope, variant }) => resourceLink({
    uri: `shitu://article-batches/${encodeURIComponent(batchId)}/${scope}/${variant}.zip`,
    name: `geo-articles-${batchId}-${scope}-${variant}.zip`,
    description: scope === "all"
      ? "全部批量文章"
      : scope === "direct"
        ? "直推榜单型优质文章"
        : "质量通过的批量文章",
    mimeType: "application/zip",
  }))

  server.registerTool("shitu_get_content_production_zip", {
    title: "获取分平台发布内容 ZIP",
    description: "返回受保护的 ZIP 资源链接，文章会按真实发布平台目录分组，并附带发布清单。",
    inputSchema: {
      runId: z.string().min(1),
      scope: z.enum(["all", "passed"]).default("passed"),
    },
    annotations: readOnlyAnnotations(),
  }, async ({ runId, scope }) => resourceLink({
    uri: `shitu://content-production/${encodeURIComponent(runId)}/${scope}.zip`,
    name: `geo-platform-content-${runId}-${scope}.zip`,
    description: scope === "all" ? "全部可读稿件（含待复核）" : "仅质检通过的分平台稿件",
    mimeType: "application/zip",
  }))

  server.registerTool("shitu_get_feedback", {
    title: "读取执行反馈",
    description: "读取客户执行日历、动作、周月报及发布策略。",
    inputSchema: { clientId: z.string().min(1), teamId: z.string().optional() },
    annotations: readOnlyAnnotations(),
  }, async ({ clientId, teamId }) => {
    try { return success(await api.request(`/feedback/${encodeURIComponent(clientId)}${agentQuery({ teamId })}`) as ToolValue) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_list_knowledge_imports", {
    title: "查看资料导入记录",
    description: "列出客户资料库最近的文件导入和审核状态。",
    inputSchema: { clientId: z.string().min(1), teamId: z.string().optional() },
    annotations: readOnlyAnnotations(),
  }, async args => {
    try { return success(await api.request(`/knowledge/imports${agentQuery(args)}`) as ToolValue) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_get_knowledge_import", {
    title: "读取资料导入候选项",
    description: "读取文件解析进度以及待人工审核的知识候选项。",
    inputSchema: {
      importId: z.string().min(1),
      clientId: z.string().min(1),
      teamId: z.string().optional(),
    },
    annotations: readOnlyAnnotations(),
  }, async ({ importId, clientId, teamId }) => {
    try { return success(await api.request(`/knowledge/imports/${encodeURIComponent(importId)}${agentQuery({ clientId, teamId })}`) as ToolValue) } catch (error) { return failure(error) }
  })

  registerActionTools(server, api)

  const actionNames = AGENT_ACTIONS.map(item => item.name) as [AgentActionName, ...AgentActionName[]]
  server.registerTool("shitu_run_action", {
    title: "兼容旧版势途 GEO 动作",
    description: "兼容旧 Agent 的通用 JSON 入口。新工作流应使用对应的专用工具，以获得明确参数校验。",
    inputSchema: {
      action: z.enum(actionNames),
      payload: z.record(z.string(), z.unknown()),
      dryRun: z.boolean().default(false),
    },
    annotations: actionAnnotations(),
  }, async ({ action, payload, dryRun }) => {
    try {
      return success(await api.request(`/actions/${encodeURIComponent(action)}`, {
        method: "POST",
        body: { ...payload, dryRun },
      }) as ToolValue)
    } catch (error) { return failure(error) }
  })

  server.registerResource(
    "shitu-agent-capabilities",
    "shitu://agent/capabilities",
    { title: "势途 GEO Agent 能力", description: "当前 Token 的权限、预算、动作和任务约定", mimeType: "application/json" },
    async uri => {
      const value = await api.request<ToolValue>("/capabilities")
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(value, null, 2) }] }
    },
  )

  server.registerResource(
    "shitu-report-pdf",
    new ResourceTemplate("shitu://reports/{jobId}/download.pdf", { list: undefined }),
    { title: "势途 GEO 专业报告", description: "按报告任务 ID 读取受保护的 PDF", mimeType: "application/pdf" },
    async (uri, variables) => {
      const jobId = variable(variables.jobId)
      const file = await api.requestBinary(`/reports/${encodeURIComponent(jobId)}/download`)
      return {
        contents: [{
          uri: uri.href,
          mimeType: file.contentType || "application/pdf",
          blob: Buffer.from(file.bytes).toString("base64"),
        }],
      }
    },
  )

  server.registerResource(
    "shitu-article-batch-zip",
    new ResourceTemplate("shitu://article-batches/{batchId}/{scope}/{variant}.zip", { list: undefined }),
    { title: "势途 GEO 批量文章", description: "按批次读取受保护的文章 ZIP", mimeType: "application/zip" },
    async (uri, variables) => {
      const batchId = variable(variables.batchId)
      const requestedScope = variable(variables.scope)
      const scope = requestedScope === "all" || requestedScope === "direct"
        ? requestedScope
        : "passed"
      const variant = variable(variables.variant) === "media" ? "media" : "original"
      const file = await api.requestBinary(`/articles/batches/${encodeURIComponent(batchId)}/download${agentQuery({ scope, variant })}`)
      return {
        contents: [{
          uri: uri.href,
          mimeType: file.contentType || "application/zip",
          blob: Buffer.from(file.bytes).toString("base64"),
        }],
      }
    },
  )

  server.registerResource(
    "shitu-content-production-zip",
    new ResourceTemplate("shitu://content-production/{runId}/{scope}.zip", { list: undefined }),
    { title: "势途 GEO 分平台发布内容", description: "按发布计划生产批次读取受保护的 ZIP", mimeType: "application/zip" },
    async (uri, variables) => {
      const runId = variable(variables.runId)
      const scope = variable(variables.scope) === "all" ? "all" : "passed"
      const file = await api.requestBinary(`/content-production/${encodeURIComponent(runId)}/download${agentQuery({ scope })}`)
      return {
        contents: [{
          uri: uri.href,
          mimeType: file.contentType || "application/zip",
          blob: Buffer.from(file.bytes).toString("base64"),
        }],
      }
    },
  )

  return server
}
