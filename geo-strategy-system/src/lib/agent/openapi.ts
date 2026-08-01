import "server-only"

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

  return {
    openapi: "3.1.0",
    info: {
      title: "势途 GEO Agent API",
      version: "1.0.0",
      description: "供 CLI、MCP 和自动化 Agent 安全调用势途 GEO 现有业务能力。所有写操作均进入后台任务并沿用网页端权限、积分、联网与质量规则。",
    },
    servers: [{ url: `${origin}/api/agent/v1` }],
    security,
    tags: [
      { name: "Capability" },
      { name: "Client" },
      { name: "Task" },
      { name: "Output" },
      { name: "Report" },
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
      "/outputs": {
        get: {
          tags: ["Output"],
          operationId: "listOutputs",
          parameters: [
            { $ref: "#/components/parameters/ClientIdQuery" },
            { $ref: "#/components/parameters/TeamId" },
            { name: "module", in: "query", required: true, schema: { type: "string", enum: ["penetration", "research", "diagnosis", "difficulty"] } },
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
      "/actions/{action}": {
        post: {
          tags: ["Action"],
          operationId: "runAction",
          description: "动作可选 penetration.run、difficulty.run、background.run、article.batch.run、report.create。正文与对应网页业务接口一致，另可传 dryRun=true 仅校验权限与预计积分。",
          parameters: [{
            name: "action",
            in: "path",
            required: true,
            schema: { type: "string", enum: ["penetration.run", "difficulty.run", "background.run", "article.batch.run", "report.create"] },
          }],
          requestBody: { required: true, content: json },
          responses: { 200: success, 202: success, 400: error, 401: error, 403: error, 409: error, 429: error },
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
      },
      schemas: {
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
