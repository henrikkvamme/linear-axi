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

type JsonRpcId = string | number

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
    const controller = new AbortController()
    const response = yield* Effect.tryPromise({
      try: () => fetcher(OFFICIAL_MCP_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: controller.signal
      }),
      catch: (cause) => {
        controller.abort()
        return fail(operation, readableCause(cause))
      }
    })
    return { response, controller }
  })

  const responseMessage = (
    operation: string,
    response: Response,
    id: JsonRpcId,
    controller: AbortController
  ): Effect.Effect<Schema.Schema.Type<typeof RpcResponseSchema>, LinearApiError> => {
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      controller.abort()
      return Effect.fail(fail(operation, `HTTP ${response.status}`))
    }
    return Effect.tryPromise({
      try: () => readStreamableHttpMessage(response, id, controller),
      catch: (cause) => fail(operation, readableCause(cause))
    }).pipe(
      Effect.flatMap((value) => Effect.try({
        try: () => decodeRpcResponse(value),
        catch: (cause) => fail(operation, readableCause(cause))
      })),
      Effect.flatMap((message) => message.error
        ? Effect.fail(fail(operation, message.error.message ?? "request failed"))
        : Effect.succeed(message))
    )
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
    const message = yield* responseMessage("initialize", initializedResponse.response, id, initializedResponse.controller)
    if (!Predicate.isObject(message.result) || message.result.protocolVersion !== OFFICIAL_MCP_PROTOCOL_VERSION) {
      return yield* Effect.fail(fail("initialize", "server negotiated an unsupported protocol version"))
    }
    protocolVersion = OFFICIAL_MCP_PROTOCOL_VERSION
    sessionId = initializedResponse.response.headers.get("mcp-session-id") ?? undefined
    const notification = yield* post("notifications/initialized", {
      jsonrpc: "2.0",
      method: "notifications/initialized"
    })
    void notification.response.body?.cancel().catch(() => undefined)
    notification.controller.abort()
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
      void result.response.body?.cancel().catch(() => undefined)
      result.controller.abort()
      initialized = false
      yield* ensureInitialized()
      id = ++requestId
      result = yield* post(method, { jsonrpc: "2.0", id, method, params })
    }
    const message = yield* responseMessage(method, result.response, id, result.controller)
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

export const decodeStreamableHttpMessage = (
  body: string,
  contentType: string | null,
  requestId?: JsonRpcId
): unknown => {
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase()
  if (mediaType === "application/json") return selectRpcResponse(decodeJsonValue(body), requestId)
  if (mediaType === "text/event-stream") return decodeSseMessage(body, requestId)
  try {
    return selectRpcResponse(decodeJsonValue(body), requestId)
  } catch {
    return decodeSseMessage(body, requestId)
  }
}

const readStreamableHttpMessage = async (
  response: Response,
  requestId: JsonRpcId,
  controller: AbortController
): Promise<unknown> => {
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (mediaType !== "text/event-stream") {
    try {
      return decodeStreamableHttpMessage(await response.text(), response.headers.get("content-type"), requestId)
    } finally {
      controller.abort()
    }
  }
  if (!response.body) {
    controller.abort()
    throw new Error("response contained no MCP data message")
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const chunk = await reader.read()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      const parsed = takeSseEvents(buffer, requestId)
      buffer = parsed.remaining
      if (parsed.message !== undefined) {
        controller.abort()
        void reader.cancel()
        return parsed.message
      }
      if (chunk.done) {
        const final = decodeSseMessage(buffer, requestId)
        controller.abort()
        return final
      }
    }
  } catch (cause) {
    controller.abort()
    throw cause
  }
}

const takeSseEvents = (
  body: string,
  requestId: JsonRpcId
): { readonly message?: unknown; readonly remaining: string } => {
  let remaining = body
  while (true) {
    const boundary = /\r?\n\r?\n/.exec(remaining)
    if (!boundary || boundary.index === undefined) return { remaining }
    const event = remaining.slice(0, boundary.index)
    remaining = remaining.slice(boundary.index + boundary[0].length)
    const message = decodeSseEvent(event, requestId)
    if (message !== undefined) return { message, remaining }
  }
}

const decodeSseMessage = (body: string, requestId?: JsonRpcId): unknown => {
  for (const event of body.split(/\r?\n\r?\n/)) {
    const message = decodeSseEvent(event, requestId)
    if (message !== undefined) return message
  }
  throw new Error("response contained no matching MCP data message")
}

const decodeSseEvent = (event: string, requestId?: JsonRpcId): unknown | undefined => {
  const data = event.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
  if (data.length === 0) return undefined
  try {
    return selectRpcResponse(decodeJsonValue(data.join("\n")), requestId, false)
  } catch {
    return undefined
  }
}

const selectRpcResponse = (value: unknown, requestId?: JsonRpcId, required = true): unknown => {
  const candidates = Array.isArray(value) ? value : [value]
  const message = candidates.find((candidate) => Predicate.isObject(candidate) &&
    ("result" in candidate || "error" in candidate) &&
    (requestId === undefined || candidate.id === requestId))
  if (message !== undefined) return message
  if (required) throw new Error("response contained no matching MCP response")
  return undefined
}

const apiError = (operation: string, message: string) => new LinearApiError({
  message: `Official Linear MCP ${operation} failed: ${message}`,
  help: "Check Linear access and retry the same command."
})

const readableCause = (cause: unknown): string => cause instanceof Error ? cause.message : "unknown error"
