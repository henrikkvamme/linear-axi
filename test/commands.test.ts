import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { parseArgs, commandSpecs } from "../src/args"
import { runCommand } from "../src/commands"
import type { LinearGateway } from "../src/linear"

const baseIssue = {
  id: "issue-id",
  identifier: "ENG-123",
  title: "Fix auth bug",
  state: "Todo",
  assignee: "Henrik",
  updatedAt: "2026-07-08T00:00:00.000Z",
  url: "https://linear.app/acme/issue/ENG-123"
}

const fakeGateway = (description: string): LinearGateway => ({
  authStatus: () =>
    Effect.succeed({
      authenticated: true,
      method: "apiKey",
      viewer: {
        id: "user-id",
        name: "Henrik"
      }
    }),
  listTeams: () => Effect.succeed([{ id: "team-id", key: "ENG", name: "Engineering" }]),
  listIssues: () => Effect.succeed([baseIssue]),
  viewIssue: () =>
    Effect.succeed({
      ...baseIssue,
      description,
      priority: 2,
      team: "ENG"
    }),
  createIssue: () => Effect.succeed(baseIssue),
  createComment: () =>
    Effect.succeed({
      id: "comment-id",
      issueId: "issue-id",
      body: "Done",
      url: baseIssue.url
    })
})

const run = async (argv: ReadonlyArray<string>, gateway = fakeGateway("")) => {
  const parsed = parseArgs(argv, commandSpecs)
  return Effect.runPromise(runCommand(parsed, gateway, "/repo/src/main.ts"))
}

describe("runCommand", () => {
  test("home includes assigned issues when authenticated", async () => {
    const output = await run([])

    expect(output.auth).toEqual({
      authenticated: true,
      method: "apiKey",
      viewer: {
        id: "user-id",
        name: "Henrik"
      }
    })
    expect(output.issues).toEqual([baseIssue])
  })

  test("issues view truncates long descriptions by default", async () => {
    const output = await run(["issues", "view", "--id", "ENG-123"], fakeGateway("x".repeat(1300)))

    expect(output.body).toEqual({
      truncated: true,
      total: 1300
    })
  })

  test("issues view --full keeps long descriptions", async () => {
    const output = await run(["issues", "view", "--id", "ENG-123", "--full"], fakeGateway("x".repeat(1300)))

    expect(output.body).toBeUndefined()
    expect((output.issue as { description: string }).description).toHaveLength(1300)
  })

  test("issues list rejects unsupported assignee values", async () => {
    const parsed = parseArgs(["issues", "list", "--assignee", "alice"], commandSpecs)
    const exit = await Effect.runPromiseExit(runCommand(parsed, fakeGateway(""), "/repo/src/main.ts"))

    expect(exit._tag).toBe("Failure")
  })

  test("issues create passes the requested payload to the gateway", async () => {
    const gateway: LinearGateway = {
      ...fakeGateway(""),
      createIssue: (input) => {
        expect(input).toEqual({
          team: "ENG",
          title: "Fix auth bug",
          description: "Details"
        })
        return Effect.succeed(baseIssue)
      }
    }

    const output = await run([
      "issues",
      "create",
      "--team",
      "ENG",
      "--title",
      "Fix auth bug",
      "--description",
      "Details"
    ], gateway)

    expect(output.issue).toEqual(baseIssue)
  })

  test("comments create passes the requested payload to the gateway", async () => {
    const gateway: LinearGateway = {
      ...fakeGateway(""),
      createComment: (input) => {
        expect(input).toEqual({
          issue: "ENG-123",
          body: "Implemented in PR."
        })
        return Effect.succeed({
          id: "comment-id",
          issueId: "issue-id",
          body: input.body,
          url: baseIssue.url
        })
      }
    }

    const output = await run([
      "comments",
      "create",
      "--issue",
      "ENG-123",
      "--body",
      "Implemented in PR."
    ], gateway)

    expect(output.comment).toEqual({
      id: "comment-id",
      issueId: "issue-id",
      body: "Implemented in PR.",
      url: baseIssue.url
    })
  })

  test("oauth connect rejects unsupported actors before listening", async () => {
    const parsed = parseArgs(["auth", "oauth", "connect", "--client-id", "client1", "--actor", "robot"], commandSpecs)
    const exit = await Effect.runPromiseExit(runCommand(parsed, fakeGateway(""), "/repo/src/main.ts"))

    expect(exit._tag).toBe("Failure")
  })

  test("oauth setup returns registration values", async () => {
    const parsed = parseArgs(["auth", "oauth", "setup"], commandSpecs)
    const output = await Effect.runPromise(runCommand(parsed, fakeGateway(""), "/repo/src/main.ts", {}))

    expect(output.oauthSetup).toEqual({
      phase: "register-client",
      registerUrl: "https://linear.app/settings/api/applications/new",
      redirectUri: "http://127.0.0.1:14582/oauth/callback",
      scope: "read,write",
      actor: "user",
      installableByOtherWorkspaces: true,
      webhooks: false
    })
  })

  test("auth login rejects invalid timeout before listening", async () => {
    const parsed = parseArgs(["auth", "login", "--timeout", "5"], commandSpecs)
    const error = await Effect.runPromise(Effect.flip(runCommand(parsed, fakeGateway(""), "/repo/src/main.ts", {})))

    expect(error.help).toContain("auth login")
  })

  test("oauth connect rejects non-loopback redirect hosts before listening", async () => {
    const parsed = parseArgs([
      "auth",
      "oauth",
      "connect",
      "--client-id",
      "client1",
      "--redirect-uri",
      "http://0.0.0.0:14582/oauth/callback"
    ], commandSpecs)
    const exit = await Effect.runPromiseExit(runCommand(parsed, fakeGateway(""), "/repo/src/main.ts"))

    expect(exit._tag).toBe("Failure")
  })

  test("oauth connect rejects redirect URIs without explicit ports", async () => {
    const parsed = parseArgs([
      "auth",
      "oauth",
      "connect",
      "--client-id",
      "client1",
      "--redirect-uri",
      "http://127.0.0.1/oauth/callback"
    ], commandSpecs)
    const exit = await Effect.runPromiseExit(runCommand(parsed, fakeGateway(""), "/repo/src/main.ts"))

    expect(exit._tag).toBe("Failure")
  })
})
