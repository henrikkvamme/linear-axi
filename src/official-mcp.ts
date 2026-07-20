import { Effect, Schema } from "effect"
import { LinearApiError } from "./errors"
import type { Credentials, GatewayError } from "./linear"

const MCP_URL = "https://mcp.linear.app/mcp"

interface OfficialMcpOptions {
  readonly fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}

const McpResponseSchema = Schema.Struct({
  result: Schema.optionalKey(Schema.Struct({
    content: Schema.optionalKey(Schema.Array(Schema.Struct({
      type: Schema.optionalKey(Schema.String),
      text: Schema.optionalKey(Schema.String)
    }))),
    isError: Schema.optionalKey(Schema.Boolean)
  })),
  error: Schema.optionalKey(Schema.Struct({ message: Schema.optionalKey(Schema.String) }))
})
type McpResponse = typeof McpResponseSchema.Type
const decodeMcpResponse = Schema.decodeUnknownSync(Schema.fromJsonString(McpResponseSchema))
const decodeJsonValue = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)

export const makeOfficialMcpToolCaller = (
  credentials: Credentials,
  options: OfficialMcpOptions = {}
) => {
  const fetcher = options.fetcher ?? fetch
  let requestId = 0
  const fail = (tool: string, message: string) => apiError(tool, message.replaceAll(credentials.value, "[REDACTED]"))

  return Effect.fn("OfficialMcp.callTool")(function*(
    name: string,
    args: Readonly<Record<string, unknown>>
  ): Effect.fn.Return<unknown, GatewayError> {
    const id = ++requestId
    const response = yield* Effect.tryPromise({
      try: () => fetcher(MCP_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credentials.value}`,
          accept: "application/json, text/event-stream",
          "content-type": "application/json"
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })
      }),
      catch: (cause) => fail(name, readableCause(cause))
    })
    const body = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => fail(name, readableCause(cause))
    })
    if (!response.ok) {
      return yield* Effect.fail(fail(name, `HTTP ${response.status}`))
    }
    const message = yield* Effect.try({
      try: () => decodeMessage(body),
      catch: (cause) => fail(name, readableCause(cause))
    })
    const text = message.result?.content
      ?.filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text!)
      .join("\n") ?? ""
    if (message.error || message.result?.isError) {
      return yield* Effect.fail(fail(name, message.error?.message ?? (text || "tool call failed")))
    }
    if (text.length === 0) {
      return {}
    }
    try {
      return decodeJsonValue(text)
    } catch {
      return { text }
    }
  })
}

const decodeMessage = (body: string): McpResponse => {
  const data = body.split("\n").find((line) => line.startsWith("data: "))?.slice(6)
  if (!data) {
    throw new Error("response contained no MCP data message")
  }
  return decodeMcpResponse(data)
}

const apiError = (tool: string, message: string) => new LinearApiError({
  message: `Official Linear MCP ${tool} failed: ${message}`,
  help: "Check Linear access and retry the same command."
})

const readableCause = (cause: unknown): string => cause instanceof Error ? cause.message : "unknown error"
