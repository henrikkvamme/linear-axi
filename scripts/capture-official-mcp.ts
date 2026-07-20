import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Effect, Predicate } from "effect"
import { loadEnv } from "../src/env"
import { credentialsFromEnv } from "../src/linear"
import { makeOfficialMcpClient, OFFICIAL_MCP_PROTOCOL_VERSION, OFFICIAL_MCP_URL } from "../src/official-mcp"

const readDate = (argv: ReadonlyArray<string>): string => {
  const index = argv.indexOf("--date")
  const value = index === -1 ? undefined : argv[index + 1]
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Usage: bun scripts/capture-official-mcp.ts --date YYYY-MM-DD")
  }
  return value
}

const main = async (): Promise<void> => {
  const observedAt = readDate(process.argv.slice(2))
  const env = loadEnv(process.cwd())
  const credentials = credentialsFromEnv(env)
  if (!credentials) {
    throw new Error("No local Linear credential is available for read-only MCP schema discovery")
  }

  const result = await Effect.runPromise(makeOfficialMcpClient(credentials).request("tools/list", {}))
  if (!Predicate.isObject(result) || !Array.isArray(result.tools) || result.tools.some((tool) => !Predicate.isObject(tool))) {
    throw new Error("Official Linear MCP tools/list returned no tools")
  }
  const tools = result.tools as ReadonlyArray<Record<string, unknown>>
  const output = {
    generated: true,
    observedAt,
    source: OFFICIAL_MCP_URL,
    protocolVersion: OFFICIAL_MCP_PROTOCOL_VERSION,
    toolCount: tools.length,
    tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({
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
