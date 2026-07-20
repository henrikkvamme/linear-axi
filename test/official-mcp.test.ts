import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { collectOfficialMcpTools, decodeStreamableHttpMessage, makeOfficialMcpToolCaller } from "../src/official-mcp"

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

  test("tools inventory capture exhausts cursor pages without changing schemas", async () => {
    const calls: Array<Readonly<Record<string, unknown>>> = []
    const client = {
      request: (_method: string, params: Readonly<Record<string, unknown>>) => {
        calls.push(params)
        return Effect.succeed(calls.length === 1
          ? { tools: [{ name: "list_teams", inputSchema: { type: "object", properties: { limit: { type: "number" } } } }], nextCursor: "page-2" }
          : { tools: [{ name: "get_team", annotations: { readOnlyHint: true } }] })
      }
    }

    const tools = await Effect.runPromise(collectOfficialMcpTools(client))

    expect(calls).toEqual([{}, { cursor: "page-2" }])
    expect(tools).toEqual([
      { name: "list_teams", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
      { name: "get_team", annotations: { readOnlyHint: true } }
    ])
  })

  test("tools inventory capture rejects repeated cursors and page overflow", async () => {
    const repeated = {
      request: () => Effect.succeed({ tools: [], nextCursor: "same" })
    }
    const repeatedError = await Effect.runPromise(Effect.flip(collectOfficialMcpTools(repeated)))
    expect(repeatedError.message).toContain("cursor did not advance")

    let pages = 0
    const unbounded = {
      request: () => Effect.succeed({ tools: [{ name: `tool-${pages}` }], nextCursor: `cursor-${pages++}` })
    }
    const limitError = await Effect.runPromise(Effect.flip(collectOfficialMcpTools(unbounded, 2)))
    expect(limitError.message).toContain("exceeded the 2-page safety limit")
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
      },
      {
        args: { team: "team-id", title: "Launch", addReleases: ["release-id"], blocks: ["ENG-124"] },
        inspection: "linear-axi issues search --team 'team-id' --query 'Launch' --full",
        followup: "then run `linear-axi issues inspect --id '<candidate-id>' --relations --releases --full`"
      },
      {
        args: { id: "ENG-123", addReleases: ["release-id"], blocks: ["ENG-124"] },
        inspection: "linear-axi issues inspect --id 'ENG-123' --relations --releases --full"
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
      if ("followup" in entry) expect(error.help).toContain(entry.followup)
      expect(error.help).not.toContain("retry")
    }
  }, 1_000)

  test("save transport failures after dispatch require inspection without retry", async () => {
    const cases = [
      {
        respond: () => Promise.reject(new Error("connection reset")),
        detail: "awaiting-response"
      },
      {
        respond: () => Promise.resolve(new Response(null, { status: 503 })),
        detail: "response-received"
      },
      {
        respond: () => Promise.resolve(new Response("not-json", { status: 200, headers: { "content-type": "application/json" } })),
        detail: "response-received"
      }
    ] as const

    for (const entry of cases) {
      const requests: Array<{ readonly request: Record<string, unknown>; readonly headers: Headers }> = []
      const transport = initializedFetcher((request) => {
        void request
        throw new Error("unused")
      }, requests)
      const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const request = JSON.parse(String(init?.body)) as Record<string, unknown>
        if (request.method === "tools/call") return entry.respond()
        return transport.fetcher(input, init)
      }
      const call = makeOfficialMcpToolCaller({ kind: "apiKey", value: "secret-value" }, { fetcher })

      const error = await Effect.runPromise(Effect.flip(call("save_project", { id: "project-id", state: "started" })))

      expect(error._tag).toBe("LinearApiError")
      expect(error.message).toContain(`after dispatch during ${entry.detail}`)
      expect(error.help).toContain("linear-axi projects view --query 'project-id' --full")
      expect(error.help).not.toContain("retry")
    }
  })

  test("save calls are not replayed after an expired-session response", async () => {
    let initializations = 0
    let saves = 0
    const fetcher = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (request.method === "initialize") {
        initializations += 1
        return Response.json({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", capabilities: {} } }, {
          headers: { "mcp-session-id": `session-${initializations}` }
        })
      }
      if (request.method === "notifications/initialized") return new Response(null, { status: 202 })
      saves += 1
      return new Response(null, { status: 404 })
    }
    const call = makeOfficialMcpToolCaller({ kind: "apiKey", value: "secret-value" }, { fetcher })

    const error = await Effect.runPromise(Effect.flip(call("save_project", { id: "project-id", state: "started" })))

    expect(initializations).toBe(1)
    expect(saves).toBe(1)
    expect(error.message).toContain("mutation outcome is unknown")
    expect(error.help).not.toContain("retry")
  })

  test("malformed save tool payloads have ambiguous outcomes", async () => {
    const transport = initializedFetcher((request) => Response.json({
      jsonrpc: "2.0",
      id: request.id,
      result: { content: [{ type: "text", text: "not-json" }] }
    }))
    const call = makeOfficialMcpToolCaller({ kind: "apiKey", value: "secret-value" }, { fetcher: transport.fetcher })

    const error = await Effect.runPromise(Effect.flip(call("save_release", { id: "release-id", stage: "started" })))

    expect(error.message).toContain("mutation outcome is unknown")
    expect(error.help).toContain("linear-axi releases view --id 'release-id' --full")
    expect(error.help).not.toContain("retry")
  })

  test.each([
    {
      channel: "JSON-RPC error",
      response: (id: unknown) => ({ jsonrpc: "2.0", id, error: { message: "validation failed" } })
    },
    {
      channel: "tool result error",
      response: (id: unknown) => ({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: "validation failed" }], isError: true }
      })
    }
  ])("save $channel is ambiguous after dispatch", async ({ response }) => {
    const transport = initializedFetcher((request) => Response.json(response(request.id)))
    const call = makeOfficialMcpToolCaller({ kind: "apiKey", value: "secret-value" }, { fetcher: transport.fetcher })

    const error = await Effect.runPromise(Effect.flip(call("save_project", { id: "project-id", state: "invalid" })))

    expect(error.message).toContain("mutation outcome is unknown")
    expect(error.help).toContain("linear-axi projects view --query 'project-id' --full")
    expect(error.help).not.toContain("retry")
  })

  test("typed pre-execution save rejection remains definitive", async () => {
    const transport = initializedFetcher((request) => Response.json({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32602, message: "invalid params" }
    }))
    const call = makeOfficialMcpToolCaller({ kind: "apiKey", value: "secret-value" }, { fetcher: transport.fetcher })

    const error = await Effect.runPromise(Effect.flip(call("save_project", { id: "project-id", state: "invalid" })))

    expect(error.message).toContain("invalid params")
    expect(error.message).not.toContain("outcome is unknown")
  })

  test("finalizes sessions after successful and failed tool calls", async () => {
    for (const toolFails of [false, true]) {
      let deletes = 0
      let deleteHeaders: Headers | undefined
      const fetcher = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        if (init?.method === "DELETE") {
          deletes += 1
          deleteHeaders = new Headers(init.headers)
          if (toolFails) throw new Error("cleanup failed")
          return new Response(null, { status: 405 })
        }
        const request = JSON.parse(String(init?.body)) as Record<string, unknown>
        if (request.method === "initialize") {
          return Response.json({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", capabilities: {} } }, {
            headers: { "mcp-session-id": "session-1" }
          })
        }
        if (request.method === "notifications/initialized") return new Response(null, { status: 202 })
        return toolFails
          ? Response.json({ jsonrpc: "2.0", id: request.id, error: { message: "tool failed" } })
          : Response.json({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "{}" }] } })
      }
      const call = makeOfficialMcpToolCaller({ kind: "apiKey", value: "secret-value" }, { fetcher })

      const exit = await Effect.runPromiseExit(call("get_project", { query: "Roadmap" }).pipe(
        Effect.ensuring(call.close())
      ))

      expect(deletes).toBe(1)
      expect(deleteHeaders?.get("mcp-session-id")).toBe("session-1")
      expect(deleteHeaders?.get("mcp-protocol-version")).toBe("2025-03-26")
      if (toolFails) {
        expect(exit._tag).toBe("Failure")
        expect(String(exit)).toContain("tool failed")
      } else {
        expect(exit._tag).toBe("Success")
      }
    }
  })

  test("finalizes a session allocated by a failed initialization", async () => {
    let deletes = 0
    const fetcher = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.method === "DELETE") {
        deletes += 1
        return new Response(null, { status: 200 })
      }
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "unsupported" } }, {
        headers: { "mcp-session-id": "session-1" }
      })
    }
    const call = makeOfficialMcpToolCaller({ kind: "apiKey", value: "secret-value" }, { fetcher })

    const exit = await Effect.runPromiseExit(call("get_project", { query: "Roadmap" }).pipe(
      Effect.ensuring(call.close())
    ))

    expect(exit._tag).toBe("Failure")
    expect(deletes).toBe(1)
  })

  test("session finalization remains bounded when response cancellation stalls", async () => {
    const fetcher = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.method === "DELETE") {
        return new Response(new ReadableStream({
          cancel: () => new Promise<void>(() => undefined)
        }))
      }
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (request.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", capabilities: {} } }, {
          headers: { "mcp-session-id": "session-1" }
        })
      }
      if (request.method === "notifications/initialized") return new Response(null, { status: 202 })
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "{}" }] } })
    }
    const call = makeOfficialMcpToolCaller({ kind: "apiKey", value: "secret-value" }, {
      fetcher,
      requestTimeoutMs: 10_000,
      cleanupTimeoutMs: 25
    })

    const startedAt = performance.now()
    const exit = await Effect.runPromiseExit(call("get_project", { query: "Roadmap" }).pipe(
      Effect.ensuring(call.close())
    ))

    expect(exit._tag).toBe("Success")
    expect(performance.now() - startedAt).toBeLessThan(500)
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
