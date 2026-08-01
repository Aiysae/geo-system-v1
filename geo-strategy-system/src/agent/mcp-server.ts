import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import * as z from "zod/v4"
import { agentQuery, ShituAgentApiClient, ShituAgentClientError } from "@/agent/api-client"

type ToolValue = Record<string, unknown> | unknown[] | string | number | boolean | null

function success(value: ToolValue) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: { result: value },
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

function actionAnnotations() {
  return { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
}

export function createShituGeoMcpServer(input: {
  baseUrl: string
  token: string
  forwardedIp?: string
}): McpServer {
  const api = new ShituAgentApiClient(input)
  const server = new McpServer({ name: "shitu-geo", version: "1.0.0" })

  server.registerTool("shitu_list_clients", {
    title: "查看势途 GEO 客户",
    description: "列出当前 Agent Token 被授权访问的客户档案。开始任何客户相关操作前先调用此工具获取 clientId 和 teamId。",
    annotations: readOnlyAnnotations(),
  }, async () => {
    try { return success(await api.request("/clients")) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_get_client", {
    title: "读取客户模块资料",
    description: "按区段读取客户资料与已有结果。只请求当前任务需要的 sections，避免加载过多数据。",
    inputSchema: {
      clientId: z.string().min(1).describe("客户 ID"),
      teamId: z.string().optional().describe("团队共享客户必须提供团队 ID"),
      sections: z.array(z.enum(["core", "penetration", "research", "diagnosis", "difficulty", "knowledgeBase", "keywordStrategy", "articleGeneration", "jobs"])).default(["core"]),
    },
    annotations: readOnlyAnnotations(),
  }, async ({ clientId, teamId, sections }) => {
    try {
      return success(await api.request(`/clients/${encodeURIComponent(clientId)}${agentQuery({ teamId, sections: sections.join(",") })}`))
    } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_list_tasks", {
    title: "查看后台任务",
    description: "查看检测、文章、报告等后台任务的状态。任务创建后应通过此工具轮询，不要重复提交相同 requestId。",
    inputSchema: {
      clientId: z.string().optional(),
      teamId: z.string().optional(),
      status: z.enum(["queued", "running", "retrying", "succeeded", "partial", "failed", "cancelled", "blocked"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
    },
    annotations: readOnlyAnnotations(),
  }, async args => {
    try { return success(await api.request(`/tasks${agentQuery(args)}`)) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_get_task", {
    title: "读取单个任务",
    description: "读取任务进度、阶段、错误与结果入口。",
    inputSchema: { taskId: z.string().min(1) },
    annotations: readOnlyAnnotations(),
  }, async ({ taskId }) => {
    try { return success(await api.request(`/tasks/${encodeURIComponent(taskId)}`)) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_cancel_task", {
    title: "停止后台任务",
    description: "停止尚未完成且支持取消的任务。已完成部分会保留；调用前应向用户确认任务 ID。",
    inputSchema: { taskId: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ taskId }) => {
    try { return success(await api.request(`/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST" })) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_list_outputs", {
    title: "查看历史业务产出",
    description: "列出渗透率、独立调研、AI 诊断或难度测评的不可变历史产出。",
    inputSchema: {
      clientId: z.string().min(1),
      teamId: z.string().optional(),
      module: z.enum(["penetration", "research", "diagnosis", "difficulty"]),
      status: z.enum(["succeeded", "partial", "failed", "cancelled"]).optional(),
      days: z.number().int().min(0).max(365).optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(20),
    },
    annotations: readOnlyAnnotations(),
  }, async args => {
    try { return success(await api.request(`/outputs${agentQuery(args)}`)) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_get_output", {
    title: "读取完整业务产出",
    description: "按 outputId 获取原始请求、完整结果和证据快照。",
    inputSchema: { outputId: z.string().min(1), teamId: z.string().optional() },
    annotations: readOnlyAnnotations(),
  }, async ({ outputId, teamId }) => {
    try { return success(await api.request(`/outputs/${encodeURIComponent(outputId)}${agentQuery({ teamId })}`)) } catch (error) { return failure(error) }
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
    try { return success(await api.request(`/reports${agentQuery(args)}`)) } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_run_penetration", {
    title: "运行疑问句联网检测",
    description: "按势途 GEO 严格盲测规则提交渗透率检测。每个模型只接收原始疑问句，任务在后台运行。首次执行前建议 dryRun=true。",
    inputSchema: {
      clientId: z.string().min(1),
      teamId: z.string().optional(),
      requestId: z.string().regex(/^[A-Za-z0-9_-]{16,160}$/),
      ourBrand: z.string().min(1),
      brandAliases: z.array(z.string()).default([]),
      industry: z.string().default(""),
      competitors: z.array(z.string()).default([]),
      questions: z.array(z.string().min(1)).min(1).max(600),
      models: z.array(z.enum(["doubao", "deepseek", "qwen", "kimi", "ernie", "hunyuan"])).min(1).max(6),
      operation: z.enum(["replace", "append"]).default("replace"),
      dryRun: z.boolean().default(false),
    },
    annotations: actionAnnotations(),
  }, async args => {
    try {
      const { dryRun, ...payload } = args
      return success(await api.request("/actions/penetration.run", {
        method: "POST",
        body: { ...payload, dryRun },
      }))
    } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_run_difficulty", {
    title: "运行 GEO 难度测评",
    description: "提交行业或品牌/个人 IP 的难度、周期、内容数量和成本测算。任务在后台运行，首次执行前建议 dryRun=true。",
    inputSchema: {
      clientId: z.string().min(1),
      teamId: z.string().optional(),
      requestId: z.string().regex(/^[A-Za-z0-9_-]{16,160}$/),
      model: z.enum(["auto", "doubao", "deepseek", "qwen", "kimi", "ernie", "hunyuan"]).default("auto"),
      mode: z.enum(["industry", "brand"]),
      industry: z.string().min(1),
      region: z.string().default("全国"),
      scope: z.enum(["city", "province", "region", "national"]).default("national"),
      targetBrand: z.string().optional(),
      website: z.string().optional(),
      commercial: z.object({
        averageOrderValue: z.number().positive().optional(),
        grossMarginRate: z.number().positive().optional(),
        annualRepeatPurchases: z.number().positive().optional(),
        riskLevel: z.enum(["auto", "standard", "high_trust", "regulated", "strict"]).default("auto"),
      }).optional(),
      dryRun: z.boolean().default(false),
    },
    annotations: actionAnnotations(),
  }, async args => {
    try {
      const { dryRun, ...payload } = args
      return success(await api.request("/actions/difficulty.run", {
        method: "POST",
        body: { ...payload, dryRun },
      }))
    } catch (error) { return failure(error) }
  })

  server.registerTool("shitu_run_action", {
    title: "运行势途 GEO 业务动作",
    description: "提交渗透率检测、难度测评、后台业务、批量文章或专业报告。写操作必须提供稳定 requestId；不确定时先 dryRun=true 验证参数、权限和预计积分。任务提交成功后使用 shitu_get_task 轮询。",
    inputSchema: {
      action: z.enum(["penetration.run", "difficulty.run", "background.run", "article.batch.run", "report.create"]),
      payload: z.record(z.string(), z.unknown()).describe("与对应势途 GEO 业务动作一致的 JSON 参数，必须含 clientId 和 requestId"),
      dryRun: z.boolean().default(false),
    },
    annotations: actionAnnotations(),
  }, async ({ action, payload, dryRun }) => {
    try {
      return success(await api.request(`/actions/${encodeURIComponent(action)}`, {
        method: "POST",
        body: { ...payload, dryRun },
      }))
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

  return server
}
