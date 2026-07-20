import { Effect, Predicate, Schema } from "effect"
import { LinearApiError } from "./errors"
import type { Credentials, GatewayError } from "./linear"

export const OFFICIAL_MCP_URL = "https://mcp.linear.app/mcp"
export const OFFICIAL_MCP_PROTOCOL_VERSION = "2025-03-26"

interface OfficialMcpOptions {
  readonly fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}

interface OfficialMcpClient {
  readonly request: (
    method: string,
    params: Readonly<Record<string, unknown>>
  ) => Effect.Effect<unknown, GatewayError>
}

const RpcResponseSchema = Schema.Struct({
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Struct({ message: Schema.optionalKey(Schema.String) }))
})
const ToolResultSchema = Schema.Struct({
  content: Schema.optionalKey(Schema.Array(Schema.Struct({
    type: Schema.optionalKey(Schema.String),
    text: Schema.optionalKey(Schema.String)
  }))),
  isError: Schema.optionalKey(Schema.Boolean)
})
const decodeRpcResponse = Schema.decodeUnknownSync(RpcResponseSchema)
const decodeToolResult = Schema.decodeUnknownSync(ToolResultSchema)
const decodeJsonValue = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)

export const makeOfficialMcpClient = (
  credentials: Credentials,
  options: OfficialMcpOptions = {}
): OfficialMcpClient => {
  const fetcher = options.fetcher ?? fetch
  let requestId = 0
  let initialized = false
  let sessionId: string | undefined
  let protocolVersion: string | undefined
  const fail = (operation: string, message: string) => apiError(operation, message.replaceAll(credentials.value, "[REDACTED]"))

  const post = Effect.fn("OfficialMcp.post")(function*(
    operation: string,
    message: Readonly<Record<string, unknown>>
  ) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${credentials.value}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json"
    }
    if (sessionId !== undefined) headers["mcp-session-id"] = sessionId
    if (protocolVersion !== undefined) headers["mcp-protocol-version"] = protocolVersion
    const response = yield* Effect.tryPromise({
      try: () => fetcher(OFFICIAL_MCP_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(message)
      }),
      catch: (cause) => fail(operation, readableCause(cause))
    })
    const body = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) => fail(operation, readableCause(cause))
    })
    return { response, body }
  })

  const responseMessage = (
    operation: string,
    response: Response,
    body: string
  ): Effect.Effect<Schema.Schema.Type<typeof RpcResponseSchema>, LinearApiError> => {
    if (!response.ok) return Effect.fail(fail(operation, `HTTP ${response.status}`))
    return Effect.try({
      try: () => decodeRpcResponse(decodeStreamableHttpMessage(body, response.headers.get("content-type"))),
      catch: (cause) => fail(operation, readableCause(cause))
    }).pipe(Effect.flatMap((message) => message.error
      ? Effect.fail(fail(operation, message.error.message ?? "request failed"))
      : Effect.succeed(message)))
  }

  const initialize = Effect.fn("OfficialMcp.initialize")(function*() {
    sessionId = undefined
    protocolVersion = undefined
    const id = ++requestId
    const initializedResponse = yield* post("initialize", {
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        protocolVersion: OFFICIAL_MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "linear-axi", version: "0.1.0" }
      }
    })
    const message = yield* responseMessage("initialize", initializedResponse.response, initializedResponse.body)
    if (!Predicate.isObject(message.result) || message.result.protocolVersion !== OFFICIAL_MCP_PROTOCOL_VERSION) {
      return yield* Effect.fail(fail("initialize", "server negotiated an unsupported protocol version"))
    }
    protocolVersion = OFFICIAL_MCP_PROTOCOL_VERSION
    sessionId = initializedResponse.response.headers.get("mcp-session-id") ?? undefined
    const notification = yield* post("notifications/initialized", {
      jsonrpc: "2.0",
      method: "notifications/initialized"
    })
    if (!notification.response.ok) {
      return yield* Effect.fail(fail("notifications/initialized", `HTTP ${notification.response.status}`))
    }
    initialized = true
  })

  const ensureInitialized = Effect.fn("OfficialMcp.ensureInitialized")(function*() {
    if (!initialized) yield* initialize()
  })

  const request = Effect.fn("OfficialMcp.request")(function*(
    method: string,
    params: Readonly<Record<string, unknown>>
  ): Effect.fn.Return<unknown, GatewayError> {
    yield* ensureInitialized()
    let id = ++requestId
    let result = yield* post(method, { jsonrpc: "2.0", id, method, params })
    if (result.response.status === 404 && sessionId !== undefined) {
      initialized = false
      yield* ensureInitialized()
      id = ++requestId
      result = yield* post(method, { jsonrpc: "2.0", id, method, params })
    }
    const message = yield* responseMessage(method, result.response, result.body)
    return message.result
  })

  return { request }
}

export const makeOfficialMcpToolCaller = (
  credentials: Credentials,
  options: OfficialMcpOptions = {}
) => {
  const client = makeOfficialMcpClient(credentials, options)
  const fail = (tool: string, message: string) => apiError(tool, message.replaceAll(credentials.value, "[REDACTED]"))

  return Effect.fn("OfficialMcp.callTool")(function*(
    name: string,
    args: Readonly<Record<string, unknown>>
  ): Effect.fn.Return<unknown, GatewayError> {
    const result = yield* client.request("tools/call", { name, arguments: args })
    const toolResult = yield* Effect.try({
      try: () => decodeToolResult(result),
      catch: (cause) => fail(name, readableCause(cause))
    })
    const text = toolResult.content
      ?.filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text!)
      .join("\n") ?? ""
    if (toolResult.isError) {
      return yield* Effect.fail(fail(name, text || "tool call failed"))
    }
    if (text.length === 0) return {}
    try {
      return decodeJsonValue(text)
    } catch {
      return { text }
    }
  })
}

export const decodeStreamableHttpMessage = (body: string, contentType: string | null): unknown => {
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase()
  if (mediaType === "application/json") return decodeJsonValue(body)
  if (mediaType === "text/event-stream") return decodeSseMessage(body)
  try {
    return decodeJsonValue(body)
  } catch {
    return decodeSseMessage(body)
  }
}

const decodeSseMessage = (body: string): unknown => {
  const payloads: Array<string> = []
  let data: Array<string> = []
  for (const line of [...body.split(/\r?\n/), ""]) {
    if (line.length === 0) {
      if (data.length > 0) payloads.push(data.join("\n"))
      data = []
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).replace(/^ /, ""))
    }
  }
  for (const payload of payloads) {
    try {
      const message = decodeJsonValue(payload)
      if (Predicate.isObject(message) && ("result" in message || "error" in message)) return message
    } catch {
      continue
    }
  }
  throw new Error("response contained no MCP data message")
}

const apiError = (operation: string, message: string) => new LinearApiError({
  message: `Official Linear MCP ${operation} failed: ${message}`,
  help: "Check Linear access and retry the same command."
})

const readableCause = (cause: unknown): string => cause instanceof Error ? cause.message : "unknown error"
