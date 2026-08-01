#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createShituGeoMcpServer } from "@/agent/mcp-server"

async function main() {
  const token = String(process.env.SHITU_GEO_TOKEN || "").trim()
  const baseUrl = String(process.env.SHITU_GEO_BASE_URL || "https://shitugeo.top").trim()
  if (!token) throw new Error("SHITU_GEO_TOKEN 未配置")
  const server = createShituGeoMcpServer({ baseUrl, token })
  await server.connect(new StdioServerTransport())
  console.error("势途 GEO MCP 已通过 stdio 启动")
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
