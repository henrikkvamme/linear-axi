import { Effect, Predicate, Schema } from "effect"
import { LinearApiError } from "./errors"
import type { Credentials, GatewayError } from "./linear"
import { officialMutationInspectionCommand } from "./official-inspection"

export const OFFICIAL_MCP_URL = "https://mcp.linear.app/mcp"
export const OFFICIAL_MCP_PROTOCOL_VERSION = "2025-03-26"

interface OfficialMcpOptions {
  readonly fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  readonly requestTimeoutMs?: number
}

interface PendingResponse {
  readonly response: Response
  readonly controller: AbortController
  readonly complete: () => void
}

interface OfficialMcpClient {
  readonly request: (
    method: string,
    params: Readonly<Record<string, unknown>>
  ) => Effect.Effect<unknown, GatewayError>
}

type JsonRpcId = string | number
type OfficialMcpRequestPhase = "before-dispatch" | "awaiting-response" | "response-received"

class OfficialMcpRequestError extends LinearApiError {
  readonly operation: string
  readonly phase: OfficialMcpRequestPhase
  readonly outcomeUnknown: boolean

  constructor(input: {
    readonly operation: string
    readonly phase: OfficialMcpRequestPhase
    readonly outcomeUnknown: boolean
    readonly message: string
  }) {
    super({
      message: `Official Linear MCP ${input.operation} failed: ${input.message}`,
      help: "Check Linear access and retry the same command."
    })
    this.operation = input.operation
    this.phase = input.phase
    this.outcomeUnknown = input.outcomeUnknown
  }
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
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000
  let requestId = 0
  let initialized = false
  let sessionId: string | undefined
  let protocolVersion: string | undefined
  const fail = (
    operation: string,
    message: string,
    phase: OfficialMcpRequestPhase,
    outcomeUnknown: boolean
  ) => new OfficialMcpRequestError({
    operation,
    phase,
    outcomeUnknown,
    message: message.replaceAll(credentials.value, "[REDACTED]")
  })

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
    const timeout = setTimeout(() => {
      controller.abort(new Error(`request timed out after ${requestTimeoutMs}ms`))
    }, requestTimeoutMs)
    const complete = () => {
      clearTimeout(timeout)
      if (!controller.signal.aborted) controller.abort()
    }
    let dispatched = false
    const response = yield* Effect.tryPromise({
      try: () => {
        const pending = fetcher(OFFICIAL_MCP_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(message),
          signal: controller.signal
        })
        dispatched = true
        return abortable(pending, controller.signal)
      },
      catch: (cause) => {
        complete()
        return fail(
          operation,
          readableCause(cause),
          dispatched ? "awaiting-response" : "before-dispatch",
          dispatched
        )
      }
    })
    return { response, controller, complete }
  })

  const responseMessage = Effect.fn("OfficialMcp.responseMessage")(function*(
    operation: string,
    pending: PendingResponse,
    id: JsonRpcId
  ): Effect.fn.Return<Schema.Schema.Type<typeof RpcResponseSchema>, LinearApiError> {
    const message = yield* Effect.tryPromise({
      try: async () => {
        try {
          if (!pending.response.ok) {
            void pending.response.body?.cancel().catch(() => undefined)
            throw new Error(`HTTP ${pending.response.status}`)
          }
          const value = await readStreamableHttpMessage(pending.response, id, pending.controller.signal)
          return decodeRpcResponse(value)
        } finally {
          pending.complete()
        }
      },
      catch: (cause) => fail(operation, readableCause(cause), "response-received", true)
    })
    if (message.error) {
      return yield* Effect.fail(fail(
        operation,
        message.error.message ?? "request failed",
        "response-received",
        false
      ))
    }
    return message
  })

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
    const message = yield* responseMessage("initialize", initializedResponse, id)
    if (!Predicate.isObject(message.result) || message.result.protocolVersion !== OFFICIAL_MCP_PROTOCOL_VERSION) {
      return yield* Effect.fail(fail("initialize", "server negotiated an unsupported protocol version", "response-received", false))
    }
    protocolVersion = OFFICIAL_MCP_PROTOCOL_VERSION
    sessionId = initializedResponse.response.headers.get("mcp-session-id") ?? undefined
    const notification = yield* post("notifications/initialized", {
      jsonrpc: "2.0",
      method: "notifications/initialized"
    })
    void notification.response.body?.cancel().catch(() => undefined)
    notification.complete()
    if (!notification.response.ok) {
      return yield* Effect.fail(fail("notifications/initialized", `HTTP ${notification.response.status}`, "response-received", false))
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
    if (result.response.status === 404 && sessionId !== undefined && !isSaveToolCall(method, params)) {
      void result.response.body?.cancel().catch(() => undefined)
      result.complete()
      initialized = false
      yield* ensureInitialized()
      id = ++requestId
      result = yield* post(method, { jsonrpc: "2.0", id, method, params })
    }
    const message = yield* responseMessage(method, result, id)
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
    const result = yield* client.request("tools/call", { name, arguments: args }).pipe(
      Effect.mapError((error) => ambiguousMutationFailure(name, args, error))
    )
    const toolResult = yield* Effect.try({
      try: () => decodeToolResult(result),
      catch: (cause) => ambiguousMutationFailure(name, args, new OfficialMcpRequestError({
        operation: "tools/call",
        phase: "response-received",
        outcomeUnknown: true,
        message: readableCause(cause)
      }))
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
    } catch (cause) {
      if (name.startsWith("save_")) {
        return yield* Effect.fail(ambiguousMutationFailure(name, args, new OfficialMcpRequestError({
          operation: "tools/call",
          phase: "response-received",
          outcomeUnknown: true,
          message: readableCause(cause)
        })))
      }
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
  signal: AbortSignal
): Promise<unknown> => {
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (mediaType !== "text/event-stream") {
    return decodeStreamableHttpMessage(
      await abortable(response.text(), signal),
      response.headers.get("content-type"),
      requestId
    )
  }
  if (!response.body) throw new Error("response contained no MCP data message")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const chunk = await abortable(reader.read(), signal)
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      const parsed = takeSseEvents(buffer, requestId)
      buffer = parsed.remaining
      if (parsed.message !== undefined) {
        cancelReader(reader)
        return parsed.message
      }
      if (chunk.done) {
        reader.releaseLock()
        return decodeSseMessage(buffer, requestId)
      }
    }
  } catch (cause) {
    cancelReader(reader)
    throw cause
  }
}

const cancelReader = (reader: ReadableStreamDefaultReader<Uint8Array>): void => {
  void reader.cancel().catch(() => undefined).finally(() => reader.releaseLock()).catch(() => undefined)
}

const abortable = <Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> => {
  if (signal.aborted) return Promise.reject(abortCause(signal))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (continuation: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      continuation()
    }
    const onAbort = () => finish(() => reject(abortCause(signal)))
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => finish(() => resolve(value)),
      (cause) => finish(() => reject(cause))
    )
  })
}

const abortCause = (signal: AbortSignal): Error =>
  signal.reason instanceof Error ? signal.reason : new Error("request aborted")

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

const ambiguousMutationFailure = (
  tool: string,
  args: Readonly<Record<string, unknown>>,
  error: GatewayError
): GatewayError => {
  if (!tool.startsWith("save_") || !(error instanceof OfficialMcpRequestError) ||
    error.operation !== "tools/call" || !error.outcomeUnknown || error.phase === "before-dispatch") {
    return error
  }
  const inspection = officialMutationInspectionCommand(tool, args)
  const createWarning = tool === "save_issue" && !(typeof args.id === "string" && args.id.length > 0)
    ? " A missing result does not prove creation failed; do not repeat the mutation automatically."
    : " Do not repeat the mutation until the outcome is known."
  return new LinearApiError({
    message: `Official Linear MCP ${tool} failed after dispatch during ${error.phase}; mutation outcome is unknown`,
    help: `Run \`${inspection}\` to inspect the outcome.${createWarning}`
  })
}

const isSaveToolCall = (method: string, params: Readonly<Record<string, unknown>>): boolean =>
  method === "tools/call" && typeof params.name === "string" && params.name.startsWith("save_")

const apiError = (operation: string, message: string) => new LinearApiError({
  message: `Official Linear MCP ${operation} failed: ${message}`,
  help: "Check Linear access and retry the same command."
})

const readableCause = (cause: unknown): string => cause instanceof Error ? cause.message : "unknown error"
