import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { loadEnv } from "../src/env"

const MCP_URL = "https://mcp.linear.app/mcp"
const PROTOCOL_VERSION = "2025-03-26"

const readDate = (argv: ReadonlyArray<string>): string => {
  const index = argv.indexOf("--date")
  const value = index === -1 ? undefined : argv[index + 1]
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Usage: bun scripts/capture-official-mcp.ts --date YYYY-MM-DD")
  }
  return value
}

const decodeSseMessage = (body: string): unknown => {
  const data = body.split("\n").find((line) => line.startsWith("data: "))?.slice(6)
  if (!data) {
    throw new Error("Official Linear MCP response did not contain an SSE data message")
  }
  return JSON.parse(data)
}

const main = async (): Promise<void> => {
  const observedAt = readDate(process.argv.slice(2))
  const env = loadEnv(process.cwd())
  const credential = env.LINEAR_ACCESS_TOKEN ?? env.LINEAR_API_KEY
  if (!credential) {
    throw new Error("No local Linear credential is available for read-only MCP schema discovery")
  }

  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credential}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
  })
  if (!response.ok) {
    throw new Error(`Official Linear MCP tools/list failed with HTTP ${response.status}`)
  }

  const message = decodeSseMessage(await response.text()) as {
    readonly result?: { readonly tools?: ReadonlyArray<Record<string, unknown>> }
    readonly error?: { readonly message?: string }
  }
  if (!message.result?.tools) {
    throw new Error(message.error?.message ?? "Official Linear MCP tools/list returned no tools")
  }

  const output = {
    generated: true,
    observedAt,
    source: MCP_URL,
    protocolVersion: PROTOCOL_VERSION,
    toolCount: message.result.tools.length,
    tools: message.result.tools.map(({ name, title, description, inputSchema, annotations }) => ({
      name,
      title,
      description,
      inputSchema,
      annotations
    }))
  }
  const path = join(process.cwd(), "docs", "official-linear-mcp-tools.json")
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, `${JSON.stringify(output, null, 2)}\n`)
  process.stderr.write(`Captured ${output.toolCount} official Linear MCP tools in ${path}\n`)
}

await main()
