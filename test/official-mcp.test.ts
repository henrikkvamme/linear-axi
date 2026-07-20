import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { decodeStreamableHttpMessage, makeOfficialMcpToolCaller } from "../src/official-mcp"

const initializedFetcher = (
  respond: (request: Record<string, unknown>, headers: Headers) => Response,
  requests: Array<{ readonly request: Record<string, unknown>; readonly headers: Headers }> = []
) => ({
  requests,
  fetcher: async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>
    const headers = new Headers(init?.headers)
    requests.push({ request, headers })
    if (request.method === "initialize") {
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "Linear", version: "1" } } }, {
        headers: { "mcp-session-id": "session-1" }
      })
    }
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 })
    return respond(request, headers)
  }
})

describe("official Linear MCP tool boundary", () => {
  test("initializes a shared session before calling tools", async () => {
    const transport = initializedFetcher((request) => new Response([
      "event: message",
      '{"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
      "",
      "event: message",
      `data: ${JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ teams: [{ id: "team-1", name: "Engineering" }], hasNextPage: false }) }] }, jsonrpc: "2.0", id: request.id })}`,
      ""
    ].join("\n"), { status: 200, headers: { "content-type": "text/event-stream" } }))
    const call = makeOfficialMcpToolCaller({ kind: "apiKey", value: "secret-value" }, { fetcher: transport.fetcher })

    const result = await Effect.runPromise(call("list_teams", { limit: 1 }))

    expect(result).toEqual({ teams: [{ id: "team-1", name: "Engineering" }], hasNextPage: false })
    expect(transport.requests.map(({ request }) => request)).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "linear-axi", version: "0.1.0" }
        }
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "list_teams", arguments: { limit: 1 } }
      }
    ])
    expect(transport.requests[0]!.headers.get("authorization")).toBe("Bearer secret-value")
    expect(transport.requests[0]!.headers.get("mcp-session-id")).toBeNull()
    expect(transport.requests.slice(1).every(({ headers }) => headers.get("mcp-session-id") === "session-1")).toBe(true)
    expect(transport.requests.slice(1).every(({ headers }) => headers.get("mcp-protocol-version") === "2025-03-26")).toBe(true)
  })

  test("decodes application/json Streamable HTTP responses", async () => {
    const transport = initializedFetcher((request) => Response.json({
      result: { content: [{ type: "text", text: JSON.stringify({ id: "project-1", name: "Roadmap" }) }] },
      jsonrpc: "2.0",
      id: request.id
    }))
    const call = makeOfficialMcpToolCaller({ kind: "apiKey", value: "secret-value" }, { fetcher: transport.fetcher })

    const result = await Effect.runPromise(call("get_project", { query: "Roadmap" }))

    expect(result).toEqual({ id: "project-1", name: "Roadmap" })
  })

  test("shared Streamable HTTP decoding handles JSON and skips SSE progress messages", () => {
    expect(decodeStreamableHttpMessage(
      '{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"list_teams"}]}}',
      "application/json; charset=utf-8"
    )).toEqual({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "list_teams" }] } })

    expect(decodeStreamableHttpMessage([
      "event: message",
      'data: {"jsonrpc":"2.0","method":"notifications/progress",',
      'data: "params":{"progress":1}}',
      "",
      "event: message",
      'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"list_teams"}]}}',
      ""
    ].join("\n"), "text/event-stream")).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [{ name: "list_teams" }] }
    })
  })

  test("shared decoding selects the matching response from JSON-RPC batches", () => {
    expect(decodeStreamableHttpMessage(JSON.stringify([
      { jsonrpc: "2.0", id: 1, result: { ignored: true } },
      { jsonrpc: "2.0", id: 2, result: { tools: [{ name: "list_teams" }] } }
    ]), "application/json", 2)).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: { tools: [{ name: "list_teams" }] }
    })
  })

  test("incremental SSE decoding matches the request id without waiting for EOF", async () => {
    let canceled = false
    const transport = initializedFetcher((request) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode([
          "event: message",
          `data: ${JSON.stringify([
            { jsonrpc: "2.0", id: 999, result: { content: [{ type: "text", text: "{}" }] } },
            { jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: JSON.stringify({ id: "project-1" }) }] } }
          ])}`,
          "",
          ""
        ].join("\n")))
      },
      cancel() {
        canceled = true
      }
    }), { status: 200, headers: { "content-type": "text/event-stream" } }))
    const call = makeOfficialMcpToolCaller({ kind: "apiKey", value: "secret-value" }, { fetcher: transport.fetcher })

    const result = await Effect.runPromise(call("get_project", { query: "Roadmap" }))

    expect(result).toEqual({ id: "project-1" })
    expect(canceled).toBe(true)
  }, 1_000)

  test("reinitializes and replays after the server terminates a session", async () => {
    let sessions = 0
    let calls = 0
    const requests: Array<{ readonly request: Record<string, unknown>; readonly headers: Headers }> = []
    const fetcher = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>
      const headers = new Headers(init?.headers)
      requests.push({ request, headers })
      if (request.method === "initialize") {
        sessions += 1
        return Response.json({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "Linear", version: "1" } } }, {
          headers: { "mcp-session-id": `session-${sessions}` }
        })
      }
      if (request.method === "notifications/initialized") return new Response(null, { status: 202 })
      calls += 1
      if (calls === 2) return new Response(null, { status: 404 })
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "{}" }] } })
    }
    const call = makeOfficialMcpToolCaller({ kind: "apiKey", value: "secret-value" }, { fetcher })

    await Effect.runPromise(call("get_project", { query: "One" }))
    await Effect.runPromise(call("get_project", { query: "Two" }))

    expect(sessions).toBe(2)
    expect(requests.at(-1)!.headers.get("mcp-session-id")).toBe("session-2")
    expect((requests.at(-1)!.request.params as { arguments: unknown }).arguments).toEqual({ query: "Two" })
  })

  test("times out when fetch remains silent", async () => {
    const call = makeOfficialMcpToolCaller({ kind: "apiKey", value: "secret-value" }, {
      fetcher: () => new Promise<Response>(() => undefined),
      requestTimeoutMs: 25
    })

    const error = await Effect.runPromise(Effect.flip(call("get_project", { query: "Roadmap" })))

    expect(error._tag).toBe("LinearApiError")
    expect(error.message).toContain("request timed out after 25ms")
    expect(error.help).toBe("Check Linear access and retry the same command.")
  }, 1_000)

  test("times out and cancels an SSE stream with no matching response", async () => {
    let canceled = false
    const transport = initializedFetcher(() => new Response(new ReadableStream({
      start() {},
      cancel() {
        canceled = true
        return new Promise<void>(() => undefined)
      }
    }), { status: 200, headers: { "content-type": "text/event-stream" } }))
    const call = makeOfficialMcpToolCaller({ kind: "apiKey", value: "secret-value" }, {
      fetcher: transport.fetcher,
      requestTimeoutMs: 25
    })

    const error = await Effect.runPromise(Effect.flip(call("get_project", { query: "Roadmap" })))

    expect(error._tag).toBe("LinearApiError")
    expect(error.message).toContain("request timed out after 25ms")
    expect(canceled).toBe(true)
  }, 1_000)

  test("save timeouts report ambiguous outcomes with read-only inspection", async () => {
    const cases = [
      {
        args: { id: "ENG-123", title: "Updated" },
        inspection: "linear-axi issues inspect --id 'ENG-123' --full"
      },
      {
        args: { team: "team-id", title: "Launch" },
        inspection: "linear-axi issues search --team 'team-id' --query 'Launch' --full"
      }
    ] as const

    for (const entry of cases) {
      const transport = initializedFetcher(() => new Response(new ReadableStream({ start() {} }), {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      }))
      const call = makeOfficialMcpToolCaller({ kind: "apiKey", value: "secret-value" }, {
        fetcher: transport.fetcher,
        requestTimeoutMs: 25
      })

      const error = await Effect.runPromise(Effect.flip(call("save_issue", entry.args)))

      expect(error._tag).toBe("LinearApiError")
      expect(error.message).toContain("mutation outcome is unknown")
      expect(error.help).toContain(entry.inspection)
      expect(error.help).not.toContain("retry")
    }
  }, 1_000)

  test("translates tool and malformed response errors without echoing credentials", async () => {
    const transport = initializedFetcher((request) => new Response(
      `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: "text", text: "permission denied for never-print-me" }], isError: true }, jsonrpc: "2.0", id: request.id })}\n`,
      { status: 200 }
    ))
    const call = makeOfficialMcpToolCaller({ kind: "accessToken", value: "never-print-me" }, { fetcher: transport.fetcher })

    const error = await Effect.runPromise(Effect.flip(call("get_project", { query: "Roadmap" })))

    expect(error.message).toContain("permission denied")
    expect(error.message).toContain("[REDACTED]")
    expect(error.message).not.toContain("never-print-me")
  })
})
