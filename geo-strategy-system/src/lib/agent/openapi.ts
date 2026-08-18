import "server-only"

import { AGENT_ACTIONS } from "@/lib/agent/action-catalog"
import { ALL_AGENT_SCOPES } from "@/lib/agent/scopes"

export function agentOpenApiDocument(origin: string): Record<string, unknown> {
  const security = [{ AgentBearer: [] }]
  const json = { "application/json": { schema: { type: "object", additionalProperties: true } } }
  const success = {
    description: "成功",
    content: json,
  }
  const error = {
    description: "标准错误响应",
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorResponse" },
      },
    },
  }
  const actionPaths = Object.fromEntries(AGENT_ACTIONS.map(action => [
    `/actions/${action.name}`,
    {
      post: {
        tags: ["Action"],
        operationId: action.name.replace(/\./g, "_"),
        summary: action.title,
        description: action.description,
        deprecated: action.deprecated === true,
        requestBody: {
          required: true,
          content: { "application/json": { schema: action.inputSchema } },
        },
        responses: { 200: success, 201: success, 202: success, 400: error, 401: error, 403: error, 409: error, 429: error },
        "x-required-scope": action.requiredScope,
        "x-task-source": action.taskSource,
        "x-mcp-tool": action.mcpTool,
        "x-read-only": action.readOnly === true,
        "x-destructive": action.destructive === true,
      },
    },
  ]))

  return {
    openapi: "3.1.0",
    info: {
      title: "势途 GEO Agent API",
      version: "1.9.0",
      description: "供 CLI、MCP 和自动化 Agent 安全调用势途 GEO 现有业务能力。耗时操作进入后台任务；资料审核与动作记录等轻量写操作同步完成。所有操作沿用网页端权限、积分、联网与质量规则。",
    },
    externalDocs: {
      description: "势途 GEO Agent 接入说明",
      url: `${origin}/agent`,
    },
    "x-shitu-mcp-url": `${origin}/api/agent/mcp`,
    servers: [{ url: `${origin}/api/agent/v1` }],
    security,
    tags: [
      { name: "Capability" },
      { name: "Client" },
      { name: "Task" },
      { name: "Output" },
      { name: "Report" },
      { name: "Article" },
      { name: "Feedback" },
      { name: "Knowledge" },
      { name: "Action" },
    ],
    paths: {
      "/capabilities": {
        get: { tags: ["Capability"], operationId: "getCapabilities", responses: { 200: success, 401: error, 403: error } },
      },
      "/clients": {
        get: { tags: ["Client"], operationId: "listClients", responses: { 200: success, 401: error, 403: error } },
      },
      "/clients/{clientId}": {
        get: {
          tags: ["Client"],
          operationId: "getClient",
          parameters: [
            { $ref: "#/components/parameters/ClientId" },
            { $ref: "#/components/parameters/TeamId" },
            { name: "sections", in: "query", schema: { type: "string", default: "core" }, description: "逗号分隔：core,penetration,research,diagnosis,difficulty,knowledgeBase,keywordStrategy,articleGeneration,jobs" },
          ],
          responses: { 200: success, 400: error, 401: error, 403: error, 404: error },
        },
      },
      "/tasks": {
        get: {
          tags: ["Task"],
          operationId: "listTasks",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
            { name: "clientId", in: "query", schema: { type: "string" } },
            { $ref: "#/components/parameters/TeamId" },
            { name: "status", in: "query", schema: { $ref: "#/components/schemas/TaskStatus" } },
            { name: "cursor", in: "query", schema: { type: "string" }, description: "上一页返回的 nextCursor" },
          ],
          responses: { 200: success, 401: error, 403: error },
        },
      },
      "/tasks/{taskId}": {
        get: {
          tags: ["Task"],
          operationId: "getTask",
          parameters: [{ $ref: "#/components/parameters/TaskId" }],
          responses: { 200: success, 401: error, 403: error, 404: error },
        },
      },
      "/tasks/{taskId}/cancel": {
        post: {
          tags: ["Task"],
          operationId: "cancelTask",
          parameters: [{ $ref: "#/components/parameters/TaskId" }],
          responses: { 200: success, 401: error, 403: error, 404: error },
        },
      },
      "/tasks/{taskId}/result": {
        get: {
          tags: ["Task"],
          operationId: "getTaskResult",
          description: "返回任务当前真实业务结果；任务未完成时可返回 409。",
          parameters: [{ $ref: "#/components/parameters/TaskId" }],
          responses: { 200: success, 401: error, 403: error, 404: error, 409: error },
        },
      },
      "/tasks/{taskId}/restore": {
        post: {
          tags: ["Task"],
          operationId: "restoreTaskResult",
          description: "尝试从持久化任务记录恢复结果。",
          parameters: [{ $ref: "#/components/parameters/TaskId" }],
          responses: { 200: success, 401: error, 403: error, 404: error },
        },
      },
      "/outputs": {
        get: {
          tags: ["Output"],
          operationId: "listOutputs",
          parameters: [
            { $ref: "#/components/parameters/ClientIdQuery" },
            { $ref: "#/components/parameters/TeamId" },
            { name: "module", in: "query", required: true, schema: { type: "string", enum: ["penetration", "research", "diagnosis", "difficulty", "keyword", "article", "feedback"] } },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
            { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          ],
          responses: { 200: success, 400: error, 401: error, 403: error },
        },
      },
      "/outputs/{outputId}": {
        get: {
          tags: ["Output"],
          operationId: "getOutput",
          parameters: [
            { name: "outputId", in: "path", required: true, schema: { type: "string" } },
            { $ref: "#/components/parameters/TeamId" },
          ],
          responses: { 200: success, 401: error, 403: error, 404: error },
        },
      },
      "/reports": {
        get: {
          tags: ["Report"],
          operationId: "listReports",
          parameters: [
            { $ref: "#/components/parameters/ClientIdQuery" },
            { $ref: "#/components/parameters/TeamId" },
            { name: "kind", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "days", in: "query", schema: { type: "integer", minimum: 0, maximum: 365 } },
          ],
          responses: { 200: success, 400: error, 401: error, 403: error },
        },
      },
      "/reports/{jobId}/download": {
        get: {
          tags: ["Report"],
          operationId: "downloadReport",
          parameters: [{ name: "jobId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            200: { description: "PDF 文件", content: { "application/pdf": { schema: { type: "string", contentEncoding: "binary" } } } },
            401: error,
            403: error,
            404: error,
          },
        },
      },
      "/articles/batches": {
        get: {
          tags: ["Article"],
          operationId: "listArticleBatches",
          parameters: [
            { $ref: "#/components/parameters/ClientIdQuery" },
            { $ref: "#/components/parameters/TeamId" },
          ],
          responses: { 200: success, 400: error, 401: error, 403: error },
        },
      },
      "/articles/settings": {
        get: {
          tags: ["Article"],
          operationId: "getArticleSettings",
          description: "读取当前可用的文章 Prompt、模型服务商、中转站和默认模型。",
          responses: { 200: success, 401: error, 403: error },
        },
      },
      "/articles/batches/{batchId}": {
        get: {
          tags: ["Article"],
          operationId: "getArticleBatch",
          parameters: [{ $ref: "#/components/parameters/BatchId" }],
          responses: { 200: success, 401: error, 403: error, 404: error },
        },
      },
      "/articles/batches/{batchId}/download": {
        get: {
          tags: ["Article"],
          operationId: "downloadArticleBatch",
          parameters: [
            { $ref: "#/components/parameters/BatchId" },
            { name: "scope", in: "query", schema: { type: "string", enum: ["passed", "all", "direct"], default: "passed" } },
            { name: "variant", in: "query", schema: { type: "string", enum: ["original", "media"], default: "original" } },
          ],
          responses: {
            200: { description: "文章 ZIP 文件", content: { "application/zip": { schema: { type: "string", contentEncoding: "binary" } } } },
            401: error,
            403: error,
            404: error,
          },
        },
      },
      "/content-production/{runId}/download": {
        get: {
          tags: ["Article"],
          operationId: "downloadContentProductionRun",
          description: "将发布计划内容按平台目录打包，并附带发布清单。",
          parameters: [
            { name: "runId", in: "path", required: true, schema: { type: "string" } },
            { name: "scope", in: "query", schema: { type: "string", enum: ["passed", "all"], default: "passed" } },
          ],
          responses: {
            200: { description: "分平台内容 ZIP 文件", content: { "application/zip": { schema: { type: "string", contentEncoding: "binary" } } } },
            401: error,
            403: error,
            404: error,
          },
        },
      },
      "/feedback/{clientId}": {
        get: {
          tags: ["Feedback"],
          operationId: "getClientFeedback",
          parameters: [
            { $ref: "#/components/parameters/ClientId" },
            { $ref: "#/components/parameters/TeamId" },
          ],
          responses: { 200: success, 401: error, 403: error, 404: error },
        },
      },
      "/knowledge/imports": {
        get: {
          tags: ["Knowledge"],
          operationId: "listKnowledgeImports",
          parameters: [
            { $ref: "#/components/parameters/ClientIdQuery" },
            { $ref: "#/components/parameters/TeamId" },
          ],
          responses: { 200: success, 400: error, 401: error, 403: error },
        },
      },
      "/knowledge/imports/{importId}": {
        get: {
          tags: ["Knowledge"],
          operationId: "getKnowledgeImport",
          parameters: [
            { name: "importId", in: "path", required: true, schema: { type: "string" } },
            { $ref: "#/components/parameters/ClientIdQuery" },
            { $ref: "#/components/parameters/TeamId" },
          ],
          responses: { 200: success, 400: error, 401: error, 403: error, 404: error },
        },
      },
      ...actionPaths,
      "/actions/{action}": {
        post: {
          tags: ["Action"],
          operationId: "runAction",
          deprecated: true,
          description: "兼容旧版动态动作入口。新 Agent 应使用 OpenAPI 中对应的动作专用路径和参数 Schema。",
          parameters: [{
            name: "action",
            in: "path",
            required: true,
            schema: { type: "string", enum: AGENT_ACTIONS.map(action => action.name) },
          }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { oneOf: AGENT_ACTIONS.map(action => action.inputSchema) },
              },
            },
          },
          responses: { 200: success, 201: success, 202: success, 400: error, 401: error, 403: error, 409: error, 429: error },
        },
      },
    },
    components: {
      securitySchemes: {
        AgentBearer: { type: "http", scheme: "bearer", bearerFormat: "stgeo_agt_*" },
      },
      parameters: {
        ClientId: { name: "clientId", in: "path", required: true, schema: { type: "string" } },
        ClientIdQuery: { name: "clientId", in: "query", required: true, schema: { type: "string" } },
        TeamId: { name: "teamId", in: "query", required: false, schema: { type: "string" } },
        TaskId: { name: "taskId", in: "path", required: true, schema: { type: "string" } },
        BatchId: { name: "batchId", in: "path", required: true, schema: { type: "string" } },
      },
      schemas: {
        AgentScope: {
          type: "string",
          description: "Agent 密钥的最小权限单位。knowledge.view 单独控制客户知识库原文。",
          enum: ALL_AGENT_SCOPES,
        },
        TaskStatus: { type: "string", enum: ["queued", "running", "retrying", "succeeded", "partial", "failed", "cancelled", "blocked"] },
        ErrorResponse: {
          type: "object",
          required: ["ok", "error", "meta"],
          properties: {
            ok: { const: false },
            error: {
              type: "object",
              required: ["code", "message", "retryable"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                retryable: { type: "boolean" },
                details: { type: "object", additionalProperties: true },
              },
            },
            meta: { type: "object", properties: { traceId: { type: "string" }, requestId: { type: "string" } } },
          },
        },
      },
    },
  }
}
