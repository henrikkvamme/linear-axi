import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { commandSpecs, parseArgs } from "../src/args"
import { runCommand } from "../src/commands"
import type { IssueDetail, IssueSummary, LinearGateway } from "../src/linear"
import { encodeFrontierCursor } from "../src/wayfinder"

const baseIssue: IssueSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  identifier: "ENG-123",
  title: "Fix auth bug",
  state: "Todo",
  stateType: "unstarted",
  assignee: "Henrik",
  assigneeId: "22222222-2222-4222-8222-222222222222",
  parent: null,
  parentId: null,
  labels: [{ id: "label-id", name: "wayfinder:task" }],
  updatedAt: "2026-07-08T00:00:00.000Z",
  createdAt: "2026-07-07T00:00:00.000Z",
  url: "https://linear.app/acme/issue/ENG-123",
  subIssueSortOrder: 1
}

const detail = (description = ""): IssueDetail => ({
  ...baseIssue,
  description,
  priority: 2,
  team: "ENG",
  teamId: "33333333-3333-4333-8333-333333333333"
})
const page = <Value>(items: ReadonlyArray<Value>, hasNext = false) => ({
  items,
  page: { hasNext, endCursor: hasNext ? "next-cursor" : null }
})

const mutation = <Value>(value: Value, changed = true, result = "changed") => ({ value, changed, result })

const fakeGateway = (overrides: Partial<LinearGateway> = {}): LinearGateway => ({
  authStatus: () => Effect.succeed({
    authenticated: true,
    method: "apiKey",
    viewer: { id: "user-id", name: "Henrik" }
  }),
  listTeams: () => Effect.succeed([{ id: "team-id", key: "ENG", name: "Engineering" }]),
  listIssues: () => Effect.succeed(page([baseIssue])),
  viewIssue: () => Effect.succeed(detail()),
  createIssue: () => Effect.succeed(mutation(baseIssue, true, "issue created")),
  assignIssue: () => Effect.succeed(mutation(baseIssue, true, "issue assigned")),
  unassignIssue: () => Effect.succeed(mutation({ ...baseIssue, assignee: "unassigned", assigneeId: null }, true, "issue unassigned")),
  closeIssue: () => Effect.succeed(mutation({ ...baseIssue, state: "Done", stateType: "completed" }, true, "issue closed")),
  updateIssueDescription: () => Effect.succeed(mutation(detail("updated"), true, "description updated and verified")),
  listLabels: () => Effect.succeed(page([{ id: "label-id", name: "wayfinder:task", scope: "workspace", teamId: null, color: "#123456", description: "Task", isGroup: false, archivedAt: null }])),
  createLabel: () => Effect.succeed(mutation({ id: "label-id", name: "wayfinder:task", scope: "workspace", teamId: null, color: "#123456", description: "Task", isGroup: false, archivedAt: null }, true, "label created")),
  applyLabel: () => Effect.succeed(mutation(baseIssue, false, "label already applied (no-op)")),
  listRelations: () => Effect.succeed(page([{ id: "relation-id", type: "blocks", direction: "outgoing", identifier: "ENG-124", title: "Target", state: "Todo", sourceId: baseIssue.id, targetId: "target-id" }])),
  createRelation: () => Effect.succeed(mutation({ id: "relation-id", type: "blocks", direction: "outgoing", identifier: "ENG-124", title: "Target", state: "Todo", sourceId: baseIssue.id, targetId: "target-id" }, true, "directed relation created")),
  listComments: () => Effect.succeed(page([{ id: "comment-id", issueId: baseIssue.id, body: "Done", createdAt: "2026-07-08T00:00:00.000Z", updatedAt: "2026-07-08T00:00:00.000Z", author: "Henrik", url: `${baseIssue.url}#comment-id` }])),
  createComment: () => Effect.succeed(mutation({ id: "comment-id", issueId: baseIssue.id, body: "Done", createdAt: "2026-07-08T00:00:00.000Z", updatedAt: "2026-07-08T00:00:00.000Z", author: "Henrik", url: `${baseIssue.url}#comment-id` }, true, "comment created")),
  frontier: () => Effect.succeed({
    map: { id: "map-id", identifier: "ENG-100", title: "Map" },
    total: 1,
    items: [{ id: baseIssue.id, identifier: baseIssue.identifier, title: baseIssue.title, type: "task" }],
    pageInfo: { hasNextPage: false, endCursor: null }
  }),
  ...overrides
})

const run = async (argv: ReadonlyArray<string>, gateway = fakeGateway()) => {
  const parsed = parseArgs(argv, commandSpecs)
  return Effect.runPromise(runCommand(parsed, gateway, "/repo/src/main.ts"))
}

describe("runCommand", () => {
  test("home includes assigned issues when authenticated", async () => {
    const output = await run([])
    expect(output.auth).toMatchObject({ authenticated: true })
    expect(output.issues).toEqual([{ id: baseIssue.id, identifier: "ENG-123", title: "Fix auth bug", state: "Todo" }])
  })

  test("issues list passes every approved filter and carries pagination help", async () => {
    const gateway = fakeGateway({
      listIssues: (input) => {
        expect(input).toEqual({
          limit: 5,
          after: "cursor-1",
          assignee: "none",
          team: "ENG",
          label: "wayfinder:task",
          parent: "ENG-100",
          state: "open",
          fields: ["identifier", "title", "parent"]
        })
        return Effect.succeed(page([baseIssue], true))
      }
    })
    const output = await run(["issues", "list", "--team", "ENG", "--label", "wayfinder:task", "--parent", "ENG-100", "--assignee", "none", "--state", "open", "--after", "cursor-1", "--limit", "5", "--fields", "identifier,title,parent"], gateway)
    expect(output.issues).toEqual([{ identifier: "ENG-123", title: "Fix auth bug", parent: null }])
    expect((output.help as string[])[0]).toContain("--after 'next-cursor'")
  })

  test("issues list preserves structured label names including commas", async () => {
    const labeled = {
      ...baseIssue,
      labels: [
        { id: "label-1", name: "backend,urgent" },
        { id: "label-2", name: "wayfinder:task" }
      ]
    }
    const output = await run(
      ["issues", "list", "--fields", "identifier,labels"],
      fakeGateway({ listIssues: () => Effect.succeed(page([labeled])) })
    )

    expect(output.issues).toEqual([{
      identifier: "ENG-123",
      labels: ["backend,urgent", "wayfinder:task"]
    }])
  })

  test("continuation commands shell-escape replayed values and cursors", async () => {
    const output = await run(
      ["issues", "list", "--team", "$(echo injected)'`$HOME", "--limit", "5"],
      fakeGateway({ listIssues: () => Effect.succeed({
        items: [baseIssue],
        page: { hasNext: true, endCursor: "cursor'$(echo injected)`$HOME" }
      }) })
    )
    const help = (output.help as string[])[0]!

    expect(help).toContain("--team '$(echo injected)'\"'\"'`$HOME'")
    expect(help).toContain("--after 'cursor'\"'\"'$(echo injected)`$HOME'")
    expect(help).not.toContain('"$(echo injected)')
  })

  test("issues list emits a definitive child empty state", async () => {
    const output = await run(["issues", "list", "--parent", "ENG-100"], fakeGateway({ listIssues: () => Effect.succeed(page([])) }))
    expect(output.issues).toBe("0 child issues found for ENG-100")
  })

  test("issues view truncates and --full preserves descriptions", async () => {
    const gateway = fakeGateway({ viewIssue: () => Effect.succeed(detail("x".repeat(1300))) })
    const short = await run(["issues", "view", "--id", "ENG-123"], gateway)
    const full = await run(["issues", "view", "--id", "ENG-123", "--full"], gateway)
    expect(short.body).toEqual({ truncated: true, total: 1300 })
    expect((full.issue as IssueDetail).description).toHaveLength(1300)
  })

  test("issues create reads description files and preserves parent, label, and caller UUID", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-command-"))
    const file = join(root, "body.md")
    writeFileSync(file, "Details")
    const id = "44444444-4444-4444-8444-444444444444"
    const gateway = fakeGateway({
      createIssue: (input) => {
        expect(input).toEqual({ team: "ENG", title: "Child", description: "Details", parent: "ENG-100", label: "wayfinder:task", id })
        return Effect.succeed(mutation(baseIssue))
      }
    })
    await run(["issues", "create", "--team", "ENG", "--title", "Child", "--description-file", file, "--parent", "ENG-100", "--label", "wayfinder:task", "--id", id], gateway)
  })

  test("assignment, release, close, and update pass conflict-aware inputs", async () => {
    const assignee = "55555555-5555-4555-8555-555555555555"
    const calls: unknown[] = []
    const gateway = fakeGateway({
      assignIssue: (input) => { calls.push(input); return Effect.succeed(mutation(baseIssue)) },
      unassignIssue: (input) => { calls.push(input); return Effect.succeed(mutation(baseIssue)) },
      closeIssue: (input) => { calls.push(input); return Effect.succeed(mutation(baseIssue)) },
      updateIssueDescription: (input) => { calls.push(input); return Effect.succeed(mutation(detail("new"))) }
    })
    const root = mkdtempSync(join(tmpdir(), "linear-axi-command-"))
    const file = join(root, "map.md")
    writeFileSync(file, "new")
    await run(["issues", "assign", "--id", "ENG-123", "--assignee", assignee, "--replace"], gateway)
    await run(["issues", "unassign", "--id", "ENG-123", "--if-assignee", assignee], gateway)
    await run(["issues", "close", "--id", "ENG-123", "--state", "66666666-6666-4666-8666-666666666666"], gateway)
    const updated = await run(["issues", "update", "--id", "ENG-100", "--description-file", file, "--if-updated-at", "2026-07-08T00:00:00Z"], gateway)
    expect(calls).toHaveLength(4)
    expect(updated.concurrency).toContain("no atomic compare-and-swap")
  })

  test("labels commands preserve scope, exact fields, and idempotent status", async () => {
    const created = await run(["labels", "create", "--workspace", "--name", "wayfinder:task", "--color", "#123456", "--if-absent"])
    const listed = await run(["labels", "list", "--workspace", "--fields", "id,name,color"])
    const applied = await run(["labels", "apply", "--issue", "ENG-123", "--label", "wayfinder:task"])
    expect(created.changed).toBe(true)
    expect(listed.labels).toEqual([{ id: "label-id", name: "wayfinder:task", color: "#123456" }])
    expect(applied).toMatchObject({ changed: false, result: "label already applied (no-op)" })
  })

  test("relations preserve directed blocker and target inputs", async () => {
    const gateway = fakeGateway({
      createRelation: (input) => {
        expect(input).toEqual({ issue: "ENG-123", relatedIssue: "ENG-124", type: "blocks", id: undefined })
        return Effect.succeed(mutation({ id: "relation-id", type: "blocks", direction: "outgoing", identifier: "ENG-124", title: "Target", state: "Todo", sourceId: baseIssue.id, targetId: "target-id" }))
      }
    })
    const output = await run(["relations", "create", "--issue", "ENG-123", "--related-issue", "ENG-124", "--type", "blocks"], gateway)
    expect((output.relation as { direction: string }).direction).toBe("outgoing")
  })

  test("comments list truncates with total and create reads body files with caller UUID", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-command-"))
    const file = join(root, "comment.md")
    writeFileSync(file, "Resolution")
    const id = "77777777-7777-4777-8777-777777777777"
    const gateway = fakeGateway({
      listComments: () => Effect.succeed(page([{ id: "comment-id", issueId: baseIssue.id, body: "x".repeat(600), createdAt: baseIssue.createdAt, updatedAt: baseIssue.updatedAt, author: "Henrik", url: baseIssue.url }])),
      createComment: (input) => {
        expect(input).toEqual({ issue: "ENG-123", body: "Resolution", id })
        return Effect.succeed(mutation({ id, issueId: baseIssue.id, body: input.body, createdAt: baseIssue.createdAt, updatedAt: baseIssue.updatedAt, author: "Henrik", url: baseIssue.url }))
      }
    })
    const listed = await run(["comments", "list", "--issue", "ENG-123"], gateway)
    expect((listed.comments as Array<{ body: string }>)[0]!.body).toContain("600 chars total")
    await run(["comments", "create", "--issue", "ENG-123", "--body-file", file, "--id", id], gateway)
  })

  test("frontier emits paginated claim guidance and definitive empty pages", async () => {
    const previousCursor = encodeFrontierCursor({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      createdAt: "2026-07-07T00:00:00.000Z",
      subIssueSortOrder: 1
    })
    const nextCursor = encodeFrontierCursor({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      createdAt: "2026-07-08T00:00:00.000Z",
      subIssueSortOrder: 2
    })
    const calls: unknown[] = []
    const gateway = fakeGateway({
      frontier: (input) => {
        calls.push(input)
        return Effect.succeed({
          map: { id: "map-id", identifier: "ENG-100", title: "Map" },
          total: 101,
          items: [{ id: baseIssue.id, identifier: baseIssue.identifier, title: baseIssue.title, type: "task" }],
          pageInfo: { hasNextPage: true, endCursor: nextCursor }
        })
      }
    })
    const found = await run(["wayfinder", "frontier", "--map", "ENG-100", "--first", "100", "--after", previousCursor], gateway)
    expect(calls).toEqual([{ map: "ENG-100", first: 100, after: previousCursor }])
    expect(found.pageInfo).toEqual({ hasNextPage: true, endCursor: nextCursor })
    expect((found.help as string[])[0]).toContain("issues assign --id ENG-123 --assignee me")
    expect((found.help as string[])[1]).toContain(`--after '${nextCursor}'`)

    const empty = await run(["wayfinder", "frontier", "--map", "ENG-100", "--after", previousCursor], fakeGateway({
      frontier: () => Effect.succeed({
        map: { id: "map-id", identifier: "ENG-100", title: "Map" },
        total: 100,
        items: [],
        pageInfo: { hasNextPage: false, endCursor: null }
      })
    }))
    expect(empty.frontier).toBe("0 frontier issues found after the supplied cursor for ENG-100")
    expect(empty.pageInfo).toEqual({ hasNextPage: false, endCursor: null })
  })

  test("malformed and conflicting flags fail before gateway access", async () => {
    let calls = 0
    const gateway = fakeGateway({
      createComment: () => { calls += 1; return Effect.succeed(mutation({ id: "x", issueId: "x", body: "x", createdAt: "x", updatedAt: "x", author: "x", url: "x" })) },
      updateIssueDescription: () => { calls += 1; return Effect.succeed(mutation(detail())) },
      frontier: () => {
        calls += 1
        return Effect.succeed({
          map: { id: "map-id", identifier: "ENG-100", title: "Map" },
          total: 0,
          items: [],
          pageInfo: { hasNextPage: false, endCursor: null }
        })
      }
    })
    for (const argv of [
      ["comments", "create", "--issue", "ENG-123", "--body", "a", "--body-file", "b"],
      ["issues", "update", "--id", "ENG-100", "--description-file", "x", "--if-updated-at", "yesterday"],
      ["labels", "create", "--workspace", "--team", "ENG", "--name", "x", "--color", "red"],
      ["wayfinder", "frontier", "--map", "ENG-100", "--after", "invalid"]
    ]) {
      const parsed = parseArgs(argv, commandSpecs)
      const exit = await Effect.runPromiseExit(runCommand(parsed, gateway, "/repo/src/main.ts"))
      expect(exit._tag).toBe("Failure")
    }
    expect(calls).toBe(0)
  })
})
