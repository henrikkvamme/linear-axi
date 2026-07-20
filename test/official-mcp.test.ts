import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { decodeStreamableHttpMessage, makeOfficialMcpToolCaller } from "../src/official-mcp"

describe("official Linear MCP tool boundary", () => {
  test("sends a tools/call payload and decodes JSON text content", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = []
    const fetcher = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests.push({ url: String(url), init: init! })
      return new Response([
        "event: message",
        'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
        "",
        "event: message",
        'data: {"result":{"content":[{"type":"text","text":"{\\"teams\\":[{\\"id\\":\\"team-1\\",\\"name\\":\\"Engineering\\"}],\\"hasNextPage\\":false}"}]},"jsonrpc":"2.0","id":1}',
        ""
      ].join("\n"), { status: 200, headers: { "content-type": "text/event-stream" } })
    }
    const call = makeOfficialMcpToolCaller({ kind: "apiKey", value: "secret-value" }, { fetcher })

    const result = await Effect.runPromise(call("list_teams", { limit: 1 }))

    expect(result).toEqual({ teams: [{ id: "team-1", name: "Engineering" }], hasNextPage: false })
    expect(JSON.parse(String(requests[0]!.init.body))).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_teams", arguments: { limit: 1 } }
    })
    expect(new Headers(requests[0]!.init.headers).get("authorization")).toBe("Bearer secret-value")
  })

  test("decodes application/json Streamable HTTP responses", async () => {
    const fetcher = async (): Promise<Response> => new Response(
      '{"result":{"content":[{"type":"text","text":"{\\"id\\":\\"project-1\\",\\"name\\":\\"Roadmap\\"}"}]},"jsonrpc":"2.0","id":1}',
      { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }
    )
    const call = makeOfficialMcpToolCaller({ kind: "apiKey", value: "secret-value" }, { fetcher })

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

  test("translates tool and malformed response errors without echoing credentials", async () => {
    const fetcher = async (): Promise<Response> => new Response(
      'event: message\ndata: {"result":{"content":[{"type":"text","text":"permission denied for never-print-me"}],"isError":true},"jsonrpc":"2.0","id":1}\n',
      { status: 200 }
    )
    const call = makeOfficialMcpToolCaller({ kind: "accessToken", value: "never-print-me" }, { fetcher })

    const error = await Effect.runPromise(Effect.flip(call("get_project", { query: "Roadmap" })))

    expect(error.message).toContain("permission denied")
    expect(error.message).toContain("[REDACTED]")
    expect(error.message).not.toContain("never-print-me")
  })
})
