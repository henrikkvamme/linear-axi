import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { commandSpecs, parseArgs } from "../src/args"
import { runCommand } from "../src/commands"
import { LinearApiError, UsageError } from "../src/errors"
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
const baseRelation = {
  id: "relation-id",
  type: "blocks" as const,
  direction: "outgoing" as const,
  identifier: "ENG-124",
  title: "Target",
  state: "Todo",
  sourceId: baseIssue.id,
  targetId: "target-id"
}

const normalizeActiveOfficialOutput = (name: string, value: unknown): unknown => {
  const active = (entity: unknown): unknown => entity && typeof entity === "object" && !("archivedAt" in entity)
    ? { ...entity, archivedAt: null }
    : entity
  const ordinaryLabel = (entity: unknown): unknown => {
    const normalized = active(entity)
    return name === "list_issue_labels" && normalized && typeof normalized === "object" && !("isGroup" in normalized)
      ? { ...normalized, isGroup: false }
      : normalized
  }
  if (["get_team", "get_project", "get_issue", "get_milestone", "get_user"].includes(name)) return active(value)
  if (name === "get_status_updates" && value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).statusUpdates)) {
    return { ...value, hasNextPage: "hasNextPage" in value ? (value as Record<string, unknown>).hasNextPage : false }
  }
  if (["list_issue_statuses", "list_cycles"].includes(name) && Array.isArray(value)) return value.map(active)
  if (value && typeof value === "object") {
    const key = ({
      list_issue_labels: "labels",
      list_issues: "issues",
      list_releases: "releases",
      list_release_pipelines: "releasePipelines",
      list_users: "users"
    } as Record<string, string>)[name]
    if (key && Array.isArray((value as Record<string, unknown>)[key])) {
      return { ...value, [key]: ((value as Record<string, unknown>)[key] as ReadonlyArray<unknown>).map(ordinaryLabel) }
    }
  }
  return value
}

const fakeGateway = (
  overrides: Partial<LinearGateway> = {},
  normalizeActiveState = true
): LinearGateway => {
  const gateway: LinearGateway = {
    close: () => Effect.void,
    callOfficialTool: () => Effect.succeed({}),
    authStatus: () => Effect.succeed({
      authenticated: true,
      method: "apiKey",
      viewer: { id: "user-id", name: "Henrik" }
    }),
    listTeams: () => Effect.succeed([{ id: "team-id", key: "ENG", name: "Engineering" }]),
    resolveProjectUpdateAssociations: (input) => Effect.succeed(input),
    listWorkflowStates: () => Effect.succeed([]),
    listIssues: () => Effect.succeed(page([baseIssue])),
    viewIssue: () => Effect.succeed(detail()),
    createIssue: () => Effect.succeed(mutation(baseIssue, true, "issue created")),
    assignIssue: () => Effect.succeed(mutation(baseIssue, true, "issue assigned")),
    unassignIssue: () => Effect.succeed(mutation({ ...baseIssue, assignee: "unassigned", assigneeId: null }, true, "issue unassigned")),
    closeIssue: () => Effect.succeed(mutation({ ...baseIssue, state: "Done", stateType: "completed" }, true, "issue closed")),
    changeIssueState: () => Effect.succeed(mutation(baseIssue, false, "already in the requested workflow state (no-op)")),
    setIssueParent: () => Effect.succeed(mutation(baseIssue, false, "requested parent already set (no-op)")),
    clearIssueFields: () => Effect.succeed(mutation(baseIssue, false, "requested issue fields already clear (no-op)")),
    updateIssueDescription: () => Effect.succeed(mutation(detail("updated"), true, "description updated and verified")),
    listLabels: () => Effect.succeed(page([{ id: "label-id", name: "wayfinder:task", scope: "workspace", teamId: null, parentId: null, color: "#123456", description: "Task", isGroup: false, archivedAt: null }])),
    createLabel: () => Effect.succeed(mutation({ id: "label-id", name: "wayfinder:task", scope: "workspace", teamId: null, parentId: null, color: "#123456", description: "Task", isGroup: false, archivedAt: null }, true, "label created")),
    applyLabel: () => Effect.succeed(mutation(baseIssue, false, "label already applied (no-op)")),
    removeLabel: () => Effect.succeed(mutation(baseIssue, false, "label already absent (no-op)")),
    replaceLabels: () => Effect.succeed(mutation(baseIssue, false, "labels already match requested replacement (no-op)")),
    listRelations: () => Effect.succeed(page([{ id: "relation-id", type: "blocks", direction: "outgoing", identifier: "ENG-124", title: "Target", state: "Todo", sourceId: baseIssue.id, targetId: "target-id" }])),
    createRelation: () => Effect.succeed(mutation({ id: "relation-id", type: "blocks", direction: "outgoing", identifier: "ENG-124", title: "Target", state: "Todo", sourceId: baseIssue.id, targetId: "target-id" }, true, "directed relation created")),
    removeRelation: () => Effect.succeed(mutation({ id: "relation-id" }, false, "directed relation already absent (no-op)")),
    listComments: () => Effect.succeed(page([{ id: "comment-id", issueId: baseIssue.id, body: "Done", createdAt: "2026-07-08T00:00:00.000Z", updatedAt: "2026-07-08T00:00:00.000Z", author: "Henrik", url: `${baseIssue.url}#comment-id` }])),
    createComment: () => Effect.succeed(mutation({ id: "comment-id", issueId: baseIssue.id, body: "Done", createdAt: "2026-07-08T00:00:00.000Z", updatedAt: "2026-07-08T00:00:00.000Z", author: "Henrik", url: `${baseIssue.url}#comment-id` }, true, "comment created")),
    frontier: () => Effect.succeed({
      map: { id: "map-id", identifier: "ENG-100", title: "Map" },
      total: 1,
      items: [{ id: baseIssue.id, identifier: baseIssue.identifier, title: baseIssue.title, type: "task" }],
      pageInfo: { hasNextPage: false, endCursor: null }
    }),
    ...overrides
  }
  if (!normalizeActiveState || !overrides.callOfficialTool) return gateway
  return {
    ...gateway,
    callOfficialTool: (name, args) => overrides.callOfficialTool!(name, args).pipe(
      Effect.map((value) => normalizeActiveOfficialOutput(name, value))
    )
  }
}

const run = async (argv: ReadonlyArray<string>, gateway = fakeGateway()) => {
  const parsed = parseArgs(argv, commandSpecs)
  return Effect.runPromise(runCommand(parsed, gateway, "/repo/src/main.ts"))
}

describe("runCommand", () => {
  test("official command help renders precise flag contracts", () => {
    const projectHelp = commandSpecs.find((spec) => spec.path.join(" ") === "projects update")!.help
    const projectListHelp = commandSpecs.find((spec) => spec.path.join(" ") === "projects list")!.help
    const issueHelp = commandSpecs.find((spec) => spec.path.join(" ") === "issues search")!.help

    expect(projectHelp).toContain("Options (single-use unless marked repeatable):")
    expect(projectHelp).toContain("--id <id> (required)")
    expect(projectHelp).toContain("--color <#RRGGBB>")
    expect(projectHelp).toContain("--summary <text:max-255>")
    expect(projectHelp).toContain("--start-date-resolution <halfYear|month|quarter|year>")
    expect(projectHelp).toContain("--priority <integer:0..4>")
    expect(projectHelp).toContain("--teams-json <JSON-string-array>")
    expect(projectHelp).toContain("conflicts: --add-teams-json, --remove-teams-json")
    expect(projectHelp).toContain("--clear-summary")
    expect(projectHelp).toContain("conflicts: --summary")
    expect(projectHelp).toContain("--if-updated-at <YYYY-MM-DDTHH:mm:ss.sssZ>")
    expect(projectListHelp).toContain("--limit <integer:1..50> (default: 50)")
    expect(issueHelp).toContain("--limit <integer:1..100> (default: 50)")
    expect(issueHelp).toContain("--order-by <createdAt|updatedAt> (default: updatedAt)")
    expect(issueHelp).toContain("--include-archived | --no-include-archived (default: true)")
    expect(issueHelp).toContain("--full (default: false) - Disable local projection and text truncation; associations still require explicit inclusion flags.")
  })

  test("official list commands pass validated arguments and render a minimal page", async () => {
    let called: { name: string; args: Readonly<Record<string, unknown>> } | undefined
    const output = await run(
      ["users", "list", "--query", "Alice", "--limit", "2", "--after", "cursor-1"],
      fakeGateway({
        callOfficialTool: (name, args) => {
          called = { name, args }
          return Effect.succeed({
            users: [{ id: "user-1", name: "Alice", email: "alice@example.com", active: true, ignored: "large" }],
            hasNextPage: true,
            cursor: "cursor-2"
          })
        }
      })
    )

    expect(called).toEqual({
      name: "list_users",
      args: { query: "Alice", limit: 2, cursor: "cursor-1" }
    })
    expect(output.users).toEqual([{ id: "user-1", name: "Alice", email: "alice@example.com", active: true }])
    expect(output.page).toEqual({ hasNext: true, endCursor: "cursor-2" })
    expect(output.help).toEqual(["Run `linear-axi users list --query 'Alice' --limit '2' --after 'cursor-2'` for the next page."])
  })

  test("official comment search truncates default bodies and preserves full output", async () => {
    const body = "x".repeat(700)
    const gateway = fakeGateway({
      callOfficialTool: () => Effect.succeed({
        comments: [{ id: "comment-id", body, createdAt: baseIssue.createdAt, updatedAt: baseIssue.updatedAt }],
        hasNextPage: false
      })
    })

    const compact = await run(["comments", "search", "--project-id", "project-id"], gateway)
    const full = await run(["comments", "search", "--project-id", "project-id", "--full"], gateway)

    expect((compact.comments as Array<{ body: string }>)[0]!.body).toEndWith("(truncated, 700 chars total)")
    expect(compact.help).toEqual(["Run `linear-axi comments search --project-id 'project-id' --full` for complete bodies."])
    expect((full.comments as Array<{ body: string }>)[0]!.body).toBe(body)
  })

  test("status update view requires one exact id and type match", async () => {
    const exact = { id: "update-id", type: "project", health: "onTrack", body: "Shipped" }
    const output = await run(["status-updates", "view", "--id", "update-id", "--type", "project"], fakeGateway({
      callOfficialTool: () => Effect.succeed({ statusUpdates: [exact], hasNextPage: false })
    }))
    expect(output.statusUpdates).toEqual(exact)

    const cases = [
      { rows: [], message: "returned no matching update" },
      { rows: [{ ...exact, id: "other-id" }], message: "did not match --id and --type" },
      { rows: [{ ...exact, type: "initiative" }], message: "did not match --id and --type" },
      { rows: [exact, { ...exact, id: "other-id" }], message: "returned multiple updates" }
    ]
    for (const entry of cases) {
      const error = await Effect.runPromise(Effect.flip(runCommand(
        parseArgs(["status-updates", "view", "--id", "update-id", "--type", "project"], commandSpecs),
        fakeGateway({ callOfficialTool: () => Effect.succeed({ statusUpdates: entry.rows, hasNextPage: false }) }),
        "/repo/src/main.ts"
      )))
      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain(entry.message)
    }
  })

  test("official detail commands require exact documented identities", async () => {
    const cases = [
      { argv: ["agent-skills", "view", "--id", "skill-id"], result: { id: "other-skill" } },
      { argv: ["documents", "view", "--id", "document-slug"], result: { id: "document-id", slugId: "other-slug" } },
      { argv: ["issues", "inspect", "--id", "ENG-123"], result: { id: "issue-id", identifier: "OPS-123" } },
      { argv: ["projects", "view", "--query", "Roadmap"], result: { id: "project-id", name: "Other", slugId: "other" } },
      { argv: ["releases", "view", "--id", "release-slug"], result: { id: "release-id", slugId: "other-release" } },
      { argv: ["release-notes", "view", "--id", "note-slug"], result: { id: "note-id", slugId: "other-note" } },
      { argv: ["diffs", "view", "--id", "ENG-42"], result: { id: "diff-id", identifier: "ENG-43" } },
      { argv: ["teams", "view", "--query", "ENG"], result: { id: "team-id", key: "OPS", name: "Operations" } },
      { argv: ["users", "view", "--query", "alice@example.com"], result: { id: "user-id", email: "bob@example.com", name: "Bob" } }
    ] as const

    for (const entry of cases) {
      const error = await Effect.runPromise(Effect.flip(runCommand(
        parseArgs(entry.argv, commandSpecs),
        fakeGateway({ callOfficialTool: () => Effect.succeed(entry.result) }, false),
        "/repo/src/main.ts"
      )))

      expect(error._tag, entry.argv.join(" ")).toBe("LinearDomainError")
      expect(error.message, entry.argv.join(" ")).toContain("output shape drifted")
    }
  })

  test("milestone detail canonicalizes and validates project ownership", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    const output = await run(["milestones", "view", "--project", "Roadmap", "--query", "Launch"], fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_project") return Effect.succeed({ id: "project-id", name: "Roadmap", slugId: "roadmap" })
        return Effect.succeed({ id: "milestone-id", name: "Launch", project: { id: "project-id" } })
      }
    }, false))

    expect(output.milestone).toMatchObject({ id: "milestone-id", name: "Launch" })
    expect(calls).toEqual([
      { name: "get_project", args: { query: "Roadmap" } },
      { name: "get_milestone", args: { project: "project-id", query: "Launch" } }
    ])

    const ownershipError = await Effect.runPromise(Effect.flip(runCommand(
      parseArgs(["milestones", "view", "--project", "Roadmap", "--query", "Launch"], commandSpecs),
      fakeGateway({
        callOfficialTool: (name) => Effect.succeed(name === "get_project"
          ? { id: "project-id", name: "Roadmap" }
          : { id: "milestone-id", name: "Launch", project: { id: "other-project" } })
      }, false),
      "/repo/src/main.ts"
    )))

    expect(ownershipError._tag).toBe("LinearDomainError")
    expect(ownershipError.message).toContain("output shape drifted")
  })

  test("users view proves the me selector against the authenticated viewer", async () => {
    const error = await Effect.runPromise(Effect.flip(runCommand(
      parseArgs(["users", "view", "--query", "me"], commandSpecs),
      fakeGateway({ callOfficialTool: () => Effect.succeed({ id: "other-user", name: "Someone" }) }, false),
      "/repo/src/main.ts"
    )))

    expect(error._tag).toBe("LinearDomainError")
    expect(error.message).toContain("output shape drifted")
  })

  test("official direct-array tools render definitive non-paginated lists", async () => {
    const output = await run(["cycles", "list", "--team-id", "team-id", "--type", "current"], fakeGateway({
      callOfficialTool: (name, args) => {
        expect(name).toBe("list_cycles")
        expect(args).toEqual({ teamId: "team-id", type: "current" })
        return Effect.succeed([{ id: "cycle-id", number: 7, name: "Cycle 7", startsAt: "2026-07-01", endsAt: "2026-07-14", ignored: true }])
      }
    }))
    expect(output.cycles).toEqual([{ id: "cycle-id", number: 7, name: "Cycle 7", startsAt: "2026-07-01" }])
    expect(output.page).toEqual({ hasNext: false, endCursor: null })
  })

  test("documentation search reports its current page without claiming a final page", async () => {
    const output = await run(["docs", "search", "--query", "projects", "--page", "2"], fakeGateway({
      callOfficialTool: () => Effect.succeed([{ title: "Projects", url: "https://linear.app/docs/projects", snippet: "Plan work" }])
    }))

    expect(output.page).toEqual({ current: 2 })
    expect(output.help).toEqual(["Run `linear-axi docs search --query 'projects' --page '3'` for the next page."])
  })

  test("official command validation and shape drift fail before false output", async () => {
    let calls = 0
    const gateway = fakeGateway({
      callOfficialTool: () => {
        calls += 1
        return Effect.succeed({ users: "not-an-array", hasNextPage: false })
      }
    })
    const invalid = parseArgs(["users", "list", "--order-by", "deletedAt"], commandSpecs)
    const usageError = await Effect.runPromise(Effect.flip(runCommand(invalid, gateway, "/repo/src/main.ts")))
    expect(usageError._tag).toBe("UsageError")
    expect(calls).toBe(0)

    const drifted = parseArgs(["users", "list"], commandSpecs)
    const driftError = await Effect.runPromise(Effect.flip(runCommand(drifted, gateway, "/repo/src/main.ts")))
    expect(driftError._tag).toBe("LinearDomainError")
    expect(driftError.message).toContain("output shape drifted")
    expect(calls).toBe(1)

    const paginationError = await Effect.runPromise(Effect.flip(runCommand(
      parseArgs(["users", "list"], commandSpecs),
      fakeGateway({ callOfficialTool: () => Effect.succeed({ users: [] }) }),
      "/repo/src/main.ts"
    )))
    expect(paginationError._tag).toBe("LinearDomainError")
    expect(paginationError.message).toContain("hasNextPage")

    for (const cursor of ["", "   "]) {
      const cursorError = await Effect.runPromise(Effect.flip(runCommand(
        parseArgs(["users", "list"], commandSpecs),
        fakeGateway({ callOfficialTool: () => Effect.succeed({ users: [], hasNextPage: true, cursor }) }),
        "/repo/src/main.ts"
      )))
      expect(cursorError._tag).toBe("LinearDomainError")
      expect(cursorError.message).toContain("non-blank cursor")
    }

    const repeatedCursorError = await Effect.runPromise(Effect.flip(runCommand(
      parseArgs(["users", "list", "--after", "cursor-1"], commandSpecs),
      fakeGateway({ callOfficialTool: () => Effect.succeed({ users: [], hasNextPage: true, cursor: "cursor-1" }) }),
      "/repo/src/main.ts"
    )))
    expect(repeatedCursorError._tag).toBe("LinearDomainError")
    expect(repeatedCursorError.message).toContain("next cursor to advance beyond --after")
  })

  test("official conflicts metadata rejects contradictory flags before gateway access", async () => {
    const cases = [
      ["documents", "update", "--id", "document-id", "--content", "text", "--clear-content", "--if-updated-at", baseIssue.updatedAt],
      ["projects", "update", "--id", "project-id", "--summary", "text", "--clear-summary"],
      ["projects", "update", "--id", "project-id", "--add-teams-json", "[\"ENG\"]", "--teams-json", "[\"ENG\"]"],
      ["releases", "update", "--id", "release-id", "--start-date", "2026-07-21", "--clear-start-date"],
      ["release-notes", "update", "--id", "note-id", "--releases-json", "[\"release-id\"]", "--range-from", "release-a", "--range-to", "release-b"],
      ["milestones", "update", "--project", "Roadmap", "--id", "Launch", "--target-date", "2026-07-21", "--clear-target-date"],
      ["status-updates", "update", "--type", "project", "--id", "update-id", "--body", "text", "--clear-body", "--if-updated-at", baseIssue.updatedAt]
    ] as const

    for (const argv of cases) {
      let calls = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(
        parseArgs(argv, commandSpecs),
        fakeGateway({ callOfficialTool: () => { calls += 1; return Effect.succeed({}) } }),
        "/repo/src/main.ts"
      )))

      expect(error._tag, argv.join(" ")).toBe("UsageError")
      expect(error.message, argv.join(" ")).toContain("mutually exclusive")
      expect(calls, argv.join(" ")).toBe(0)
    }
  })

  test("official list projections reject rows without any default fields", async () => {
    const cases = [
      ["users", "list"],
      ["cycles", "list", "--team-id", "team-id"]
    ] as const

    for (const argv of cases) {
      const error = await Effect.runPromise(Effect.flip(runCommand(
        parseArgs(argv, commandSpecs),
        fakeGateway({
          callOfficialTool: () => Effect.succeed(argv[0] === "users"
            ? { users: [{ ignored: true }], hasNextPage: false }
            : [{ ignored: true }])
        }),
        "/repo/src/main.ts"
      )))

      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain("output shape drifted")
    }
  })

  test("official mutation preflights reject empty and mismatched entities", async () => {
    for (const value of [{}, { id: "different-project", name: "Other" }]) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "projects", "update", "--id", "project-id", "--state", "started"
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "save_project") saves += 1
          return Effect.succeed(value)
        }
      }), "/repo/src/main.ts")))
      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain("output shape drifted")
      expect(saves).toBe(0)
    }

    let statusSaves = 0
    const statusError = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "status-updates", "update", "--type", "project", "--id", "update-id", "--health", "onTrack"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "save_status_update") statusSaves += 1
        return Effect.succeed({ statusUpdates: [{ id: "different-update", type: "project", health: "offTrack" }] })
      }
    }), "/repo/src/main.ts")))
    expect(statusError._tag).toBe("LinearDomainError")
    expect(statusSaves).toBe(0)
  })

  test("status-update mutation verification requires one exact unpaginated row", async () => {
    const exact = { id: "update-id", type: "project", health: "onTrack" }
    const cases = [
      { value: { statusUpdates: [exact] }, detail: "missing pagination metadata" },
      { value: { statusUpdates: [exact], hasNextPage: true, cursor: "next" }, detail: "paginated results" },
      { value: { statusUpdates: [], hasNextPage: false }, detail: "empty results" },
      { value: { statusUpdates: [exact, { ...exact, id: "other-id" }], hasNextPage: false }, detail: "multiple results" },
      { value: { statusUpdates: ["malformed"], hasNextPage: false }, detail: "malformed row" },
      { value: { statusUpdates: [{ ...exact, id: "other-id" }], hasNextPage: false }, detail: "mismatched identity" }
    ] as const

    for (const entry of cases) {
      let reads = 0
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "status-updates", "update", "--type", "project", "--id", "update-id", "--health", "onTrack"
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "get_status_updates") {
            reads += 1
            return Effect.succeed(reads === 1
              ? { statusUpdates: [{ id: "update-id", type: "project", health: "offTrack" }], hasNextPage: false }
              : entry.value)
          }
          if (name === "save_status_update") {
            saves += 1
            return Effect.succeed({ id: "update-id" })
          }
          throw new Error(`unexpected tool ${name}`)
        }
      }, false), "/repo/src/main.ts")))

      expect(error._tag, entry.detail).toBe("LinearApiError")
      expect(error.message, entry.detail).toContain("could not be verified")
      expect(error.help, entry.detail).toContain("linear-axi status-updates view --type 'project' --id 'update-id' --full")
      expect(error.help, entry.detail).not.toContain("retry")
      expect(saves, entry.detail).toBe(1)
    }
  })

  test("milestone updates canonicalize project and milestone selectors before verification", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    const output = await run([
      "milestones", "update", "--project", "Roadmap", "--id", "Launch", "--target-date", "2026-09-01"
    ], fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_project") return Effect.succeed({ id: "project-id", name: "Roadmap", slugId: "roadmap" })
        if (name === "get_milestone") return Effect.succeed({ id: "milestone-id", name: "Launch", project: { id: "project-id" }, targetDate: "2026-09-01" })
        throw new Error("must not mutate an already satisfied milestone")
      }
    }))

    expect(calls).toEqual([
      { name: "get_project", args: { query: "Roadmap" } },
      { name: "get_milestone", args: { project: "project-id", query: "Launch" } },
      { name: "get_milestone", args: { project: "project-id", query: "milestone-id" } }
    ])
    expect(output).toMatchObject({ changed: false, result: "requested properties already match (no-op)" })
  })

  test("milestone updates require resolved project ownership", async () => {
    for (const project of [undefined, null, { id: "other-project" }]) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "milestones", "update", "--project", "Roadmap", "--id", "Launch", "--target-date", "2026-09-01"
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "get_project") return Effect.succeed({ id: "project-id", name: "Roadmap" })
          if (name === "get_milestone") return Effect.succeed({
            id: "milestone-id",
            name: "Launch",
            ...(project === undefined ? {} : { project }),
            targetDate: "2026-08-01"
          })
          if (name === "save_milestone") saves += 1
          return Effect.succeed({})
        }
      }), "/repo/src/main.ts")))

      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain(project == null ? "output shape drifted" : "belongs to another project")
      expect(saves).toBe(0)
    }
  })

  test("official update commands reject ambiguous parents and send typed arrays", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    let projectReads = 0
    const gateway = fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_project") {
          return Effect.succeed(projectReads++ < 2
            ? { id: "project-id", name: "Roadmap", teams: [], priority: 0 }
            : { id: "project-id", name: "Roadmap", teams: [{ key: "ENG" }, { key: "OPS" }], priority: 2 })
        }
        return Effect.succeed({ id: "project-id", name: "Roadmap" })
      }
    })
    const invalid = parseArgs([
      "documents", "update", "--id", "document-id", "--project", "A", "--team", "ENG"
    ], commandSpecs)
    const error = await Effect.runPromise(Effect.flip(runCommand(invalid, gateway, "/repo/src/main.ts")))
    expect(error._tag).toBe("UsageError")
    expect(calls).toHaveLength(0)

    const output = await run([
      "projects", "update", "--id", "project-id", "--teams-json", "[\"ENG\",\"OPS\"]", "--priority", "2"
    ], gateway)
    expect(output.project).toMatchObject({ id: "project-id", name: "Roadmap", priority: 2 })
    expect(calls).toEqual([
      { name: "get_project", args: { query: "project-id" } },
      { name: "get_project", args: { query: "project-id" } },
      { name: "save_project", args: { id: "project-id", setTeams: ["ENG", "OPS"], priority: 2 } },
      { name: "get_project", args: { query: "project-id" } }
    ])
    expect(output).toMatchObject({ changed: true, result: "official save_project update verified" })
  })

  test("official project updates reject canonical add and remove intersections", async () => {
    const cases = [
      { add: "--add-teams-json", remove: "--remove-teams-json", values: { teams: [{ id: "team-id", key: "ENG" }] } },
      { add: "--add-initiatives-json", remove: "--remove-initiatives-json", values: { initiatives: [{ id: "initiative-id", name: "Growth" }] } }
    ] as const

    for (const entry of cases) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "projects", "update", "--id", "project-id",
        entry.add, JSON.stringify([entry.add.includes("teams") ? "ENG" : "Growth"]),
        entry.remove, JSON.stringify([entry.add.includes("teams") ? "team-id" : "initiative-id"])
      ], commandSpecs), fakeGateway({
        resolveProjectUpdateAssociations: (input) => Effect.succeed({
          teams: input.teams.map(() => "team-id"),
          initiatives: input.initiatives.map(() => "initiative-id")
        }),
        callOfficialTool: (name) => {
          if (name === "save_project") saves += 1
          return Effect.succeed({ id: "project-id", ...entry.values })
        }
      }), "/repo/src/main.ts")))

      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain("both add and remove")
      expect(saves).toBe(0)
    }
  })

  test("project updates resolve archived associations only for removal", async () => {
    const resolutions: Array<{ readonly teams: ReadonlyArray<string>; readonly initiatives: ReadonlyArray<string>; readonly includeArchived: boolean }> = []
    let reads = 0
    const output = await run([
      "projects", "update", "--id", "project-id",
      "--add-teams-json", '["ENG"]', "--remove-teams-json", '["OLD"]',
      "--add-initiatives-json", '["Growth"]', "--remove-initiatives-json", '["Legacy"]'
    ], fakeGateway({
      resolveProjectUpdateAssociations: (input) => {
        resolutions.push(input)
        return Effect.succeed(input.includeArchived
          ? { teams: ["old-team-id"], initiatives: ["legacy-initiative-id"] }
          : { teams: ["team-id"], initiatives: ["initiative-id"] })
      },
      callOfficialTool: (name) => {
        if (name === "save_project") return Effect.succeed({ id: "project-id" })
        reads += 1
        return Effect.succeed({
          id: "project-id",
          teams: reads <= 2 ? [{ id: "old-team-id" }] : [{ id: "team-id" }],
          initiatives: reads <= 2 ? [{ id: "legacy-initiative-id" }] : [{ id: "initiative-id" }]
        })
      }
    }))

    expect(resolutions).toEqual([
      { teams: ["ENG"], initiatives: ["Growth"], includeArchived: false },
      { teams: ["OLD"], initiatives: ["Legacy"], includeArchived: true }
    ])
    expect(output).toMatchObject({ changed: true })
  })

  test("official project lead updates prove me against the active authenticated viewer", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    let authCalls = 0
    const output = await run(["projects", "update", "--id", "project-id", "--lead", "me"], fakeGateway({
      authStatus: () => {
        authCalls += 1
        return Effect.succeed({ authenticated: true, method: "apiKey", viewer: { id: "user-id", name: "Henrik" } })
      },
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_user") return Effect.succeed({ id: "user-id", name: "Henrik", email: "henrik@example.com", active: true, archivedAt: null })
        if (name === "get_project") return Effect.succeed({ id: "project-id", lead: { id: "user-id", name: "Henrik" } })
        throw new Error("must not save an already satisfied lead")
      }
    }))

    expect(authCalls).toBe(1)
    expect(calls).toEqual([
      { name: "get_project", args: { query: "project-id" } },
      { name: "get_user", args: { query: "me" } },
      { name: "get_project", args: { query: "project-id" } }
    ])
    expect(output).toMatchObject({ changed: false, result: "requested properties already match (no-op)" })
  })

  test("project lead me fails closed on unproven viewer identity before mutation", async () => {
    const cases = [
      {
        name: "missing viewer",
        auth: { authenticated: true, method: "apiKey" as const },
        user: { id: "user-id", active: true, archivedAt: null }
      },
      {
        name: "mismatched viewer",
        auth: { authenticated: true, method: "apiKey" as const, viewer: { id: "viewer-id", name: "Henrik" } },
        user: { id: "other-user-id", active: true, archivedAt: null }
      },
      {
        name: "inactive viewer",
        auth: { authenticated: true, method: "apiKey" as const, viewer: { id: "user-id", name: "Henrik" } },
        user: { id: "user-id", active: false, archivedAt: null }
      },
      {
        name: "malformed viewer response",
        auth: { authenticated: true, method: "apiKey" as const, viewer: { id: "user-id", name: "Henrik" } },
        user: { id: "user-id", archivedAt: null }
      }
    ]

    for (const scenario of cases) {
      let saves = 0
      let authCalls = 0
      let userCalls = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "projects", "update", "--id", "project-id", "--lead", "me"
      ], commandSpecs), fakeGateway({
        authStatus: () => {
          authCalls += 1
          return Effect.succeed(scenario.auth)
        },
        callOfficialTool: (name) => {
          if (name === "get_project") return Effect.succeed({ id: "project-id", lead: null })
          if (name === "get_user") {
            userCalls += 1
            return Effect.succeed(scenario.user)
          }
          if (name === "save_project") saves += 1
          return Effect.succeed({})
        }
      }, false), "/repo/src/main.ts")))

      expect(error._tag, scenario.name).toBe("LinearDomainError")
      expect(authCalls, scenario.name).toBe(1)
      expect(userCalls, scenario.name).toBe(scenario.name === "missing viewer" ? 0 : 1)
      expect(saves, scenario.name).toBe(0)
    }
  })

  test.each([
    { selector: "user-id", user: { id: "user-id", name: "Alex", email: "alex@example.com", active: false, archivedAt: null } },
    { selector: "Alex", user: { id: "user-id", name: "Alex", email: "alex@example.com", archivedAt: null } },
    { selector: "alex@example.com", user: { id: "user-id", name: "Alex", email: "alex@example.com", active: false, archivedAt: null } }
  ])("project lead selector $selector requires an explicitly active user before mutation", async ({ selector, user }) => {
    let saves = 0
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "projects", "update", "--id", "project-id", "--lead", selector
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "get_project") return Effect.succeed({ id: "project-id", lead: null })
        if (name === "get_user") return Effect.succeed(user)
        if (name === "save_project") saves += 1
        return Effect.succeed({})
      }
    }, false), "/repo/src/main.ts")))

    expect(error._tag).toBe("LinearDomainError")
    expect(saves).toBe(0)
  })

  test("official collection verification accepts documented selectors case-insensitively", async () => {
    let saves = 0
    const output = await run(["projects", "update", "--id", "PROJECT-ID", "--teams-json", '["eng"]'], fakeGateway({
      callOfficialTool: (name) => {
        if (name === "save_project") saves += 1
        return Effect.succeed({ id: "project-id", teams: [{ id: "team-id", key: "ENG", name: "Engineering" }] })
      }
    }))

    expect(output).toMatchObject({ changed: false, result: "requested properties already match (no-op)" })
    expect(saves).toBe(0)
  })

  test("official collection verification uses set semantics for selector aliases", async () => {
    let saves = 0
    const output = await run([
      "projects", "update", "--id", "project-id", "--teams-json", '["ENG","eng","team-id"]'
    ], fakeGateway({
      callOfficialTool: (name) => {
        if (name === "save_project") saves += 1
        return Effect.succeed({ id: "project-id", teams: [{ id: "team-id", key: "ENG", name: "Engineering" }] })
      }
    }))

    expect(output).toMatchObject({ changed: false, result: "requested properties already match (no-op)" })
    expect(saves).toBe(0)
  })

  test("official scalar clears require an explicit field readback", async () => {
    let saves = 0
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "projects", "update", "--id", "project-id", "--clear-lead"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "save_project") saves += 1
        return Effect.succeed({ id: "project-id" })
      }
    }), "/repo/src/main.ts")))

    expect(saves).toBe(1)
    expect(error._tag).toBe("LinearApiError")
    expect(error.message).toContain("could not be verified")
    expect(error.help).toContain("linear-axi projects view --query 'project-id' --full")
    expect(error.help).not.toContain("retry")
  })

  test("official exact collection verification requires an explicit array readback", async () => {
    for (const project of [{ id: "project-id" }, { id: "project-id", teams: null }]) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "projects", "update", "--id", "project-id", "--teams-json", "[]"
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "save_project") saves += 1
          return Effect.succeed(project)
        }
      }), "/repo/src/main.ts")))

      expect(saves).toBe(1)
      expect(error._tag).toBe("LinearApiError")
      expect(error.message).toContain("could not be verified")
      expect(error.help).not.toContain("retry")
    }
  })

  test("official removal verification requires an explicit valid collection readback", async () => {
    for (const project of [{ id: "project-id" }, { id: "project-id", teams: [{}] }, { id: "project-id", teams: ["ENG"] }]) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "projects", "update", "--id", "project-id", "--remove-teams-json", '["ENG"]'
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "save_project") saves += 1
          return Effect.succeed(project)
        }
      }), "/repo/src/main.ts")))

      expect(saves).toBe(1)
      expect(error._tag).toBe("LinearApiError")
      expect(error.message).toContain("could not be verified")
      expect(error.help).not.toContain("retry")
    }
  })

  test("official removals require canonical identities on readbacks", async () => {
    for (const teams of [[{ key: "ENG", name: "Engineering" }], ["ENG"]]) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "projects", "update", "--id", "project-id", "--remove-teams-json", '["ENG"]'
      ], commandSpecs), fakeGateway({
        resolveProjectUpdateAssociations: () => Effect.succeed({ teams: ["team-id"], initiatives: [] }),
        callOfficialTool: (name) => {
          if (name === "save_project") saves += 1
          return Effect.succeed({ id: "project-id", teams })
        }
      }), "/repo/src/main.ts")))

      expect(saves).toBe(1)
      expect(error._tag).toBe("LinearApiError")
      expect(error.message).toContain("could not be verified")
      expect(error.help).not.toContain("retry")
    }
  })

  test("official literal casing changes mutate and use read-only truncation recovery", async () => {
    let reads = 0
    let saves = 0
    const output = await run([
      "documents", "update", "--id", "document-id", "--title", "Launch"
    ], fakeGateway({
      callOfficialTool: (name) => {
        if (name === "save_document") {
          saves += 1
          return Effect.succeed({ id: "document-id" })
        }
        if (name === "get_document") {
          reads += 1
          return Effect.succeed(reads === 1
            ? { id: "document-id", title: "launch" }
            : { id: "document-id", title: "Launch", content: "x".repeat(1300) })
        }
        throw new Error(`unexpected tool ${name}`)
      }
    }))

    expect(saves).toBe(1)
    expect(output).toMatchObject({ changed: true, result: "official save_document update verified" })
    expect(output.help).toEqual(["Run `linear-axi documents view --id 'document-id' --full` for complete text fields."])
  })

  test("official rich-text updates require a current timestamp before I/O", async () => {
    const cases = [
      ["documents", "update", "--id", "document-id", "--content", "new"],
      ["documents", "update", "--id", "document-id", "--clear-content"],
      ["projects", "update", "--id", "project-id", "--description", "new"],
      ["releases", "update", "--id", "release-id", "--description", "new"],
      ["release-notes", "update", "--id", "note-id", "--content", "new"],
      ["milestones", "update", "--project", "project-id", "--id", "milestone-id", "--description", "new"],
      ["status-updates", "update", "--type", "project", "--id", "update-id", "--body", "new"]
    ] as const

    for (const argv of cases) {
      let calls = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(
        parseArgs(argv, commandSpecs),
        fakeGateway({ callOfficialTool: () => { calls += 1; return Effect.succeed({}) } }),
        "/repo/src/main.ts"
      )))
      expect(error._tag).toBe("UsageError")
      expect(error.message).toContain("--if-updated-at")
      expect(calls).toBe(0)
    }
  })

  test("official rich-text updates reject stale preconditions before save", async () => {
    let saves = 0
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "documents", "update", "--id", "document-id", "--content", "new",
      "--if-updated-at", "2026-07-07T00:00:00.000Z"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "save_document") saves += 1
        return Effect.succeed({ id: "document-id", content: "old", updatedAt: baseIssue.updatedAt })
      }
    }), "/repo/src/main.ts")))

    expect(error._tag).toBe("LinearDomainError")
    expect(error.message).toContain("known-stale")
    expect(error.help).toContain("linear-axi documents view --id 'document-id' --full")
    expect(saves).toBe(0)
  })

  test("official string clear flags send and verify explicit empty strings", async () => {
    const cases = [
      { argv: ["documents", "update", "--id", "document-id", "--clear-content", "--if-updated-at", baseIssue.updatedAt], tool: "save_document", read: "get_document", id: "document-id", fields: { content: "" } },
      { argv: ["projects", "update", "--id", "Roadmap", "--clear-summary", "--clear-description", "--if-updated-at", baseIssue.updatedAt], tool: "save_project", read: "get_project", id: "project-id", fields: { summary: "", description: "" } },
      { argv: ["releases", "update", "--id", "release-id", "--clear-description", "--if-updated-at", baseIssue.updatedAt], tool: "save_release", read: "get_release", id: "release-id", fields: { description: "" } },
      { argv: ["release-notes", "update", "--id", "note-id", "--clear-content", "--if-updated-at", baseIssue.updatedAt], tool: "save_release_note", read: "get_release_note", id: "note-id", fields: { content: "" } },
      { argv: ["milestones", "update", "--project", "Roadmap", "--id", "Launch", "--clear-description", "--if-updated-at", baseIssue.updatedAt], tool: "save_milestone", read: "get_milestone", id: "milestone-id", fields: { description: "" } },
      { argv: ["status-updates", "update", "--type", "project", "--id", "update-id", "--clear-body", "--if-updated-at", baseIssue.updatedAt], tool: "save_status_update", read: "get_status_updates", id: "update-id", fields: { body: "" } }
    ] as const

    for (const entry of cases) {
      let saved: Readonly<Record<string, unknown>> | undefined
      let entityReads = 0
      const output = await run(entry.argv, fakeGateway({
        callOfficialTool: (name, args) => {
          if (name === "get_project" && entry.tool === "save_milestone") {
            return Effect.succeed({ id: "project-id", name: "Roadmap" })
          }
          if (name === entry.tool) {
            saved = args
            return Effect.succeed({ id: entry.id })
          }
          if (name === entry.read) {
            entityReads += 1
            const cleared = entry.tool === "save_project" ? entityReads >= 3
              : entry.tool === "save_milestone" ? entityReads >= 3
                : entityReads >= 2
            const entity = {
              id: entry.id,
              ...(entry.tool === "save_project" ? { name: "Roadmap" } : {}),
              ...(entry.tool === "save_milestone" ? { name: "Launch", project: { id: "project-id" } } : {}),
              updatedAt: cleared ? "2026-07-08T00:01:00.000Z" : baseIssue.updatedAt,
              ...Object.fromEntries(Object.keys(entry.fields).map((key) => [key, cleared ? "" : "old"]))
            }
            return Effect.succeed(entry.tool === "save_status_update"
              ? { statusUpdates: [{ ...entity, type: "project" }] }
              : entity)
          }
          throw new Error(`unexpected tool ${name}`)
        }
      }))

      expect(saved).toMatchObject({ id: entry.id, ...entry.fields })
      expect(saved).not.toHaveProperty("ifUpdatedAt")
      expect(output).toMatchObject({ changed: true, concurrency: expect.stringContaining("no atomic compare-and-swap") })
    }
  })

  test("document and release updates canonicalize mutable targets to immutable ids", async () => {
    const cases = [
      { argv: ["documents", "update", "--id", "old-document-slug", "--title", "New"], tool: "save_document", read: "get_document", id: "document-id", slugId: "old-document-slug", field: "title" },
      { argv: ["releases", "update", "--id", "old-release-slug", "--name", "New"], tool: "save_release", read: "get_release", id: "release-id", slugId: "old-release-slug", field: "name" },
      { argv: ["release-notes", "update", "--id", "old-note-slug", "--title", "New"], tool: "save_release_note", read: "get_release_note", id: "note-id", slugId: "old-note-slug", field: "title" }
    ] as const

    for (const entry of cases) {
      const reads: Array<Readonly<Record<string, unknown>>> = []
      let saved: Readonly<Record<string, unknown>> | undefined
      const output = await run(entry.argv, fakeGateway({
        callOfficialTool: (name, args) => {
          if (name === entry.read) {
            reads.push(args)
            return Effect.succeed({
              id: entry.id,
              slugId: reads.length === 1 ? entry.slugId : "renamed-slug",
              [entry.field]: reads.length === 1 ? "Old" : "New"
            })
          }
          if (name === entry.tool) {
            saved = args
            return Effect.succeed({ id: entry.id })
          }
          throw new Error(`unexpected tool ${name}`)
        }
      }))

      expect(reads).toEqual([{ id: entry.slugId }, { id: entry.id }])
      expect(saved).toEqual({ id: entry.id, [entry.field]: "New" })
      expect(output).toMatchObject({ changed: true })
    }
  })

  test("project updates canonicalize mutable selectors to immutable ids", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    let reads = 0
    const output = await run(["projects", "update", "--id", "Roadmap", "--state", "started"], fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_project") {
          reads += 1
          return Effect.succeed({ id: "project-id", name: reads === 1 ? "Roadmap" : "Renamed", state: reads < 3 ? "planned" : "started" })
        }
        return Effect.succeed({ id: "project-id" })
      }
    }))

    expect(calls).toEqual([
      { name: "get_project", args: { query: "Roadmap" } },
      { name: "get_project", args: { query: "project-id" } },
      { name: "save_project", args: { id: "project-id", state: "started" } },
      { name: "get_project", args: { query: "project-id" } }
    ])
    expect(output).toMatchObject({ changed: true })
  })

  test("document updates canonicalize every parent selector before mutation", async () => {
    const cases = [
      {
        argv: ["documents", "update", "--id", "document-id", "--project", "Roadmap"],
        resolvedArgs: { id: "document-id", project: "project-id" },
        before: { id: "document-id", project: null },
        after: { id: "document-id", project: { id: "project-id", name: "Renamed roadmap" } }
      },
      {
        argv: ["documents", "update", "--id", "document-id", "--issue", "ENG-123"],
        resolvedArgs: { id: "document-id", issue: "issue-id" },
        before: { id: "document-id", issue: null },
        after: { id: "document-id", issue: { id: "issue-id", identifier: "ENG-999" } }
      },
      {
        argv: ["documents", "update", "--id", "document-id", "--initiative", "Growth"],
        resolvedArgs: { id: "document-id", initiative: "initiative-id" },
        before: { id: "document-id", initiative: null },
        after: { id: "document-id", initiative: { id: "initiative-id", name: "Renamed growth" } }
      },
      {
        argv: ["documents", "update", "--id", "document-id", "--cycle", "Cycle 7", "--team", "Engineering"],
        resolvedArgs: { id: "document-id", cycle: "cycle-id", team: "team-id" },
        before: { id: "document-id", cycle: null, team: null },
        after: { id: "document-id", cycle: { id: "cycle-id", name: "Renamed cycle" }, team: { id: "team-id", name: "Renamed team" } }
      }
    ] as const

    for (const entry of cases) {
      let reads = 0
      let saved: Readonly<Record<string, unknown>> | undefined
      const output = await run(entry.argv, fakeGateway({
        resolveProjectUpdateAssociations: (input) => Effect.succeed({
          teams: input.teams,
          initiatives: input.initiatives.map(() => "initiative-id")
        }),
        callOfficialTool: (name, args) => {
          if (name === "get_project") return Effect.succeed({ id: "project-id", name: "Roadmap", slugId: "roadmap" })
          if (name === "get_issue") return Effect.succeed({ id: "issue-id", identifier: "ENG-123" })
          if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", name: "Engineering" })
          if (name === "list_cycles") return Effect.succeed([{ id: "cycle-id", name: "Cycle 7", number: 7, team: { id: "team-id" } }])
          if (name === "get_document") return Effect.succeed(reads++ === 0 ? entry.before : entry.after)
          if (name === "save_document") {
            saved = args
            return Effect.succeed({ id: "document-id" })
          }
          throw new Error(`unexpected tool ${name}`)
        }
      }))

      expect(saved).toEqual(entry.resolvedArgs)
      expect(output).toMatchObject({ changed: true })
    }
  })

  test("official mutation associations require explicit active-state metadata", async () => {
    const cases = [
      {
        argv: ["documents", "update", "--id", "document-id", "--project", "Roadmap"],
        associationTool: "get_project",
        association: { id: "project-id", name: "Roadmap" }
      },
      {
        argv: ["documents", "update", "--id", "document-id", "--issue", "ENG-123"],
        associationTool: "get_issue",
        association: { id: "issue-id", identifier: "ENG-123" }
      },
      {
        argv: ["releases", "update", "--id", "release-id", "--pipeline", "Delivery"],
        associationTool: "list_release_pipelines",
        association: { id: "pipeline-id", name: "Delivery" }
      }
    ] as const

    for (const entry of cases) {
      for (const archivedAt of [undefined, "2026-07-01T00:00:00.000Z"] as const) {
        let saves = 0
        const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs(entry.argv, commandSpecs), fakeGateway({
          callOfficialTool: (name) => {
            if (name === "get_document") return Effect.succeed({ id: "document-id", project: null, issue: null })
            if (name === "get_release") return Effect.succeed({ id: "release-id", pipeline: null })
            if (name === "get_project" && entry.associationTool === name) {
              return Effect.succeed({ ...entry.association, ...(archivedAt === undefined ? {} : { archivedAt }) })
            }
            if (name === "get_issue" && entry.associationTool === name) {
              return Effect.succeed({ ...entry.association, ...(archivedAt === undefined ? {} : { archivedAt }) })
            }
            if (name === "list_release_pipelines" && entry.associationTool === name) {
              return Effect.succeed({
                releasePipelines: [{ ...entry.association, ...(archivedAt === undefined ? {} : { archivedAt }) }],
                hasNextPage: false
              })
            }
            if (name.startsWith("save_")) saves += 1
            throw new Error(`unexpected tool ${name} for ${entry.associationTool} archivedAt=${String(archivedAt)}`)
          }
        }, false), "/repo/src/main.ts")))

        expect(error._tag).toBe("LinearDomainError")
        expect(error.message).toContain(archivedAt === undefined ? "output shape drifted" : "archived")
        expect(saves).toBe(0)
      }
    }
  })

  test("bespoke official associations require explicit active-state metadata", async () => {
    const cases = [
      { argv: ["documents", "update", "--id", "document-id", "--cycle", "Cycle 7", "--team", "Engineering"], associationTool: "list_cycles" },
      { argv: ["projects", "update", "--id", "project-id", "--lead", "me"], associationTool: "get_user" },
      { argv: ["milestones", "update", "--project", "Roadmap", "--id", "Launch", "--target-date", "2026-09-01"], associationTool: "get_project" },
      { argv: ["milestones", "update", "--project", "Roadmap", "--id", "Launch", "--target-date", "2026-09-01"], associationTool: "get_milestone" }
    ] as const

    for (const entry of cases) {
      for (const archivedAt of [undefined, "2026-07-01T00:00:00.000Z"] as const) {
        let saves = 0
        const state = archivedAt === undefined ? {} : { archivedAt }
        const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs(entry.argv, commandSpecs), fakeGateway({
          callOfficialTool: (name) => {
            if (name === "get_document") return Effect.succeed({ id: "document-id", cycle: null })
            if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", name: "Engineering", archivedAt: null })
            if (name === "list_cycles") return Effect.succeed([{
              id: "cycle-id",
              name: "Cycle 7",
              team: { id: "team-id" },
              ...(entry.associationTool === name ? state : { archivedAt: null })
            }])
            if (name === "get_user") return Effect.succeed({
              id: "user-id",
              name: "Henrik",
              ...(entry.associationTool === name ? state : { archivedAt: null })
            })
            if (name === "get_project") return Effect.succeed({
              id: "project-id",
              name: "Roadmap",
              lead: null,
              ...(entry.associationTool === name ? state : { archivedAt: null })
            })
            if (name === "get_milestone") return Effect.succeed({
              id: "milestone-id",
              name: "Launch",
              project: { id: "project-id" },
              targetDate: "2026-08-01",
              ...(entry.associationTool === name ? state : { archivedAt: null })
            })
            if (name.startsWith("save_")) {
              saves += 1
              return Effect.succeed({ id: "saved-id" })
            }
            throw new Error(`unexpected tool ${name}`)
          }
        }, false), "/repo/src/main.ts")))

        expect(error._tag).toBe("LinearDomainError")
        expect(error.message).toContain(archivedAt === undefined ? "output shape drifted" : "archived")
        expect(saves).toBe(0)
      }
    }
  })

  test("document cycle verification treats team as transport-only", async () => {
    let documentReads = 0
    let saved: Readonly<Record<string, unknown>> | undefined
    const output = await run([
      "documents", "update", "--id", "document-slug", "--cycle", "Cycle 7", "--team", "Engineering"
    ], fakeGateway({
      callOfficialTool: (name, args) => {
        if (name === "get_document") {
          documentReads += 1
          return Effect.succeed(documentReads === 1
            ? { id: "document-id", slugId: "document-slug", cycle: null }
            : { id: "document-id", slugId: "renamed-slug", cycle: { id: "cycle-id" } })
        }
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", name: "Engineering" })
        if (name === "list_cycles") return Effect.succeed([{ id: "cycle-id", name: "Cycle 7", team: { id: "team-id" } }])
        if (name === "save_document") {
          saved = args
          return Effect.succeed({ id: "document-id" })
        }
        throw new Error(`unexpected tool ${name}`)
      }
    }))

    expect(saved).toEqual({ id: "document-id", cycle: "cycle-id", team: "team-id" })
    expect(output).toMatchObject({ changed: true })
  })

  test("release updates canonicalize pipeline and scoped stage selectors", async () => {
    let reads = 0
    let saved: Readonly<Record<string, unknown>> | undefined
    const output = await run([
      "releases", "update", "--id", "release-id", "--pipeline", "Delivery", "--stage", "started"
    ], fakeGateway({
      callOfficialTool: (name, args) => {
        if (name === "list_release_pipelines") {
          return Effect.succeed({
            releasePipelines: [{
              id: "pipeline-id",
              name: "Delivery",
              slugId: "delivery",
              archivedAt: null,
              stages: [{ id: "stage-id", name: "In progress", type: "started" }]
            }],
            hasNextPage: false
          })
        }
        if (name === "get_release") return Effect.succeed(reads++ === 0
          ? { id: "release-id", pipeline: null, stage: null }
          : { id: "release-id", pipeline: { id: "pipeline-id", name: "Renamed delivery" }, stage: { id: "stage-id", name: "Renamed stage" } })
        if (name === "save_release") {
          saved = args
          return Effect.succeed({ id: "release-id" })
        }
        throw new Error(`unexpected tool ${name}`)
      }
    }))

    expect(saved).toEqual({ id: "release-id", pipeline: "pipeline-id", stage: "stage-id" })
    expect(output).toMatchObject({ changed: true })
  })

  test("release-note updates canonicalize pipeline and release selectors", async () => {
    let reads = 0
    let saved: Readonly<Record<string, unknown>> | undefined
    const output = await run([
      "release-notes", "update", "--id", "note-id", "--pipeline", "Delivery", "--releases-json", "[\"v2\"]"
    ], fakeGateway({
      callOfficialTool: (name, args) => {
        if (name === "list_release_pipelines") {
          return Effect.succeed({ releasePipelines: [{ id: "pipeline-id", name: "Delivery", slugId: "delivery" }], hasNextPage: false })
        }
        if (name === "list_releases") {
          return Effect.succeed({ releases: [{ id: "release-id", slugId: "v2", pipeline: { id: "pipeline-id" } }], hasNextPage: false })
        }
        if (name === "get_release_note" && args.includeReleases !== true) {
          return Effect.succeed({ id: "note-id", pipeline: null })
        }
        if (name === "get_release_note") return Effect.succeed(reads++ === 0
          ? { id: "note-id", pipeline: null, releases: [] }
          : { id: "note-id", pipeline: { id: "pipeline-id", name: "Renamed delivery" }, releases: [{ id: "release-id", slugId: "renamed-v2" }] })
        if (name === "save_release_note") {
          saved = args
          return Effect.succeed({ id: "note-id" })
        }
        throw new Error(`unexpected tool ${name}`)
      }
    }))

    expect(saved).toEqual({ id: "note-id", pipeline: "pipeline-id", releases: ["release-id"] })
    expect(output).toMatchObject({ changed: true })
  })

  test("release-note selectors use cached targeted pagination and direct immutable reads", async () => {
    const releaseQueries: Array<Readonly<Record<string, unknown>>> = []
    const releaseReads: Array<Readonly<Record<string, unknown>>> = []
    const saves: Array<Readonly<Record<string, unknown>>> = []
    const stableReleaseId = "22222222-2222-4222-8222-222222222222"
    let verificationReads = 0
    const output = await run([
      "release-notes", "update", "--id", "note-id", "--pipeline", "Delivery",
      "--releases-json", `["v1","V1","${stableReleaseId}"]`
    ], fakeGateway({
      callOfficialTool: (name, args) => {
        if (name === "list_release_pipelines") {
          return Effect.succeed({ releasePipelines: [{ id: "pipeline-id", name: "Delivery" }], hasNextPage: false })
        }
        if (name === "get_release") {
          releaseReads.push(args)
          return Effect.succeed({ id: stableReleaseId, slugId: "v2", pipeline: { id: "pipeline-id" } })
        }
        if (name === "list_releases") {
          releaseQueries.push(args)
          return Effect.succeed(args.cursor === undefined
            ? {
                releases: [{ id: "release-1", slugId: "v1", pipeline: { id: "pipeline-id" } }],
                hasNextPage: true,
                cursor: "next-v1"
              }
            : {
                releases: [{ id: "unrelated-release", slugId: "other", pipeline: { id: "pipeline-id" } }],
                hasNextPage: false
              })
        }
        if (name === "get_release_note") {
          return Effect.succeed({
            id: "note-id",
            pipeline: { id: "pipeline-id" },
            ...(args.includeReleases === true
              ? { releases: verificationReads++ === 0 ? [] : [{ id: "release-1" }, { id: stableReleaseId }] }
              : {})
          })
        }
        if (name === "save_release_note") {
          saves.push(args)
          return Effect.succeed({ id: "note-id" })
        }
        throw new Error(`unexpected tool ${name}`)
      }
    }))

    expect(releaseQueries).toEqual([
      { query: "v1", limit: 250, pipeline: "pipeline-id", includeArchived: true },
      { query: "v1", limit: 250, pipeline: "pipeline-id", includeArchived: true, cursor: "next-v1" }
    ])
    expect(releaseReads).toEqual([{ id: stableReleaseId }])
    expect(saves).toEqual([{ id: "note-id", pipeline: "pipeline-id", releases: ["release-1", stableReleaseId] }])
    expect(output).toMatchObject({ changed: true })
  })

  test("release-note alias resolution detects ambiguity across targeted pages", async () => {
    let saves = 0
    const releaseQueries: Array<Readonly<Record<string, unknown>>> = []
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "release-notes", "update", "--id", "note-id", "--pipeline", "Delivery", "--releases-json", "[\"v1\"]"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name, args) => {
        if (name === "list_release_pipelines") {
          return Effect.succeed({ releasePipelines: [{ id: "pipeline-id", name: "Delivery" }], hasNextPage: false })
        }
        if (name === "list_releases") {
          releaseQueries.push(args)
          return Effect.succeed(args.cursor === undefined
            ? {
                releases: [{ id: "release-a", slugId: "v1", pipeline: { id: "pipeline-id" } }],
                hasNextPage: true,
                cursor: "next"
              }
            : {
                releases: [{ id: "release-b", slugId: "v1", pipeline: { id: "pipeline-id" } }],
                hasNextPage: false
              })
        }
        if (name === "save_release_note") saves += 1
        return Effect.succeed({ id: "note-id" })
      }
    }), "/repo/src/main.ts")))

    expect(error.message).toContain("Ambiguous release selector v1")
    expect(error.help).toContain("release-a, release-b")
    expect(releaseQueries).toEqual([
      { query: "v1", limit: 250, pipeline: "pipeline-id", includeArchived: true },
      { query: "v1", limit: 250, pipeline: "pipeline-id", includeArchived: true, cursor: "next" }
    ])
    expect(saves).toBe(0)
  })

  test("project labels and status-update parents canonicalize to immutable ids", async () => {
    let projectReads = 0
    let statusReads = 0
    const saves: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    const gateway = fakeGateway({
      callOfficialTool: (name, args) => {
        if (name === "list_project_labels") {
          return Effect.succeed({ labels: [{ id: "label-id", name: "Platform" }], hasNextPage: false })
        }
        if (name === "get_project") return Effect.succeed(projectReads++ < 2
          ? { id: "project-id", name: "Roadmap", labels: [] }
          : { id: "project-id", name: "Roadmap", labels: [{ id: "label-id", name: "Renamed platform" }] })
        if (name === "get_status_updates") return Effect.succeed({ statusUpdates: [statusReads++ === 0
          ? { id: "update-id", type: "project", project: null }
          : { id: "update-id", type: "project", project: { id: "project-id", name: "Renamed roadmap" } }] })
        if (name.startsWith("save_")) {
          saves.push({ name, args })
          return Effect.succeed({ id: String(args.id) })
        }
        throw new Error(`unexpected tool ${name}`)
      }
    })

    await run(["projects", "update", "--id", "project-id", "--labels-json", "[\"Platform\"]"], gateway)
    await run(["status-updates", "update", "--type", "project", "--id", "update-id", "--project", "Roadmap"], gateway)

    expect(saves).toEqual([
      { name: "save_project", args: { id: "project-id", labels: ["label-id"] } },
      { name: "save_status_update", args: { type: "project", id: "update-id", project: "project-id" } }
    ])
  })

  test("association canonicalization fails closed for empty, malformed, and ambiguous matches", async () => {
    const cases = [
      { rows: [], message: "No project label exactly matched Platform", candidates: "none" },
      { rows: [{ name: "Platform" }], message: "project label selector Platform matched an entity without an immutable id", candidates: "missing-id" },
      { rows: [{ id: "label-a", name: "Platform" }, { id: "label-b", name: "Platform" }], message: "Ambiguous project label selector Platform", candidates: "label-a, label-b" },
      {
        rows: Array.from({ length: 15 }, (_, index) => ({ id: `label-${String(index + 1).padStart(2, "0")}`, name: "Platform" })),
        message: "Ambiguous project label selector Platform",
        candidates: "showing 10 of 15"
      }
    ] as const

    for (const entry of cases) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "projects", "update", "--id", "project-id", "--labels-json", "[\"Platform\"]"
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "get_project") return Effect.succeed({ id: "project-id", name: "Roadmap" })
          if (name === "list_project_labels") return Effect.succeed({ labels: entry.rows, hasNextPage: false })
          if (name === "save_project") saves += 1
          return Effect.succeed({})
        }
      }), "/repo/src/main.ts")))

      expect(error.message).toContain(entry.message)
      expect(error.help).toContain(entry.candidates)
      expect(error.help).toContain("Narrow with an immutable id or a more specific selector")
      if (entry.rows.length > 10) expect(error.help).not.toContain("label-11")
      expect(saves).toBe(0)
    }
  })

  test("association canonicalization requires explicit scoped ownership", async () => {
    for (const owner of [undefined, { id: "other-team" }]) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "documents", "update", "--id", "document-id", "--cycle", "Cycle 7", "--team", "Engineering"
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "get_document") return Effect.succeed({ id: "document-id", cycle: null })
          if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", name: "Engineering" })
          if (name === "list_cycles") return Effect.succeed([{
            id: "cycle-id",
            name: "Cycle 7",
            ...(owner === undefined ? {} : { team: owner })
          }])
          if (name === "save_document") saves += 1
          return Effect.succeed({})
        }
      }), "/repo/src/main.ts")))

      expect(error.message).toContain(owner === undefined ? "output shape drifted" : "belongs to another team")
      expect(saves).toBe(0)
    }

    for (const owner of [undefined, { id: "other-pipeline" }]) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "release-notes", "update", "--id", "note-id", "--pipeline", "Delivery", "--releases-json", "[\"v2\"]"
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "get_release_note") return Effect.succeed({ id: "note-id", pipeline: { id: "pipeline-id" } })
          if (name === "list_release_pipelines") {
            return Effect.succeed({ releasePipelines: [{ id: "pipeline-id", name: "Delivery" }], hasNextPage: false })
          }
          if (name === "list_releases") return Effect.succeed({
            releases: [{ id: "release-id", slugId: "v2", ...(owner === undefined ? {} : { pipeline: owner }) }],
            hasNextPage: false
          })
          if (name === "save_release_note") saves += 1
          return Effect.succeed({})
        }
      }), "/repo/src/main.ts")))

      expect(error.message).toContain(owner === undefined ? "output shape drifted" : "belongs to another pipeline")
      expect(saves).toBe(0)
    }
  })

  test("official rich-text updates accept Linear-normalized readback", async () => {
    const cases = [
      { argv: ["documents", "update", "--id", "document-id", "--content", "[doc](https://example.com)\r\n", "--if-updated-at", baseIssue.updatedAt], read: "get_document", value: { id: "document-id", content: "[doc](<https://example.com>)", updatedAt: baseIssue.updatedAt } },
      { argv: ["projects", "update", "--id", "project-id", "--description", "[project](https://example.com)\r\n", "--if-updated-at", baseIssue.updatedAt], read: "get_project", value: { id: "project-id", description: "[project](<https://example.com>)", updatedAt: baseIssue.updatedAt } },
      { argv: ["releases", "update", "--id", "release-id", "--description", "[release](https://example.com)\r\n", "--if-updated-at", baseIssue.updatedAt], read: "get_release", value: { id: "release-id", description: "[release](<https://example.com>)", updatedAt: baseIssue.updatedAt } },
      { argv: ["release-notes", "update", "--id", "note-id", "--content", "[note](https://example.com)\r\n", "--if-updated-at", baseIssue.updatedAt], read: "get_release_note", value: { id: "note-id", content: "[note](<https://example.com>)", updatedAt: baseIssue.updatedAt } },
      { argv: ["milestones", "update", "--project", "Roadmap", "--id", "milestone-id", "--description", "[milestone](https://example.com)\r\n", "--if-updated-at", baseIssue.updatedAt], read: "get_milestone", value: { id: "milestone-id", project: { id: "project-id" }, description: "[milestone](<https://example.com>)", updatedAt: baseIssue.updatedAt } },
      { argv: ["status-updates", "update", "--type", "project", "--id", "update-id", "--body", "[status](https://example.com)\r\n", "--if-updated-at", baseIssue.updatedAt], read: "get_status_updates", value: { statusUpdates: [{ id: "update-id", type: "project", body: "[status](<https://example.com>)", updatedAt: baseIssue.updatedAt }] } }
    ] as const

    for (const entry of cases) {
      const calls: Array<string> = []
      const output = await run(entry.argv, fakeGateway({
        callOfficialTool: (name) => {
          calls.push(name)
          if (entry.read === "get_milestone" && name === "get_project") return Effect.succeed({ id: "project-id", name: "Roadmap" })
          if (name !== entry.read) throw new Error("must not repeat an equivalent rich-text mutation")
          return Effect.succeed(entry.value)
        }
      }))
      expect(calls).toEqual(entry.read === "get_milestone"
        ? ["get_project", "get_milestone", "get_milestone"]
        : entry.read === "get_project" ? ["get_project", "get_project"] : [entry.read])
      expect(output).toMatchObject({ changed: false, result: "requested properties already match (no-op)" })
    }
  })

  test("official update verification accepts canonicalized documented reference selectors", async () => {
    const cases = [
      {
        argv: ["documents", "update", "--id", "document-id", "--issue", "ENG-123"],
        responses: {
          get_issue: { id: "issue-id", identifier: "ENG-123" },
          get_document: { id: "document-id", issue: { id: "issue-id", identifier: "RENAMED-123" } }
        }
      },
      {
        argv: ["documents", "update", "--id", "document-id", "--cycle", "7", "--team", "Engineering"],
        responses: {
          get_team: { id: "team-id", key: "ENG", name: "Engineering" },
          list_cycles: [{ id: "cycle-id", number: 7, teamId: "team-id" }],
          get_document: { id: "document-id", cycle: { id: "cycle-id", number: 8 }, team: { id: "team-id", name: "Renamed" } }
        }
      },
      {
        argv: ["releases", "update", "--id", "release-id", "--pipeline", "Delivery", "--stage", "started"],
        responses: {
          list_release_pipelines: {
            releasePipelines: [{ id: "pipeline-id", name: "Delivery", stages: [{ id: "stage-id", name: "In progress", type: "started" }] }],
            hasNextPage: false
          },
          get_release: { id: "release-id", pipeline: { id: "pipeline-id", name: "Renamed" }, stage: { id: "stage-id", name: "Renamed" } }
        }
      }
    ] as const

    for (const entry of cases) {
      let saves = 0
      const output = await run(entry.argv, fakeGateway({
        callOfficialTool: (name) => {
          if (name.startsWith("save_")) saves += 1
          const response = entry.responses[name as keyof typeof entry.responses]
          if (response === undefined) throw new Error(`unexpected tool ${name}`)
          return Effect.succeed(response)
        }
      }))
      expect(output).toMatchObject({ changed: false, result: "requested properties already match (no-op)" })
      expect(saves).toBe(0)
    }
  })

  test("official boolean filters expose explicit false aliases and reject conflicts before I/O", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    const gateway = fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        const key = name === "list_release_pipelines" ? "releasePipelines" : name === "list_releases" ? "releases" : name === "list_issues" ? "issues" : undefined
        return Effect.succeed(key ? { [key]: [], hasNextPage: false } : [])
      }
    })

    await run(["release-pipelines", "list", "--no-production"], gateway)
    await run(["releases", "list", "--no-has-release-notes"], gateway)
    await run(["issues", "search", "--no-include-archived"], gateway)
    await run(["diffs", "threads", "--id", "diff-id", "--no-resolved"], gateway)

    expect(calls).toEqual([
      { name: "list_release_pipelines", args: { isProduction: false } },
      { name: "list_releases", args: { hasReleaseNotes: false } },
      { name: "list_issues", args: { includeArchived: false } },
      { name: "get_diff_threads", args: { urlOrId: "diff-id", resolved: false } }
    ])
    const help = commandSpecs.find((spec) => spec.path.join(" ") === "issues search")!.help
    expect(help).toContain("--no-include-archived")

    let conflicts = 0
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "search", "--include-archived", "--no-include-archived"
    ], commandSpecs), fakeGateway({
      callOfficialTool: () => { conflicts += 1; return Effect.succeed({}) }
    }), "/repo/src/main.ts")))
    expect(error._tag).toBe("UsageError")
    expect(error.message).toContain("mutually exclusive")
    expect(conflicts).toBe(0)
  })

  test("official updates reject id-only calls before I/O", async () => {
    let calls = 0
    const parsed = parseArgs(["projects", "update", "--id", "project-id"], commandSpecs)
    const error = await Effect.runPromise(Effect.flip(runCommand(parsed, fakeGateway({
      callOfficialTool: () => { calls += 1; return Effect.succeed({}) }
    }), "/repo/src/main.ts")))
    expect(error._tag).toBe("UsageError")
    expect(calls).toBe(0)
  })

  test("official validators preserve cycle disambiguation and reject invalid typed inputs before I/O", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    let documentReads = 0
    const gateway = fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", name: "Engineering" })
        if (name === "list_cycles") return Effect.succeed([{ id: "cycle-id", name: "Cycle 7", number: 7, team: { key: "ENG" } }])
        if (name === "get_document") return Effect.succeed(documentReads++ === 0
          ? { id: "document-id", cycle: null, team: null }
          : { id: "document-id", cycle: { id: "cycle-id", name: "Cycle 7" }, team: { id: "team-id", name: "Engineering" } })
        if (name === "save_document") return Effect.succeed({ id: "document-id" })
        return Effect.succeed({})
      }
    })
    await run(["documents", "update", "--id", "document-id", "--cycle", "Cycle 7", "--team", "Engineering"], gateway)
    expect(calls[3]).toEqual({ name: "save_document", args: { id: "document-id", cycle: "cycle-id", team: "team-id" } })

    for (const argv of [
      ["comments", "search", "--limit", "10"],
      ["documents", "update", "--id", "document-id", "--color", "red"],
      ["projects", "update", "--id", "project-id", "--target-date", "2026-02-30"],
      ["releases", "update", "--id", "release-id", "--started-at", "tomorrow"]
    ]) {
      const before = calls.length
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs(argv, commandSpecs), gateway, "/repo/src/main.ts")))
      expect(error._tag).toBe("UsageError")
      expect(calls).toHaveLength(before)
    }
    expect(() => parseArgs(["status-updates", "update", "--type", "project", "--id", "update-id", "--diff-hidden"], commandSpecs)).toThrow("unknown flag --diff-hidden")
  })

  test("status-update comment searches allow an omitted type only with an id", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    await run(["comments", "search", "--status-update-id", "update-id"], fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        return Effect.succeed({ comments: [], hasNextPage: false })
      }
    }))
    expect(calls).toEqual([{ name: "list_comments", args: { statusUpdateId: "update-id" } }])

    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "comments", "search", "--project-id", "project-id", "--status-update-type", "project"
    ], commandSpecs), fakeGateway({
      callOfficialTool: () => { throw new Error("must validate before I/O") }
    }), "/repo/src/main.ts")))
    expect(error._tag).toBe("UsageError")
    expect(error.message).toContain("--status-update-type requires --status-update-id")
  })

  test("release-note association updates request associations for readback verification", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    let reads = 0
    const output = await run(["release-notes", "update", "--id", "note-id", "--releases-json", "[\"release-1\"]"], fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_release_note" && args.includeReleases !== true) {
          return Effect.succeed({ id: "note-id", pipeline: { id: "pipeline-id" } })
        }
        if (name === "list_release_pipelines") {
          return Effect.succeed({ releasePipelines: [{ id: "pipeline-id", name: "Delivery" }], hasNextPage: false })
        }
        if (name === "list_releases") {
          return Effect.succeed({ releases: [{ id: "release-1", slugId: "v1", pipeline: { id: "pipeline-id" } }], hasNextPage: false })
        }
        if (name === "get_release_note") {
          return Effect.succeed({ id: "note-id", releases: reads++ === 0 ? [] : [{ id: "release-1" }] })
        }
        return Effect.succeed({ id: "note-id" })
      }
    }))
    expect(calls).toEqual([
      { name: "get_release_note", args: { id: "note-id" } },
      { name: "list_release_pipelines", args: { limit: 250, includeArchived: false } },
      { name: "list_releases", args: { query: "release-1", limit: 250, pipeline: "pipeline-id", includeArchived: true } },
      { name: "get_release_note", args: { id: "note-id", includeReleases: true } },
      { name: "save_release_note", args: { id: "note-id", releases: ["release-1"] } },
      { name: "get_release_note", args: { id: "note-id", includeReleases: true } }
    ])
    expect(output).toMatchObject({ changed: true, result: "official save_release_note update verified" })
  })

  test("release-note range updates include releases in verification and recovery", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "release-notes", "update", "--id", "note-id", "--range-from", "release-1", "--range-to", "release-2"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_release_note" && args.includeReleases !== true) {
          return Effect.succeed({ id: "note-id", pipeline: { id: "pipeline-id" } })
        }
        if (name === "list_release_pipelines") {
          return Effect.succeed({ releasePipelines: [{ id: "pipeline-id", name: "Delivery" }], hasNextPage: false })
        }
        if (name === "list_releases") {
          return Effect.succeed({
            releases: [
              { id: "release-1", slugId: "v1", pipeline: { id: "pipeline-id" } },
              { id: "release-2", slugId: "v2", pipeline: { id: "pipeline-id" } }
            ],
            hasNextPage: false
          })
        }
        if (name === "get_release_note") return Effect.succeed({ id: "note-id", rangeFromRelease: "old-from", rangeToRelease: "old-to", releases: [] })
        return Effect.succeed({ id: "note-id" })
      }
    }), "/repo/src/main.ts")))

    expect(calls.filter(({ name }) => name === "get_release_note")).toEqual([
      { name: "get_release_note", args: { id: "note-id" } },
      { name: "get_release_note", args: { id: "note-id", includeReleases: true } },
      { name: "get_release_note", args: { id: "note-id", includeReleases: true } }
    ])
    expect(error.help).toContain("linear-axi release-notes view --id 'note-id' --releases --full")
  })

  test("ambiguous association updates expose affected fields in inspection commands", async () => {
    const issueError = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "update", "--id", "ENG-123", "--set-releases-json", "[]", "--clear-duplicate"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => Effect.succeed(name === "save_issue"
        ? { id: "issue-id" }
        : {
            id: "issue-id",
            identifier: "ENG-123",
            teamId: "team-id",
            releases: [{ id: "release-id" }],
            relations: { duplicateOf: { id: "duplicate-id" } }
          })
    }), "/repo/src/main.ts")))
    expect(issueError.help).toContain("linear-axi issues inspect --id 'issue-id' --relations --releases --full")

    const noteError = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "release-notes", "update", "--id", "note-id", "--releases-json", "[\"release-1\"]"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name, args) => {
        if (name === "get_release_note" && args.includeReleases !== true) {
          return Effect.succeed({ id: "note-id", pipeline: { id: "pipeline-id" } })
        }
        if (name === "list_release_pipelines") {
          return Effect.succeed({ releasePipelines: [{ id: "pipeline-id", name: "Delivery" }], hasNextPage: false })
        }
        if (name === "list_releases") {
          return Effect.succeed({ releases: [{ id: "release-1", slugId: "v1", pipeline: { id: "pipeline-id" } }], hasNextPage: false })
        }
        return Effect.succeed(name === "save_release_note"
          ? { id: "note-id" }
          : { id: "note-id", releases: [] })
      }
    }), "/repo/src/main.ts")))
    expect(noteError.help).toContain("linear-axi release-notes view --id 'note-id' --releases --full")
  })

  test("verification failures provide exact tool-specific inspection commands", async () => {
    const cases = [
      { argv: ["documents", "update", "--id", "document-id", "--title", "New"], read: "get_document", before: { id: "document-id", title: "Old" }, help: "linear-axi documents view --id 'document-id' --full" },
      { argv: ["projects", "update", "--id", "Roadmap", "--state", "started"], read: "get_project", before: { id: "project-id", name: "Roadmap", state: "planned" }, help: "linear-axi projects view --query 'project-id' --full" },
      { argv: ["releases", "update", "--id", "release-id", "--name", "New"], read: "get_release", before: { id: "release-id", name: "Old" }, help: "linear-axi releases view --id 'release-id' --full" },
      { argv: ["release-notes", "update", "--id", "note-id", "--title", "New"], read: "get_release_note", before: { id: "note-id", title: "Old" }, help: "linear-axi release-notes view --id 'note-id' --full" },
      { argv: ["status-updates", "update", "--type", "project", "--id", "update-id", "--health", "onTrack"], read: "get_status_updates", before: { statusUpdates: [{ id: "update-id", type: "project", health: "offTrack" }] }, help: "linear-axi status-updates view --type 'project' --id 'update-id' --full" }
    ] as const

    for (const entry of cases) {
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs(entry.argv, commandSpecs), fakeGateway({
        callOfficialTool: (name) => Effect.succeed(name === entry.read ? entry.before : { id: "ignored" })
      }), "/repo/src/main.ts")))
      expect(error._tag).toBe("LinearApiError")
      expect(error.help).toContain(entry.help)
      expect(error.help).not.toContain("retry")
    }

    const milestoneError = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "milestones", "update", "--project", "Roadmap", "--id", "Launch", "--target-date", "2026-09-01"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "get_project") return Effect.succeed({ id: "project-id", name: "Roadmap" })
        if (name === "get_milestone") return Effect.succeed({ id: "milestone-id", name: "Launch", project: { id: "project-id" }, targetDate: "2026-08-01" })
        return Effect.succeed({})
      }
    }), "/repo/src/main.ts")))
    expect(milestoneError.help).toContain("linear-axi milestones view --project 'project-id' --query 'milestone-id' --full")
  })

  test("official post-save read failures require inspection without replay", async () => {
    let reads = 0
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "projects", "update", "--id", "Roadmap", "--state", "started"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "save_project") return Effect.succeed({ id: "project-id" })
        reads += 1
        if (reads < 3) return Effect.succeed({ id: "project-id", name: "Roadmap", state: "planned" })
        return Effect.fail(new LinearApiError({
          message: "temporary read failure",
          help: "Retry the update."
        }))
      }
    }), "/repo/src/main.ts")))

    expect(error._tag).toBe("LinearApiError")
    expect(error.message).toContain("mutation outcome is unknown")
    expect(error.help).toContain("linear-axi projects view --query 'project-id' --full")
    expect(error.help).not.toContain("Retry")
    expect(error.help).not.toContain("retry")
  })

  test("official detail truncation reports totals and a full escape hatch", async () => {
    const output = await run(["projects", "view", "--query", "Roadmap"], fakeGateway({
      callOfficialTool: () => Effect.succeed({ id: "project-id", name: "Roadmap", description: "x".repeat(1300) })
    }))
    expect(String((output.project as Record<string, unknown>).description)).toEndWith("...")
    expect(output.truncated).toEqual([{ field: "description", total: 1300 }])
    expect(output.help).toEqual(["Run `linear-axi projects view --query 'Roadmap' --full` for complete text fields."])
  })

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

  test("advanced issue create preserves the singular label", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    const output = await run([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--label", "Bug", "--if-absent"
    ], fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
        if (name === "list_issue_labels") return Effect.succeed({ labels: [{ id: "label-id", name: "Bug" }], hasNextPage: false })
        if (name === "list_issues") return Effect.succeed({ issues: [], hasNextPage: false })
        if (name === "save_issue") return Effect.succeed({ id: "issue-id" })
        return Effect.succeed({ id: "issue-id", title: "Launch", teamId: "team-id", labels: [{ id: "label-id" }] })
      }
    }))

    expect(calls.find(({ name }) => name === "save_issue")?.args).toMatchObject({ labels: ["label-id"] })
    expect(output).toMatchObject({ changed: true })
  })

  test("advanced issue create rejects drifted selector resolutions before mutation", async () => {
    const cases = [
      { flag: ["--project", "Roadmap"], invalidTool: "get_project", invalidArgs: { query: "Roadmap" }, invalidValue: { id: "other-project", name: "Other" } },
      { flag: ["--parent", "ENG-1"], invalidTool: "get_issue", invalidArgs: { id: "ENG-1" }, invalidValue: { id: "other-issue", identifier: "ENG-2" } },
      { flag: ["--blocks-json", '["ENG-1"]'], invalidTool: "get_issue", invalidArgs: { id: "ENG-1" }, invalidValue: { id: "other-issue", identifier: "ENG-2" } },
      { flag: ["--project", "Roadmap", "--milestone", "Launch"], invalidTool: "get_milestone", invalidArgs: { project: "project-id", query: "Launch" }, invalidValue: { id: "other-milestone", name: "Other" } },
      { flag: ["--delegate", "Linear"], invalidTool: "get_user", invalidArgs: { query: "Linear" }, invalidValue: { id: "other-user", name: "Not Linear" } }
    ] as const

    for (const entry of cases) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "issues", "create", "--team", "ENG", "--title", "Launch", "--if-absent", ...entry.flag
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name, args) => {
          if (name === "save_issue") saves += 1
          if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", name: "Engineering" })
          if (name === "get_project") {
            return Effect.succeed(entry.invalidTool === name ? entry.invalidValue : { id: "project-id", name: "Roadmap", slugId: "roadmap" })
          }
          if (name === entry.invalidTool && JSON.stringify(args) === JSON.stringify(entry.invalidArgs)) return Effect.succeed(entry.invalidValue)
          throw new Error(`unexpected ${name}`)
        }
      }), "/repo/src/main.ts")))

      expect(error._tag).toBe("LinearDomainError")
      expect(saves).toBe(0)
    }

    let teamSaves = 0
    const teamError = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--priority", "2", "--if-absent"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "save_issue") teamSaves += 1
        if (name === "get_team") return Effect.succeed({ id: "ops-team", key: "OPS", name: "Operations" })
        throw new Error(`unexpected ${name}`)
      }
    }), "/repo/src/main.ts")))
    expect(teamError._tag).toBe("LinearDomainError")
    expect(teamSaves).toBe(0)

    let assigneeSaves = 0
    const assigneeError = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--assignee", "alice@example.com", "--if-absent"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "save_issue") assigneeSaves += 1
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
        if (name === "list_users") return Effect.succeed({ users: [{ email: "alice@example.com", name: "Alice" }], hasNextPage: false })
        throw new Error(`unexpected ${name}`)
      }
    }), "/repo/src/main.ts")))
    expect(assigneeError._tag).toBe("LinearDomainError")
    expect(assigneeSaves).toBe(0)
  })

  test("advanced issue assignee ambiguity caps candidate ids", async () => {
    const users = Array.from({ length: 15 }, (_, index) => ({
      id: `user-${String(index + 1).padStart(2, "0")}`,
      name: "Alex",
      active: true,
      isAssignable: true,
      archivedAt: null
    }))
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--assignee", "Alex", "--if-absent"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", archivedAt: null })
        if (name === "list_users") return Effect.succeed({ users, hasNextPage: false })
        throw new Error(`unexpected ${name}`)
      }
    }), "/repo/src/main.ts")))

    expect(error.message).toContain("Ambiguous or invalid Linear user selector Alex")
    expect(error.help).toContain("showing 10 of 15")
    expect(error.help).toContain("user-10")
    expect(error.help).not.toContain("user-11")
    expect(error.help).toContain("Narrow with an immutable id")
  })

  test("advanced issue assignees must be active, unarchived, and assignable", async () => {
    const selectors = ["55555555-5555-4555-8555-555555555555", "alice@example.com"] as const
    const invalidUsers = [
      { active: false, isAssignable: true, archivedAt: null },
      { active: true, isAssignable: false, archivedAt: null },
      { active: true, isAssignable: true, archivedAt: "2026-07-01T00:00:00.000Z" }
    ] as const

    for (const selector of selectors) {
      for (const invalid of invalidUsers) {
        let saves = 0
        const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
          "issues", "create", "--team", "ENG", "--title", "Launch", "--assignee", selector, "--if-absent"
        ], commandSpecs), fakeGateway({
          callOfficialTool: (name) => {
            if (name === "save_issue") saves += 1
            if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
            const user = { id: "55555555-5555-4555-8555-555555555555", name: "Alice", email: "alice@example.com", ...invalid }
            if (name === "get_user") return Effect.succeed(user)
            if (name === "list_users") return Effect.succeed({ users: [user], hasNextPage: false })
            throw new Error(`unexpected ${name}`)
          }
        }), "/repo/src/main.ts")))

        expect(error._tag).toBe("LinearDomainError")
        expect(error.message).toContain("cannot be assigned")
        expect(saves).toBe(0)
      }
    }
  })

  test("advanced issue exact-create preflight fails closed on malformed rows", async () => {
    const malformed = [
      { title: "Launch", teamId: "team-id" },
      { id: "candidate-id", teamId: "team-id" },
      { id: "candidate-id", title: "Launch" },
      { id: "candidate-id", title: "Launch", team: { id: "other-team", key: "ENG" } }
    ]

    for (const candidate of malformed) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "issues", "create", "--team", "ENG", "--title", "Launch", "--priority", "2", "--if-absent"
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", name: "Engineering" })
          if (name === "list_issues") return Effect.succeed({ issues: [candidate], hasNextPage: false })
          if (name === "save_issue") saves += 1
          return Effect.succeed({})
        }
      }), "/repo/src/main.ts")))

      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain("output shape drifted")
      expect(saves).toBe(0)
    }
  })

  test("advanced issue exact-create preflight matches resolved team aliases", async () => {
    let saves = 0
    const output = await run([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--priority", "2", "--if-absent"
    ], fakeGateway({
      callOfficialTool: (name) => {
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", name: "Engineering" })
        if (name === "list_issues") return Effect.succeed({
          issues: [{ id: "candidate-id", title: "Launch", team: { key: "eng" } }],
          hasNextPage: false
        })
        if (name === "get_issue") return Effect.succeed({ id: "candidate-id", title: "Launch", teamId: "team-id", priority: 2 })
        if (name === "save_issue") saves += 1
        return Effect.succeed({})
      }
    }))

    expect(output).toMatchObject({ changed: false, result: "exact issue already exists (no-op)" })
    expect(saves).toBe(0)
  })

  test.each([
    { name: "archived", detail: { id: "candidate-id", title: "Launch", teamId: "team-id", priority: 2, archivedAt: "2026-07-21T00:00:00.000Z" } },
    { name: "missing archived state", detail: { id: "candidate-id", title: "Launch", teamId: "team-id", priority: 2 } }
  ])("advanced issue exact-create revalidates $name detail before no-op", async ({ detail }) => {
    let saves = 0
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--priority", "2", "--if-absent"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", archivedAt: null })
        if (name === "list_issues") return Effect.succeed({
          issues: [{ id: "candidate-id", title: "Launch", teamId: "team-id", archivedAt: null }],
          hasNextPage: false
        })
        if (name === "get_issue") return Effect.succeed(detail)
        if (name === "save_issue") saves += 1
        return Effect.succeed({})
      }
    }, false), "/repo/src/main.ts")))

    expect(error._tag).toBe("LinearDomainError")
    expect(saves).toBe(0)
  })

  test("advanced issue create validates the preflight detail identity", async () => {
    let saves = 0
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--priority", "2", "--if-absent"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
        if (name === "list_issues") return Effect.succeed({ issues: [{ id: "candidate-id", title: "Launch", teamId: "team-id" }], hasNextPage: false })
        if (name === "get_issue") return Effect.succeed({ id: "different-id", title: "Launch", teamId: "team-id", priority: 2 })
        if (name === "save_issue") saves += 1
        return Effect.succeed({})
      }
    }), "/repo/src/main.ts")))

    expect(error._tag).toBe("LinearDomainError")
    expect(saves).toBe(0)
  })

  test("advanced issue create requires a valid response identity and verified readback", async () => {
    for (const saveResult of [{}, { id: "new-id", title: "Launch", teamId: "team-id", priority: 2 }]) {
      let reads = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "issues", "create", "--team", "ENG", "--title", "Launch", "--priority", "2", "--if-absent"
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
          if (name === "list_issues") return Effect.succeed({ issues: [], hasNextPage: false })
          if (name === "save_issue") return Effect.succeed(saveResult)
          if (name === "get_issue") {
            reads += 1
            return Effect.succeed({ id: "new-id", title: "Launch", teamId: "team-id", priority: 1 })
          }
          return Effect.succeed({})
        }
      }), "/repo/src/main.ts")))

      expect(error._tag).toBe("LinearApiError")
      expect(reads).toBe(Object.keys(saveResult).length === 0 ? 0 : 1)
      expect(error.help).toContain(Object.keys(saveResult).length === 0
        ? "linear-axi issues search --team 'team-id' --query 'Launch' --full"
        : "linear-axi issues inspect --id 'new-id' --full")
      expect(error.help).not.toContain("retry")
    }
  })

  test("advanced issue post-save read failures require inspection without replay", async () => {
    let reads = 0
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--priority", "2", "--if-absent"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
        if (name === "list_issues") return Effect.succeed({ issues: [], hasNextPage: false })
        if (name === "save_issue") return Effect.succeed({ id: "new-id" })
        if (name === "get_issue") {
          reads += 1
          return Effect.fail(new LinearApiError({ message: "temporary read failure", help: "Retry the create." }))
        }
        return Effect.succeed({})
      }
    }), "/repo/src/main.ts")))

    expect(reads).toBe(1)
    expect(error._tag).toBe("LinearApiError")
    expect(error.message).toContain("mutation outcome is unknown")
    expect(error.help).toContain("linear-axi issues inspect --id 'new-id' --full")
    expect(error.help).not.toContain("Retry")
    expect(error.help).not.toContain("retry")
  })

  test("advanced issue create preflights exact identity and performs one mutation", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    const gateway = fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", name: "Engineering" })
        if (name === "list_issue_labels") return Effect.succeed({ labels: [{ id: "label-id", name: "Bug" }], hasNextPage: false })
        if (name === "list_issues") return Effect.succeed({ issues: [], hasNextPage: false })
        if (name === "list_users") return Effect.succeed({ users: [{ id: "user-id", email: "alice@example.com", name: "Alice", active: true, isAssignable: true, archivedAt: null }], hasNextPage: false })
        if (name === "save_issue") return Effect.succeed({ id: "issue-id" })
        return Effect.succeed({ id: "issue-id", title: "Launch", teamId: "team-id", assignee: { id: "user-id" }, priority: 2, labels: [{ id: "label-id" }] })
      }
    })
    const output = await run([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--priority", "2",
      "--assignee", "alice@example.com", "--labels-json", "[\"Bug\"]", "--if-absent"
    ], gateway)

    expect(calls).toEqual([
      { name: "get_team", args: { query: "ENG" } },
      { name: "list_users", args: { query: "alice@example.com", limit: 100 } },
      { name: "list_issue_labels", args: { team: "team-id", limit: 250 } },
      { name: "list_issues", args: { query: "Launch", team: "team-id", limit: 100, includeArchived: false } },
      { name: "save_issue", args: { title: "Launch", assignee: "user-id", priority: 2, labels: ["label-id"], team: "team-id" } },
      { name: "get_issue", args: { id: "issue-id" } }
    ])
    expect(output).toMatchObject({ changed: true, result: "issue created through official save_issue" })
  })

  test("advanced issue UUID selectors use scoped reads and reject archived targets", async () => {
    const selectors = {
      team: "33333333-3333-4333-8333-333333333333",
      state: "44444444-4444-4444-8444-444444444444",
      cycle: "55555555-5555-4555-8555-555555555555",
      project: "66666666-6666-4666-8666-666666666666",
      milestone: "77777777-7777-4777-8777-777777777777"
    }
    const cases = [
      { flags: ["--team", selectors.team], archivedTool: "get_team" },
      { flags: ["--team", "ENG", "--state", selectors.state], archivedTool: "list_issue_statuses" },
      { flags: ["--team", "ENG", "--cycle", selectors.cycle], archivedTool: "list_cycles" },
      { flags: ["--team", "ENG", "--project", selectors.project, "--milestone", selectors.milestone], archivedTool: "get_milestone" }
    ] as const

    for (const entry of cases) {
      let saves = 0
      const calls: Array<string> = []
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "issues", "create", "--title", "Launch", "--if-absent", ...entry.flags
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          calls.push(name)
          if (name === "save_issue") saves += 1
          if (name === "get_team") return Effect.succeed({ id: selectors.team, key: "ENG", archivedAt: entry.archivedTool === name ? "2026-07-01T00:00:00.000Z" : null })
          if (name === "get_project") return Effect.succeed({ id: selectors.project, name: "Roadmap", archivedAt: null })
          if (name === "list_issue_statuses") return Effect.succeed([{ id: selectors.state, name: "In Progress", archivedAt: "2026-07-01T00:00:00.000Z" }])
          if (name === "list_cycles") return Effect.succeed([{ id: selectors.cycle, name: "Cycle 1", archivedAt: "2026-07-01T00:00:00.000Z" }])
          if (name === "get_milestone") return Effect.succeed({ id: selectors.milestone, name: "Launch", project: { id: selectors.project }, archivedAt: "2026-07-01T00:00:00.000Z" })
          if (name === "list_issues") return Effect.succeed({ issues: [], hasNextPage: false })
          return Effect.succeed({ id: "issue-id" })
        }
      }), "/repo/src/main.ts")))

      expect(error._tag).toBe("LinearDomainError")
      expect(calls).toContain(entry.archivedTool)
      expect(saves).toBe(0)
    }
  })

  test("advanced issue mutations fail closed when active-state metadata is omitted", async () => {
    const cases = [
      { flags: [], malformedTool: "get_team" },
      { flags: ["--project", "Roadmap"], malformedTool: "get_project" },
      { flags: ["--state", "In Progress"], malformedTool: "list_issue_statuses" },
      { flags: ["--cycle", "Cycle 1"], malformedTool: "list_cycles" },
      { flags: ["--assignee", "Alex"], malformedTool: "list_users" },
      { flags: ["--labels-json", '["Bug"]'], malformedTool: "list_issue_labels" },
      { flags: ["--releases-json", '["v1"]'], malformedTool: "list_releases" },
      { flags: ["--project", "Roadmap", "--milestone", "Launch"], malformedTool: "get_milestone" },
      { flags: [], malformedTool: "list_issues" }
    ] as const

    for (const entry of cases) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "issues", "create", "--team", "ENG", "--title", "Launch", "--if-absent", ...entry.flags
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "save_issue") saves += 1
          if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", ...(entry.malformedTool === name ? {} : { archivedAt: null }) })
          if (name === "get_project") return Effect.succeed({ id: "project-id", name: "Roadmap", ...(entry.malformedTool === name ? {} : { archivedAt: null }) })
          if (name === "list_issue_statuses") return Effect.succeed([{ id: "state-id", name: "In Progress", team: { id: "team-id" }, ...(entry.malformedTool === name ? {} : { archivedAt: null }) }])
          if (name === "list_cycles") return Effect.succeed([{ id: "cycle-id", name: "Cycle 1", team: { id: "team-id" }, ...(entry.malformedTool === name ? {} : { archivedAt: null }) }])
          if (name === "list_users") return Effect.succeed({ users: [{ id: "user-id", name: "Alex", active: true, isAssignable: true, ...(entry.malformedTool === name ? {} : { archivedAt: null }) }], hasNextPage: false })
          if (name === "list_issue_labels") return Effect.succeed({ labels: [{ id: "label-id", name: "Bug", isGroup: false, ...(entry.malformedTool === name ? {} : { archivedAt: null }) }], hasNextPage: false })
          if (name === "get_milestone") return Effect.succeed({ id: "milestone-id", name: "Launch", project: { id: "project-id" }, ...(entry.malformedTool === name ? {} : { archivedAt: null }) })
          if (name === "list_releases") return Effect.succeed({ releases: [{ id: "release-id", version: "v1", ...(entry.malformedTool === name ? {} : { archivedAt: null }) }], hasNextPage: false })
          if (name === "list_issues") return Effect.succeed({
            issues: entry.malformedTool === name ? [{ id: "issue-id", title: "Launch", teamId: "team-id" }] : [],
            hasNextPage: false
          })
          throw new Error(`unexpected ${name}`)
        }
      }, false), "/repo/src/main.ts")))

      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain("output shape drifted")
      expect(saves).toBe(0)
    }

    let saves = 0
    const updateError = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "update", "--id", "ENG-123", "--title", "Renamed"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "get_issue") return Effect.succeed({ id: "issue-id", identifier: "ENG-123", teamId: "team-id", title: "Old" })
        if (name === "save_issue") saves += 1
        throw new Error(`unexpected ${name}`)
      }
    }, false), "/repo/src/main.ts")))
    expect(updateError.message).toContain("output shape drifted")
    expect(saves).toBe(0)
  })

  test("advanced issue mutations reject archived projects by id or name", async () => {
    const projectId = "66666666-6666-4666-8666-666666666666"
    for (const selector of [projectId, "Roadmap"]) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "issues", "create", "--team", "ENG", "--title", "Launch", "--project", selector, "--if-absent"
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", name: "Engineering", archivedAt: null })
          if (name === "get_project") {
            return Effect.succeed({ id: projectId, name: "Roadmap", slugId: "roadmap", archivedAt: "2026-07-01T00:00:00.000Z" })
          }
          if (name === "save_issue") saves += 1
          return Effect.succeed({ issues: [], hasNextPage: false })
        }
      }), "/repo/src/main.ts")))

      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain(`project ${selector} is archived`)
      expect(saves).toBe(0)
    }
  })

  test("advanced state and cycle selectors require resolved team ownership", async () => {
    const cases = [
      { flag: "--state", tool: "list_issue_statuses", row: { id: "state-id", name: "In Progress", archivedAt: null } },
      { flag: "--cycle", tool: "list_cycles", row: { id: "cycle-id", name: "Cycle 1", archivedAt: null } }
    ] as const

    for (const entry of cases) {
      for (const owner of [undefined, null, { id: "other-team" }]) {
        let saves = 0
        const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
          "issues", "create", "--team", "ENG", "--title", "Launch", entry.flag, entry.row.name, "--if-absent"
        ], commandSpecs), fakeGateway({
          callOfficialTool: (name) => {
            if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", name: "Engineering" })
            if (name === entry.tool) return Effect.succeed([{ ...entry.row, ...(owner === undefined ? {} : { team: owner }) }])
            if (name === "save_issue") saves += 1
            return Effect.succeed({ issues: [], hasNextPage: false })
          }
        }), "/repo/src/main.ts")))

        expect(error._tag).toBe("LinearDomainError")
        expect(error.message).toContain(owner == null ? "output shape drifted" : "belongs to another team")
        expect(saves).toBe(0)
      }
    }
  })

  test("advanced state and cycle selectors accept canonical team aliases", async () => {
    const saved: Array<Readonly<Record<string, unknown>>> = []
    const output = await run([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--state", "In Progress",
      "--cycle", "Cycle 1", "--if-absent"
    ], fakeGateway({
      callOfficialTool: (name, args) => {
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", name: "Engineering" })
        if (name === "list_issue_statuses") return Effect.succeed([{
          id: "state-id",
          name: "In Progress",
          team: { key: "eng" },
          archivedAt: null
        }])
        if (name === "list_cycles") return Effect.succeed([{
          id: "cycle-id",
          name: "Cycle 1",
          teamId: "team-id",
          archivedAt: null
        }])
        if (name === "list_issues") return Effect.succeed({ issues: [], hasNextPage: false })
        if (name === "save_issue") {
          saved.push(args)
          return Effect.succeed({ id: "issue-id" })
        }
        return Effect.succeed({
          id: "issue-id",
          title: "Launch",
          teamId: "team-id",
          status: { id: "state-id" },
          cycle: { id: "cycle-id" }
        })
      }
    }))

    expect(saved).toEqual([{
      title: "Launch",
      state: "state-id",
      cycle: "cycle-id",
      team: "team-id"
    }])
    expect(output).toMatchObject({ changed: true })
  })

  test("implicit milestone selectors require resolved project ownership", async () => {
    for (const project of [undefined, null, { id: "other-project" }]) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "issues", "update", "--id", "ENG-1", "--milestone", "Launch"
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "get_issue") return Effect.succeed({
            id: "issue-id",
            identifier: "ENG-1",
            teamId: "team-id",
            project: { id: "project-id", name: "Roadmap" },
            milestone: null
          })
          if (name === "get_project") return Effect.succeed({ id: "project-id", name: "Roadmap" })
          if (name === "get_milestone") return Effect.succeed({
            id: "milestone-id",
            name: "Launch",
            archivedAt: null,
            ...(project === undefined ? {} : { project })
          })
          if (name === "save_issue") saves += 1
          return Effect.succeed({})
        }
      }), "/repo/src/main.ts")))

      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain(project == null ? "output shape drifted" : "belongs to another project")
      expect(saves).toBe(0)
    }
  })

  test("parent-only advanced updates canonicalize UUID, key, and name team references", async () => {
    const references = [
      { teamId: "team-id" },
      { team: { key: "ENG" } },
      { team: { name: "Engineering" } }
    ] as const

    for (const [index, currentTeam] of references.entries()) {
      const parentTeam = references[(index + 1) % references.length]!
      const output = await run(["issues", "update", "--id", "ENG-1", "--parent", "ENG-2"], fakeGateway({
        callOfficialTool: (name, args) => {
          if (name === "get_team") {
            const selector = String(args.query).toLowerCase()
            if (["team-id", "eng", "engineering"].includes(selector)) {
              return Effect.succeed({ id: "team-id", key: "ENG", name: "Engineering", archivedAt: null })
            }
          }
          if (name === "get_issue" && args.id === "ENG-2") {
            return Effect.succeed({ id: "parent-id", identifier: "ENG-2", ...parentTeam, archivedAt: null })
          }
          if (name === "get_issue" && args.id === "ENG-1") {
            return Effect.succeed({
              id: "issue-id",
              identifier: "ENG-1",
              ...currentTeam,
              parentId: "parent-id",
              archivedAt: null
            })
          }
          throw new Error(`unexpected ${name} ${JSON.stringify(args)}`)
        }
      }))

      expect(output).toMatchObject({ changed: false, result: "requested issue properties already match (no-op)" })
    }
  })

  test("advanced issue parent resolution enforces the target team", async () => {
    const cases = [
      ["issues", "create", "--team", "ENG", "--title", "Launch", "--parent", "OPS-1", "--if-absent"],
      ["issues", "update", "--id", "ENG-1", "--parent", "OPS-1"]
    ] as const

    for (const argv of cases) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs(argv, commandSpecs), fakeGateway({
        callOfficialTool: (name, args) => {
          if (name === "save_issue") saves += 1
          if (name === "get_team") {
            return Effect.succeed(args.query === "other-team-id"
              ? { id: "other-team-id", key: "OPS", name: "Operations", archivedAt: null }
              : { id: "team-id", key: "ENG", name: "Engineering", archivedAt: null })
          }
          if (name === "get_issue" && args.id === "ENG-1") {
            return Effect.succeed({ id: "issue-id", identifier: "ENG-1", teamId: "team-id" })
          }
          if (name === "get_issue" && args.id === "OPS-1") {
            return Effect.succeed({ id: "parent-id", identifier: "OPS-1", teamId: "other-team-id" })
          }
          throw new Error(`unexpected ${name}`)
        }
      }), "/repo/src/main.ts")))

      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain("belongs to another team")
      expect(saves).toBe(0)
    }
  })

  test("advanced issue additions reject archived issue targets", async () => {
    const cases = [
      ["--parent", "ENG-2"],
      ["--duplicate-of", "ENG-2"],
      ["--related-to-json", '["ENG-2"]']
    ] as const

    for (const [flag, value] of cases) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "issues", "update", "--id", "ENG-1", flag, value
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name, args) => {
          if (name === "save_issue") saves += 1
          if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", name: "Engineering", archivedAt: null })
          if (name === "get_issue" && args.id === "ENG-2") {
            return Effect.succeed({
              id: "target-id",
              identifier: "ENG-2",
              teamId: "team-id",
              archivedAt: "2026-07-01T00:00:00.000Z"
            })
          }
          return Effect.succeed({
            id: "issue-id",
            identifier: "ENG-1",
            teamId: "team-id",
            parentId: null,
            relations: { duplicateOf: null, relatedTo: [] }
          })
        }
      }), "/repo/src/main.ts")))

      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain("archived")
      expect(saves).toBe(0)
    }
  })

  test("advanced issue removals resolve archived issue targets", async () => {
    let issueReads = 0
    let saves = 0
    const output = await run([
      "issues", "update", "--id", "ENG-1", "--remove-related-to-json", '["ENG-2"]'
    ], fakeGateway({
      callOfficialTool: (name, args) => {
        if (name === "get_issue" && args.id === "ENG-2") {
          return Effect.succeed({
            id: "target-id",
            identifier: "ENG-2",
            archivedAt: "2026-07-01T00:00:00.000Z"
          })
        }
        if (name === "save_issue") {
          saves += 1
          return Effect.succeed({ id: "issue-id" })
        }
        issueReads += 1
        return Effect.succeed({
          id: "issue-id",
          identifier: "ENG-1",
          teamId: "team-id",
          relations: { relatedTo: issueReads === 1 ? [{ id: "target-id" }] : [] }
        })
      }
    }))

    expect(saves).toBe(1)
    expect(output).toMatchObject({ changed: true, result: "requested issue properties saved and verified" })
  })

  test("advanced issue selectors deduplicate aliases by canonical id", async () => {
    const saves: Array<Readonly<Record<string, unknown>>> = []
    const output = await run([
      "issues", "create", "--team", "ENG", "--title", "Launch",
      "--labels-json", '["label-id","Bug"]',
      "--releases-json", '["release-id","v1"]',
      "--blocks-json", '["blocked-id","ENG-2"]',
      "--if-absent"
    ], fakeGateway({
      callOfficialTool: (name, args) => {
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
        if (name === "list_issue_labels") return Effect.succeed({ labels: [{ id: "label-id", name: "Bug" }], hasNextPage: false })
        if (name === "list_releases") return Effect.succeed({ releases: [{ id: "release-id", version: "v1" }], hasNextPage: false })
        if (name === "list_issues") return Effect.succeed({ issues: [], hasNextPage: false })
        if (name === "get_issue" && ["blocked-id", "ENG-2"].includes(String(args.id))) {
          return Effect.succeed({ id: "blocked-id", identifier: "ENG-2" })
        }
        if (name === "save_issue") {
          saves.push(args)
          return Effect.succeed({ id: "issue-id" })
        }
        if (name === "get_issue") {
          return Effect.succeed({
            id: "issue-id",
            title: "Launch",
            teamId: "team-id",
            labels: [{ id: "label-id" }, { id: "label-id" }],
            releases: [{ id: "release-id" }],
            relations: { blocks: [{ id: "blocked-id" }] }
          })
        }
        throw new Error(`unexpected ${name}`)
      }
    }))

    expect(saves).toEqual([{
      title: "Launch",
      labels: ["label-id"],
      setReleases: ["release-id"],
      blocks: ["blocked-id"],
      team: "team-id"
    }])
    expect(output).toMatchObject({ changed: true })
  })

  test("advanced issue updates reject canonical add and remove intersections", async () => {
    const cases = [
      { add: "--add-releases-json", remove: "--remove-releases-json", addSelector: "v1", removeSelector: "release-id", listTool: "list_releases", listResult: { releases: [{ id: "release-id", version: "v1" }], hasNextPage: false } },
      { add: "--blocks-json", remove: "--remove-blocks-json", addSelector: "ENG-2", removeSelector: "blocked-id", listTool: "get_issue", listResult: { id: "blocked-id", identifier: "ENG-2" } },
      { add: "--blocked-by-json", remove: "--remove-blocked-by-json", addSelector: "ENG-2", removeSelector: "blocked-id", listTool: "get_issue", listResult: { id: "blocked-id", identifier: "ENG-2" } },
      { add: "--related-to-json", remove: "--remove-related-to-json", addSelector: "ENG-2", removeSelector: "blocked-id", listTool: "get_issue", listResult: { id: "blocked-id", identifier: "ENG-2" } }
    ] as const

    for (const entry of cases) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "issues", "update", "--id", "ENG-1",
        entry.add, JSON.stringify([entry.addSelector]), entry.remove, JSON.stringify([entry.removeSelector])
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name, args) => {
          if (name === "save_issue") saves += 1
          if (name === entry.listTool && (name !== "get_issue" || args.id !== "ENG-1")) return Effect.succeed(entry.listResult)
          return Effect.succeed({ id: "issue-id", identifier: "ENG-1", teamId: "team-id", releases: [], relations: { blocks: [], blockedBy: [], relatedTo: [] } })
        }
      }), "/repo/src/main.ts")))

      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain("both add and remove")
      expect(saves).toBe(0)
    }
  })

  test("advanced issue updates reject self parent and blockers", async () => {
    for (const flag of ["--parent", "--blocks-json", "--blocked-by-json"] as const) {
      let saves = 0
      const value = flag === "--parent" ? "ENG-1" : '["ENG-1"]'
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "issues", "update", "--id", "ENG-1", flag, value
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "save_issue") saves += 1
          if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", name: "Engineering", archivedAt: null })
          return Effect.succeed({ id: "issue-id", identifier: "ENG-1", teamId: "team-id", relations: { blocks: [], blockedBy: [] } })
        }
      }), "/repo/src/main.ts")))

      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain("itself")
      expect(saves).toBe(0)
    }
  })

  test("advanced issue labels reject label groups before mutation", async () => {
    const cases = [
      ["issues", "create", "--team", "ENG", "--title", "Launch", "--labels-json", '["Platform"]', "--if-absent"],
      ["issues", "update", "--id", "ENG-1", "--labels-json", '["Platform"]']
    ] as const

    for (const argv of cases) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs(argv, commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "save_issue") {
            saves += 1
            return Effect.succeed({ id: "issue-id" })
          }
          if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
          if (name === "list_issue_labels") {
            return Effect.succeed({ labels: [{ id: "group-id", name: "Platform", isGroup: true }], hasNextPage: false })
          }
          if (name === "list_issues") return Effect.succeed({ issues: [], hasNextPage: false })
          return Effect.succeed({
            id: "issue-id",
            identifier: "ENG-1",
            title: "Launch",
            teamId: "team-id",
            labels: [{ id: "group-id" }]
          })
        }
      }), "/repo/src/main.ts")))

      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain("label group")
      expect(saves).toBe(0)
    }
  })

  test("advanced issue labels fail closed when group metadata is omitted or malformed", async () => {
    for (const isGroup of [undefined, "false"] as const) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "issues", "create", "--team", "ENG", "--title", "Launch", "--labels-json", '["Bug"]', "--if-absent"
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", archivedAt: null })
          if (name === "list_issue_labels") {
            return Effect.succeed({
              labels: [{ id: "label-id", name: "Bug", archivedAt: null, ...(isGroup === undefined ? {} : { isGroup }) }],
              hasNextPage: false
            })
          }
          if (name === "list_issues") return Effect.succeed({ issues: [], hasNextPage: false })
          if (name === "save_issue") saves += 1
          throw new Error(`unexpected tool ${name}`)
        }
      }, false), "/repo/src/main.ts")))

      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain("output shape drifted")
      expect(saves).toBe(0)
    }
  })

  test("advanced issue labels share one guarded collection scan", async () => {
    let labelPages = 0
    const output = await run([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--labels-json", '["Bug","Urgent"]', "--if-absent"
    ], fakeGateway({
      callOfficialTool: (name, args) => {
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", archivedAt: null })
        if (name === "list_issue_labels") {
          labelPages += 1
          return args.cursor === undefined
            ? Effect.succeed({ labels: [{ id: "bug-id", name: "Bug", archivedAt: null, isGroup: false }], hasNextPage: true, cursor: "labels-2" })
            : Effect.succeed({ labels: [{ id: "urgent-id", name: "Urgent", archivedAt: null, isGroup: false }], hasNextPage: false })
        }
        if (name === "list_issues") return Effect.succeed({ issues: [], hasNextPage: false })
        if (name === "save_issue") return Effect.succeed({ id: "issue-id" })
        return Effect.succeed({
          id: "issue-id",
          title: "Launch",
          teamId: "team-id",
          labels: [{ id: "bug-id" }, { id: "urgent-id" }]
        })
      }
    }, false))

    expect(labelPages).toBe(2)
    expect(output).toMatchObject({ changed: true })
  })

  test("internal official pagination requires explicit pagination metadata", async () => {
    let saves = 0
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--priority", "2", "--if-absent"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
        if (name === "list_issues") return Effect.succeed({ issues: [] })
        if (name === "save_issue") saves += 1
        return Effect.succeed({})
      }
    }), "/repo/src/main.ts")))

    expect(error._tag).toBe("LinearDomainError")
    expect(error.message).toContain("pagination")
    expect(saves).toBe(0)
  })

  test("internal official pagination rejects blank cursors before advancing", async () => {
    let pages = 0
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--priority", "2", "--if-absent"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
        if (name === "list_issues") {
          pages += 1
          return Effect.succeed({ issues: [], hasNextPage: true, cursor: "   " })
        }
        return Effect.succeed({})
      }
    }), "/repo/src/main.ts")))

    expect(error._tag).toBe("LinearDomainError")
    expect(error.message).toContain("cursor")
    expect(pages).toBe(1)
  })

  test("internal official pagination rejects repeated cursors across every resolver", async () => {
    const cases = [
      { argv: ["issues", "create", "--team", "ENG", "--title", "Launch", "--priority", "2", "--if-absent"], tool: "list_issues" },
      { argv: ["issues", "create", "--team", "ENG", "--title", "Launch", "--assignee", "alice@example.com", "--if-absent"], tool: "list_users" },
      { argv: ["issues", "create", "--team", "ENG", "--title", "Launch", "--labels-json", '["Bug"]', "--if-absent"], tool: "list_issue_labels" },
      { argv: ["issues", "create", "--team", "ENG", "--title", "Launch", "--releases-json", '["v1"]', "--if-absent"], tool: "list_releases" }
    ] as const

    for (const entry of cases) {
      let pages = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs(entry.argv, commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
          if (name === entry.tool) {
            pages += 1
            const key = name === "list_issues" ? "issues" : name === "list_users" ? "users" : name === "list_issue_labels" ? "labels" : "releases"
            return Effect.succeed({ [key]: [], hasNextPage: true, cursor: "same-cursor" })
          }
          return Effect.succeed({})
        }
      }), "/repo/src/main.ts")))
      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain("cursor did not advance")
      expect(pages).toBe(2)
    }
  })

  test("advanced issue create excludes archived title matches from preflight", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    const output = await run([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--priority", "2", "--if-absent"
    ], fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
        if (name === "list_issues") return Effect.succeed({
          issues: [{ id: "archived-id", title: "Launch", teamId: "team-id", archivedAt: "2026-07-01T00:00:00.000Z" }],
          hasNextPage: false
        })
        if (name === "save_issue") return Effect.succeed({ id: "new-id", title: "Launch", teamId: "team-id", priority: 2 })
        if (name === "get_issue") return Effect.succeed({ id: "new-id", title: "Launch", teamId: "team-id", priority: 2 })
        return Effect.succeed({})
      }
    }))

    expect(calls.find(({ name }) => name === "list_issues")?.args).toEqual({ query: "Launch", team: "team-id", limit: 100, includeArchived: false })
    expect(output).toMatchObject({ changed: true, result: "issue created through official save_issue" })
  })

  test("advanced issue exact-create ambiguity caps candidate ids", async () => {
    let saves = 0
    const candidates = Array.from({ length: 15 }, (_, index) => ({
      id: `issue-${String(index + 1).padStart(2, "0")}`,
      title: "Launch",
      teamId: "team-id",
      archivedAt: null
    }))
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--priority", "2", "--if-absent"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", archivedAt: null })
        if (name === "list_issues") return Effect.succeed({ issues: candidates, hasNextPage: false })
        if (name === "save_issue") saves += 1
        throw new Error(`unexpected tool ${name}`)
      }
    }, false), "/repo/src/main.ts")))

    expect(error._tag).toBe("LinearDomainError")
    expect(error.message).toContain("Multiple issues exactly match")
    expect(error.help).toContain("showing 10 of 15")
    expect(error.help).not.toContain("issue-11")
    expect(saves).toBe(0)
  })

  test("advanced issue create retries as an exact no-op", async () => {
    let mutations = 0
    const output = await run([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--priority", "2", "--if-absent"
    ], fakeGateway({
      callOfficialTool: (name) => {
        if (name === "save_issue") mutations += 1
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", name: "Engineering" })
        if (name === "get_issue") return Effect.succeed({ id: "issue-id", title: "Launch", teamId: "team-id", priority: 2, labels: [], relations: {}, releases: [] })
        return Effect.succeed({ issues: [{ id: "issue-id", title: "Launch", teamId: "team-id", priority: 2 }], hasNextPage: false })
      }
    }))
    expect(output).toMatchObject({ changed: false, result: "exact issue already exists (no-op)" })
    expect(mutations).toBe(0)
  })

  test("advanced issue exact-create no-op reads only requested associations", async () => {
    const reads: Array<Readonly<Record<string, unknown>>> = []
    const output = await run([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--priority", "2", "--if-absent"
    ], fakeGateway({
      callOfficialTool: (name, args) => {
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
        if (name === "list_issues") return Effect.succeed({
          issues: [{ id: "issue-id", title: "Launch", teamId: "team-id", priority: 2 }],
          hasNextPage: false
        })
        if (name === "get_issue") {
          reads.push(args)
          return Effect.succeed({ id: "issue-id", title: "Launch", teamId: "team-id", priority: 2 })
        }
        return Effect.succeed({})
      }
    }))

    expect(reads).toEqual([{ id: "issue-id" }])
    expect(output).toMatchObject({ changed: false, result: "exact issue already exists (no-op)" })
    expect(output.omitted).toBeUndefined()
    expect(output.help).toBeUndefined()
  })

  test("advanced issue create retries links and releases as an exact no-op", async () => {
    let saves = 0
    const output = await run([
      "issues", "create", "--team", "ENG", "--title", "Launch",
      "--links-json", '[{"url":"https://example.com/docs","title":"Docs"}]',
      "--releases-json", '["v1.0"]', "--if-absent"
    ], fakeGateway({
      callOfficialTool: (name) => {
        if (name === "save_issue") saves += 1
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
        if (name === "list_releases") return Effect.succeed({ releases: [{ id: "release-id", version: "v1.0" }], hasNextPage: false })
        if (name === "list_issues") return Effect.succeed({ issues: [{ id: "issue-id", title: "Launch", teamId: "team-id" }], hasNextPage: false })
        if (name === "get_issue") return Effect.succeed({
          id: "issue-id",
          title: "Launch",
          teamId: "team-id",
          attachments: [{ url: "https://example.com/docs", title: "Docs" }],
          releases: [{ id: "release-id", version: "v1.0" }]
        })
        return Effect.succeed({})
      }
    }))

    expect(output).toMatchObject({ changed: false, result: "exact issue already exists (no-op)" })
    expect(saves).toBe(0)
  })

  test("issue update retries links and releases without repeating the mutation", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    const output = await run([
      "issues", "update", "--id", "ENG-123",
      "--links-json", '[{"url":"https://example.com/docs","title":"Docs"}]',
      "--add-releases-json", '["v1.0"]'
    ], fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_issue") return Effect.succeed({
          id: "issue-id",
          identifier: "ENG-123",
          teamId: "team-id",
          attachments: [{ url: "https://example.com/docs", title: "Docs" }],
          releases: [{ id: "release-id", version: "v1.0" }]
        })
        if (name === "list_releases") return Effect.succeed({ releases: [{ id: "release-id", version: "v1.0" }], hasNextPage: false })
        throw new Error("must not repeat an already satisfied mutation")
      }
    }))

    expect(calls).toEqual([
      { name: "get_issue", args: { id: "ENG-123", includeReleases: true } },
      { name: "list_releases", args: { query: "v1.0", limit: 250 } }
    ])
    expect(output).toMatchObject({ changed: false, result: "requested issue properties already match (no-op)" })
  })

  test("ambiguous advanced issue create gives association-aware two-step recovery without an id", async () => {
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--blocks-json", "[\"ENG-2\"]",
      "--releases-json", "[\"v1\"]", "--if-absent"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name, args) => {
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
        if (name === "get_issue" && args.id === "ENG-2") return Effect.succeed({ id: "blocked-id", identifier: "ENG-2", teamId: "team-id" })
        if (name === "list_releases") return Effect.succeed({ releases: [{ id: "release-id", version: "v1" }], hasNextPage: false })
        if (name === "list_issues") return Effect.succeed({ issues: [], hasNextPage: false })
        if (name === "save_issue") return Effect.succeed({})
        return Effect.succeed({})
      }
    }), "/repo/src/main.ts")))

    expect(error.help).toContain("linear-axi issues search --team 'team-id' --query 'Launch' --full")
    expect(error.help).toContain("then run `linear-axi issues inspect --id '<candidate-id>' --relations --releases --full`")
    expect(error.help).not.toContain("retry")
  })

  test("advanced issue create preserves association-aware recovery after receiving its id", async () => {
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--blocks-json", "[\"ENG-2\"]",
      "--releases-json", "[\"v1\"]", "--if-absent"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name, args) => {
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
        if (name === "get_issue" && args.id === "ENG-2") return Effect.succeed({ id: "blocked-id", identifier: "ENG-2", teamId: "team-id" })
        if (name === "list_releases") return Effect.succeed({ releases: [{ id: "release-id", version: "v1" }], hasNextPage: false })
        if (name === "list_issues") return Effect.succeed({ issues: [], hasNextPage: false })
        if (name === "save_issue") return Effect.succeed({ id: "new-id" })
        return Effect.succeed({ id: "new-id", title: "Launch", teamId: "team-id", relations: { blocks: [] }, releases: [] })
      }
    }), "/repo/src/main.ts")))

    expect(error.help).toContain("linear-axi issues inspect --id 'new-id' --relations --releases --full")
  })

  test("advanced issue create includes official relation fields in the single mutation", async () => {
    const saves: Array<Readonly<Record<string, unknown>>> = []
    const output = await run([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--blocks-json", "[\"ENG-2\"]",
      "--duplicate-of", "ENG-1", "--if-absent"
    ], fakeGateway({
      callOfficialTool: (name, args) => {
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
        if (name === "get_issue" && args.id === "ENG-2") return Effect.succeed({ id: "blocked-id", identifier: "ENG-2", teamId: "team-id" })
        if (name === "get_issue" && args.id === "ENG-1") return Effect.succeed({ id: "duplicate-id", identifier: "ENG-1", teamId: "team-id" })
        if (name === "get_issue") return Effect.succeed({
          id: "new-id",
          title: "Launch",
          teamId: "team-id",
          relations: { blocks: [{ id: "blocked-id" }], duplicateOf: { id: "duplicate-id" } }
        })
        if (name === "list_issues") return Effect.succeed({ issues: [], hasNextPage: false })
        if (name === "save_issue") {
          saves.push(args)
          return Effect.succeed({ id: "new-id" })
        }
        return Effect.succeed({})
      }
    }))
    expect(saves).toEqual([{ title: "Launch", team: "team-id", blocks: ["blocked-id"], duplicateOf: "duplicate-id" }])
    expect(output).toMatchObject({ changed: true })
  })

  test("issue updates refetch required associations and verify the mutation", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    let reads = 0
    const output = await run([
      "issues", "update", "--id", "eng-123", "--add-releases-json", '["v1"]', "--blocks-json", '["eng-2"]'
    ], fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_issue" && args.id === "eng-123") {
          reads += 1
          return Effect.succeed({ id: "issue-id", identifier: "ENG-123", teamId: "team-id", releases: [], relations: { blocks: [] } })
        }
        if (name === "get_issue" && args.id === "issue-id") {
          reads += 1
          return Effect.succeed({ id: "issue-id", identifier: "RENAMED-123", teamId: "team-id", releases: [{ id: "release-id" }], relations: { blocks: [{ id: "blocked-id", identifier: "ENG-2" }] } })
        }
        if (name === "get_issue") return Effect.succeed({ id: "blocked-id", identifier: "ENG-2", teamId: "team-id" })
        if (name === "list_releases") return Effect.succeed({ releases: [{ id: "release-id", version: "v1" }], hasNextPage: false })
        return Effect.succeed({ id: "issue-id" })
      }
    }))

    expect(calls.filter(({ name }) => name === "get_issue")).toEqual([
      { name: "get_issue", args: { id: "eng-123", includeReleases: true, includeRelations: true } },
      { name: "get_issue", args: { id: "eng-2" } },
      { name: "get_issue", args: { id: "issue-id", includeReleases: true, includeRelations: true } }
    ])
    expect(output).toMatchObject({ changed: true, result: "requested issue properties saved and verified" })
  })

  test("advanced issue updates pin mutation, readback, and recovery to the preflight id", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    let reads = 0
    const output = await run(["issues", "update", "--id", "eng-123", "--title", "Renamed"], fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_issue") {
          reads += 1
          return Effect.succeed({
            id: "issue-id",
            identifier: reads === 1 ? "ENG-123" : "RENAMED-123",
            teamId: "team-id",
            title: reads === 1 ? "Old" : "Renamed"
          })
        }
        return Effect.succeed({ id: "issue-id" })
      }
    }))

    expect(calls).toEqual([
      { name: "get_issue", args: { id: "eng-123" } },
      { name: "save_issue", args: { id: "issue-id", title: "Renamed" } },
      { name: "get_issue", args: { id: "issue-id" } }
    ])
    expect(output).toMatchObject({ changed: true, result: "requested issue properties saved and verified" })
  })

  test("issue literal casing changes are not suppressed as no-ops", async () => {
    let reads = 0
    let saves = 0
    const output = await run([
      "issues", "update", "--id", "ENG-123", "--title", "Launch"
    ], fakeGateway({
      callOfficialTool: (name) => {
        if (name === "save_issue") {
          saves += 1
          return Effect.succeed({ id: "issue-id" })
        }
        if (name === "get_issue") {
          reads += 1
          return Effect.succeed({
            id: "issue-id",
            identifier: "ENG-123",
            teamId: "team-id",
            title: reads === 1 ? "launch" : "Launch"
          })
        }
        throw new Error(`unexpected tool ${name}`)
      }
    }))

    expect(saves).toBe(1)
    expect(output).toMatchObject({ changed: true, result: "requested issue properties saved and verified" })
  })

  test("issue exact collection verification requires an explicit array readback", async () => {
    let saves = 0
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "update", "--id", "ENG-123", "--set-releases-json", "[]"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "save_issue") saves += 1
        return Effect.succeed({ id: "issue-id", identifier: "ENG-123", teamId: "team-id" })
      }
    }), "/repo/src/main.ts")))

    expect(saves).toBe(1)
    expect(error._tag).toBe("LinearApiError")
    expect(error.message).toContain("could not be verified")
    expect(error.help).not.toContain("retry")
  })

  test("issue removals require explicit association and duplicate readbacks", async () => {
    const cases = [
      { flags: ["--remove-releases-json", '["v1"]'], relations: {} },
      { flags: ["--remove-blocks-json", '["ENG-2"]'], relations: {} },
      { flags: ["--remove-blocks-json", '["ENG-2"]'], relations: { blocks: [{}] } },
      { flags: ["--clear-duplicate"], relations: {} }
    ] as const

    for (const entry of cases) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "issues", "update", "--id", "ENG-123", ...entry.flags
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name, args) => {
          if (name === "save_issue") {
            saves += 1
            return Effect.succeed({ id: "issue-id" })
          }
          if (name === "list_releases") return Effect.succeed({ releases: [{ id: "release-id", version: "v1" }], hasNextPage: false })
          if (name === "get_issue" && args.id === "ENG-2") return Effect.succeed({ id: "blocked-id", identifier: "ENG-2" })
          if (name === "get_issue") return Effect.succeed({ id: "issue-id", identifier: "ENG-123", teamId: "team-id", relations: entry.relations })
          return Effect.succeed({})
        }
      }), "/repo/src/main.ts")))

      expect(error._tag).toBe("LinearApiError")
      expect(error.help).not.toContain("retry")
      expect(saves).toBe(1)
    }
  })

  test("issue removals require canonical identities on readbacks", async () => {
    for (const releases of [[{ version: "v1" }], ["v1"]]) {
      let saves = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "issues", "update", "--id", "ENG-123", "--remove-releases-json", '["v1"]'
      ], commandSpecs), fakeGateway({
        callOfficialTool: (name) => {
          if (name === "save_issue") saves += 1
          if (name === "list_releases") return Effect.succeed({ releases: [{ id: "release-id", version: "v1" }], hasNextPage: false })
          return Effect.succeed({
            id: "issue-id",
            identifier: "ENG-123",
            teamId: "team-id",
            releases
          })
        }
      }), "/repo/src/main.ts")))

      expect(saves).toBe(1)
      expect(error._tag).toBe("LinearApiError")
      expect(error.message).toContain("could not be verified")
      expect(error.help).not.toContain("retry")
    }
  })

  test("archived releases resolve only for removal", async () => {
    let reads = 0
    const releaseQueries: Array<Readonly<Record<string, unknown>>> = []
    const saves: Array<Readonly<Record<string, unknown>>> = []
    const output = await run([
      "issues", "update", "--id", "ENG-123", "--remove-releases-json", '["v1"]'
    ], fakeGateway({
      callOfficialTool: (name, args) => {
        if (name === "list_releases") {
          releaseQueries.push(args)
          return Effect.succeed({
            releases: [{ id: "release-id", version: "v1", archivedAt: "2026-07-01T00:00:00.000Z" }],
            hasNextPage: false
          })
        }
        if (name === "save_issue") {
          saves.push(args)
          return Effect.succeed({ id: "issue-id" })
        }
        reads += 1
        return Effect.succeed({
          id: "issue-id",
          identifier: "ENG-123",
          teamId: "team-id",
          releases: reads === 1 ? [{ id: "release-id", version: "v1", archivedAt: "2026-07-01T00:00:00.000Z" }] : []
        })
      }
    }))

    expect(releaseQueries).toEqual([{ query: "v1", limit: 250, includeArchived: true }])
    expect(saves).toEqual([{ id: "issue-id", removeReleases: ["release-id"] }])
    expect(output).toMatchObject({ changed: true })

    let addSaves = 0
    const addError = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--releases-json", '["v1"]', "--if-absent"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", archivedAt: null })
        if (name === "list_releases") return Effect.succeed({
          releases: [{ id: "release-id", version: "v1", archivedAt: "2026-07-01T00:00:00.000Z" }],
          hasNextPage: false
        })
        if (name === "save_issue") addSaves += 1
        return Effect.succeed({})
      }
    }), "/repo/src/main.ts")))

    expect(addError._tag).toBe("LinearDomainError")
    expect(addSaves).toBe(0)
  })

  test("advanced issue updates reject archived targets before mutation", async () => {
    let saves = 0
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "update", "--id", "ENG-123", "--priority", "2"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "save_issue") saves += 1
        return Effect.succeed({
          id: "issue-id",
          identifier: "ENG-123",
          teamId: "team-id",
          archivedAt: "2026-07-01T00:00:00.000Z",
          priority: 2
        })
      }
    }), "/repo/src/main.ts")))

    expect(error._tag).toBe("LinearDomainError")
    expect(error.message).toContain("archived")
    expect(saves).toBe(0)
  })

  test("advanced issue mutations bound detail output and provide a full inspection command", async () => {
    let reads = 0
    const output = await run([
      "issues", "update", "--id", "ENG-123", "--priority", "2"
    ], fakeGateway({
      callOfficialTool: (name) => {
        if (name === "get_issue") {
          reads += 1
          return Effect.succeed({
            id: "issue-id",
            identifier: "ENG-123",
            title: "Launch",
            teamId: "team-id",
            priority: reads === 1 ? 1 : 2,
            description: "x".repeat(1300),
            relations: { blocks: Array.from({ length: 100 }, (_, index) => ({ id: `target-${index}` })) }
          })
        }
        return Effect.succeed({ id: "issue-id" })
      }
    }))

    expect(String((output.issue as Record<string, unknown>).description)).toEndWith("...")
    expect((output.issue as Record<string, unknown>).relations).toBeUndefined()
    expect(output.omitted).toEqual(["relations"])
    expect(output.truncated).toEqual([{ field: "description", total: 1300 }])
    expect(output.help).toEqual(["Run `linear-axi issues inspect --id 'issue-id' --full` for complete issue details."])
  })

  test("issue updates fail closed when readback does not satisfy the request", async () => {
    let reads = 0
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "update", "--id", "ENG-123", "--priority", "2"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "get_issue") {
          reads += 1
          return Effect.succeed({ id: "issue-id", identifier: "ENG-123", teamId: "team-id", priority: 1 })
        }
        return Effect.succeed({ id: "issue-id" })
      }
    }), "/repo/src/main.ts")))

    expect(reads).toBe(2)
    expect(error._tag).toBe("LinearApiError")
    expect(error.help).toContain("linear-axi issues inspect --id 'issue-id' --full")
    expect(error.help).not.toContain("retry")
  })

  test("issue scalar clears require explicit field readback", async () => {
    let saves = 0
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "update", "--id", "ENG-123", "--clear-assignee", "--clear-parent"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "save_issue") saves += 1
        return Effect.succeed({ id: "issue-id", identifier: "ENG-123", teamId: "team-id" })
      }
    }), "/repo/src/main.ts")))

    expect(saves).toBe(1)
    expect(error._tag).toBe("LinearApiError")
    expect(error.message).toContain("could not be verified")
    expect(error.help).not.toContain("retry")
  })

  test("issue update sends explicit clears in one official mutation", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    let reads = 0
    const gateway = fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_issue") {
          reads += 1
          return Effect.succeed({
            id: "issue-id",
            identifier: "ENG-123",
            teamId: "team-id",
            updatedAt: baseIssue.updatedAt,
            ...(reads === 1 ? {} : { title: "Renamed", assignee: null, estimate: null, project: null, cycle: null, parentId: null, labels: [] })
          })
        }
        return Effect.succeed({ id: "issue-id", title: "Renamed" })
      }
    })
    const output = await run([
      "issues", "update", "--id", "ENG-123", "--title", "Renamed", "--clear-assignee",
      "--clear-estimate", "--clear-project", "--clear-cycle", "--clear-parent", "--clear-labels"
    ], gateway)
    expect(calls).toEqual([
      { name: "get_issue", args: { id: "ENG-123" } },
      { name: "save_issue", args: { id: "issue-id", title: "Renamed", assignee: null, estimate: null, project: null, cycle: null, parentId: null, labels: [] } },
      { name: "get_issue", args: { id: "issue-id" } }
    ])
    expect(output).toMatchObject({ changed: true, result: "requested issue properties saved and verified" })
  })

  test("schema-incompatible issue clears use one verified native mutation", async () => {
    let received: unknown
    const output = await run([
      "issues", "update", "--id", "ENG-123", "--clear-due-date", "--clear-milestone"
    ], fakeGateway({
      clearIssueFields: (input) => {
        received = input
        return Effect.succeed(mutation(baseIssue, true, "requested issue fields cleared"))
      }
    }))
    expect(received).toEqual({ id: "ENG-123", dueDate: true, milestone: true })
    expect(output).toMatchObject({ changed: true, result: "requested issue fields cleared" })
  })

  test("issue update avoids an already-satisfied official mutation", async () => {
    let saves = 0
    const output = await run(["issues", "update", "--id", "ENG-123", "--priority", "2"], fakeGateway({
      callOfficialTool: (name) => {
        if (name === "save_issue") saves += 1
        return Effect.succeed({ id: baseIssue.id, identifier: "ENG-123", teamId: "team-id", priority: 2, updatedAt: baseIssue.updatedAt })
      }
    }))
    expect(output).toMatchObject({ changed: false, result: "requested issue properties already match (no-op)" })
    expect(saves).toBe(0)
  })

  test("issue retries accept Linear-normalized descriptions", async () => {
    const calls: Array<string> = []
    const output = await run([
      "issues", "update", "--id", "ENG-123", "--description", "[decision](https://example.com)\r\n",
      "--if-updated-at", baseIssue.updatedAt
    ], fakeGateway({
      callOfficialTool: (name) => {
        calls.push(name)
        if (name !== "get_issue") throw new Error("must not repeat an equivalent description mutation")
        return Effect.succeed({
          id: baseIssue.id,
          identifier: "ENG-123",
          teamId: "team-id",
          updatedAt: baseIssue.updatedAt,
          description: "[decision](<https://example.com>)"
        })
      }
    }))

    expect(calls).toEqual(["get_issue"])
    expect(output).toMatchObject({ changed: false, result: "requested issue properties already match (no-op)" })
  })

  test("issue assignee updates prove me against the active authenticated viewer", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    let authCalls = 0
    const output = await run(["issues", "update", "--id", "ENG-123", "--assignee", "me"], fakeGateway({
      authStatus: () => {
        authCalls += 1
        return Effect.succeed({ authenticated: true, method: "apiKey", viewer: { id: "user-id", name: "Henrik" } })
      },
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_issue") return Effect.succeed({ id: "issue-id", identifier: "ENG-123", teamId: "team-id", assignee: { id: "user-id", name: "Henrik" } })
        if (name === "get_user") return Effect.succeed({ id: "user-id", name: "Henrik", active: true, isAssignable: true, archivedAt: null })
        throw new Error("must not repeat an already satisfied assignee mutation")
      }
    }))

    expect(authCalls).toBe(1)
    expect(calls).toEqual([
      { name: "get_issue", args: { id: "ENG-123" } },
      { name: "get_user", args: { query: "me" } }
    ])
    expect(output).toMatchObject({ changed: false, result: "requested issue properties already match (no-op)" })
  })

  test("issue assignee me fails closed on unproven viewer identity before mutation", async () => {
    const cases = [
      {
        name: "missing viewer",
        auth: { authenticated: true, method: "apiKey" as const },
        user: { id: "user-id", active: true, isAssignable: true, archivedAt: null }
      },
      {
        name: "mismatched viewer",
        auth: { authenticated: true, method: "apiKey" as const, viewer: { id: "viewer-id", name: "Henrik" } },
        user: { id: "other-user-id", active: true, isAssignable: true, archivedAt: null }
      },
      {
        name: "inactive viewer",
        auth: { authenticated: true, method: "apiKey" as const, viewer: { id: "user-id", name: "Henrik" } },
        user: { id: "user-id", active: false, isAssignable: true, archivedAt: null }
      },
      {
        name: "malformed viewer response",
        auth: { authenticated: true, method: "apiKey" as const, viewer: { id: "user-id", name: "Henrik" } },
        user: { id: "user-id", isAssignable: true, archivedAt: null }
      }
    ]

    for (const scenario of cases) {
      let saves = 0
      let authCalls = 0
      let userCalls = 0
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
        "issues", "update", "--id", "ENG-123", "--assignee", "me"
      ], commandSpecs), fakeGateway({
        authStatus: () => {
          authCalls += 1
          return Effect.succeed(scenario.auth)
        },
        callOfficialTool: (name) => {
          if (name === "get_issue") return Effect.succeed({ id: "issue-id", identifier: "ENG-123", teamId: "team-id", assignee: null, archivedAt: null })
          if (name === "get_user") {
            userCalls += 1
            return Effect.succeed(scenario.user)
          }
          if (name === "save_issue") saves += 1
          return Effect.succeed({})
        }
      }, false), "/repo/src/main.ts")))

      expect(error._tag, scenario.name).toBe("LinearDomainError")
      expect(authCalls, scenario.name).toBe(1)
      expect(userCalls, scenario.name).toBe(scenario.name === "missing viewer" ? 0 : 1)
      expect(saves, scenario.name).toBe(0)
    }
  })

  test("clearing an issue project conflicts with setting a milestone before I/O", async () => {
    let calls = 0
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "update", "--id", "ENG-123", "--clear-project", "--milestone", "Launch"
    ], commandSpecs), fakeGateway({
      callOfficialTool: () => {
        calls += 1
        return Effect.succeed({})
      }
    }), "/repo/src/main.ts")))

    expect(error._tag).toBe("UsageError")
    expect(error.message).toContain("--clear-project")
    expect(error.message).toContain("--milestone")
    expect(calls).toBe(0)
  })

  test("issue set and clear conflicts fail before official I/O", async () => {
    let calls = 0
    const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "issues", "update", "--id", "ENG-123", "--assignee", "me", "--clear-assignee"
    ], commandSpecs), fakeGateway({ callOfficialTool: () => { calls += 1; return Effect.succeed({}) } }), "/repo/src/main.ts")))
    expect(error._tag).toBe("UsageError")
    expect(error.message).toContain("mutually exclusive")
    expect(calls).toBe(0)
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
    const updated = await run(["issues", "update", "--id", "ENG-100", "--description-file", file, "--if-updated-at", "2026-07-08T00:00:00.000Z"], gateway)
    expect(calls).toHaveLength(4)
    expect(updated.concurrency).toContain("no atomic compare-and-swap")
  })

  test("assignment accepts official user name and email selectors", async () => {
    const calls: unknown[] = []
    const gateway = fakeGateway({
      assignIssue: (input) => { calls.push(input); return Effect.succeed(mutation(baseIssue)) }
    })

    await run(["issues", "assign", "--id", "ENG-123", "--assignee", "Alice Example"], gateway)
    await run(["issues", "assign", "--id", "ENG-123", "--assignee", "alice@example.com"], gateway)

    expect(calls).toEqual([
      { id: "ENG-123", assignee: "Alice Example", replace: false },
      { id: "ENG-123", assignee: "alice@example.com", replace: false }
    ])
  })

  test("workflow state commands list states and transition by stable selector", async () => {
    const calls: unknown[] = []
    const states = [{
      id: "44444444-4444-4444-8444-444444444444",
      name: "In Progress",
      type: "started",
      color: "#facc15",
      position: 2,
      teamId: detail().teamId
    }]
    const gateway = fakeGateway({
      listWorkflowStates: (input) => { calls.push(input); return Effect.succeed(states) },
      changeIssueState: (input) => { calls.push(input); return Effect.succeed(mutation({ ...baseIssue, state: "In Progress", stateType: "started" })) }
    })

    const listed = await run(["workflow-states", "list", "--team", "ENG"], gateway)
    const changed = await run(["issues", "state", "--id", "ENG-123", "--state", "In Progress"], gateway)

    expect(calls).toEqual([{ team: "ENG" }, { id: "ENG-123", state: "In Progress" }])
    expect(listed).toMatchObject({ count: "1 workflow states shown", states })
    expect(changed).toMatchObject({ changed: true, issue: { state: "In Progress" } })
  })

  test("parent commands make set and clear direction explicit", async () => {
    const calls: unknown[] = []
    const gateway = fakeGateway({
      setIssueParent: (input) => { calls.push(input); return Effect.succeed(mutation(baseIssue)) }
    })

    await run(["issues", "parent", "set", "--id", "ENG-123", "--parent", "ENG-100"], gateway)
    await run(["issues", "parent", "clear", "--id", "ENG-123"], gateway)

    expect(calls).toEqual([
      { id: "ENG-123", parent: "ENG-100" },
      { id: "ENG-123", parent: null }
    ])
  })

  test("labels commands preserve scope, exact fields, and idempotent status", async () => {
    const gateway = fakeGateway({
      listLabels: (input) => {
        expect(input.includeArchived).toBe(true)
        expect(input.fields).toEqual(["id", "name", "color", "parentId"])
        return Effect.succeed(page([{ id: "label-id", name: "wayfinder:task", scope: "workspace", teamId: null, parentId: null, color: "#123456", description: "Task", isGroup: false, archivedAt: null }]))
      }
    })
    const created = await run(["labels", "create", "--workspace", "--name", "wayfinder:task", "--color", "#123456", "--if-absent"])
    const listed = await run(["labels", "list", "--workspace", "--include-archived", "--fields", "id,name,color,parentId"], gateway)
    const applied = await run(["labels", "apply", "--issue", "ENG-123", "--label", "wayfinder:task"])
    expect(created.changed).toBe(true)
    expect(listed.labels).toEqual([{ id: "label-id", name: "wayfinder:task", color: "#123456", parentId: null }])
    expect(applied).toMatchObject({ changed: false, result: "label already applied (no-op)" })
  })

  test("label add, remove, and replace keep mutation intent explicit", async () => {
    const calls: unknown[] = []
    const gateway = fakeGateway({
      removeLabel: (input) => { calls.push(input); return Effect.succeed(mutation(baseIssue)) },
      replaceLabels: (input) => { calls.push(input); return Effect.succeed(mutation(baseIssue)) }
    })

    const added = await run(["labels", "add", "--issue", "ENG-123", "--label", "Bug"], gateway)
    await run(["labels", "remove", "--issue", "ENG-123", "--label", "Bug"], gateway)
    await run(["labels", "replace", "--issue", "ENG-123", "--labels-json", "[\"Bug\",\"Urgent\"]"], gateway)

    expect(added).toMatchObject({ changed: false, result: "label already applied (no-op)" })
    expect(calls).toEqual([
      { issue: "ENG-123", label: "Bug" },
      { issue: "ENG-123", labels: ["Bug", "Urgent"] }
    ])
  })

  test("label replacement rejects malformed JSON before gateway access", async () => {
    let calls = 0
    const gateway = fakeGateway({
      replaceLabels: () => { calls += 1; return Effect.succeed(mutation(baseIssue)) }
    })
    const error = await Effect.runPromise(Effect.flip(runCommand(
      parseArgs(["labels", "replace", "--issue", "ENG-123", "--labels-json", "Bug,Urgent"], commandSpecs),
      gateway,
      "/repo/src/main.ts"
    )))

    expect(error).toBeInstanceOf(UsageError)
    expect(calls).toBe(0)
  })

  test("relations preserve directed blocker and target inputs", async () => {
    const relation = baseRelation
    const gateway = fakeGateway({
      createRelation: (input) => {
        expect(input).toEqual({ issue: "ENG-123", relatedIssue: "ENG-124", type: "blocks", id: undefined })
        return Effect.succeed(mutation(relation))
      }
    })
    const output = await run(["relations", "create", "--issue", "ENG-123", "--related-issue", "ENG-124", "--type", "blocks"], gateway)
    expect(output).toEqual({ relation, changed: true, result: "changed" })
  })

  test("generic relation list preserves explicit filters and output", async () => {
    const relation = { id: "relation-id", type: "blocks" as const, direction: "incoming" as const, identifier: "ENG-123", title: "Blocker", state: "Todo", sourceId: baseIssue.id, targetId: "target-id" }
    const gateway = fakeGateway({
      listRelations: (input) => {
        expect(input).toEqual({ issue: "ENG-124", type: "blocks", direction: "incoming", after: undefined, limit: 100 })
        return Effect.succeed(page([relation]))
      }
    })

    const output = await run(["relations", "list", "--issue", "ENG-124", "--type", "blocks", "--direction", "incoming"], gateway)

    expect(output).toEqual({
      count: "1 relations shown",
      page: { hasNext: false, endCursor: null },
      relations: [relation],
      help: []
    })
  })

  test("blocked-by create normalizes blocker as source and blocked issue as target", async () => {
    const id = "88888888-8888-4888-8888-888888888888"
    const gateway = fakeGateway({
      createRelation: (input) => {
        expect(input).toEqual({ issue: "ENG-123", relatedIssue: "ENG-124", type: "blocks", id })
        return Effect.succeed(mutation({
          id,
          type: "blocks",
          direction: "outgoing",
          identifier: "ENG-124",
          title: "Blocked issue",
          state: "Todo",
          sourceId: baseIssue.id,
          targetId: "target-id"
        }))
      }
    })

    const output = await run([
      "relations", "create", "--issue", "ENG-124", "--blocked-by", "ENG-123", "--id", id
    ], gateway)

    expect(output).toMatchObject({ blockedIssue: "ENG-124", blockerIssue: "ENG-123" })
  })

  test("relation removal supports exact ids and blocked-by direction", async () => {
    const calls: unknown[] = []
    const relationId = "88888888-8888-4888-8888-888888888888"
    const gateway = fakeGateway({
      removeRelation: (input) => { calls.push(input); return Effect.succeed(mutation({ id: relationId }, true, "directed relation removed")) }
    })

    await run(["relations", "remove", "--id", relationId], gateway)
    await run(["relations", "remove", "--issue", "ENG-124", "--blocked-by", "ENG-123"], gateway)

    expect(calls).toEqual([
      { id: relationId },
      { issue: "ENG-123", relatedIssue: "ENG-124", type: "blocks" }
    ])

    const error = await Effect.runPromise(Effect.flip(runCommand(
      parseArgs(["relations", "remove", "--id", "not-a-uuid"], commandSpecs), gateway, "/repo/src/main.ts"
    )))
    expect(error._tag).toBe("UsageError")
    expect(calls).toHaveLength(2)
  })

  test("blocked-by list normalizes to incoming blocks centered on the blocked issue", async () => {
    const gateway = fakeGateway({
      listRelations: (input) => {
        expect(input).toEqual({
          issue: "ENG-124",
          type: "blocks",
          direction: "incoming",
          after: undefined,
          limit: 100
        })
        return Effect.succeed(page([{
          id: "relation-id",
          type: "blocks",
          direction: "incoming",
          identifier: "ENG-123",
          title: "Blocker",
          state: "Todo",
          sourceId: baseIssue.id,
          targetId: "target-id"
        }], true))
      }
    })

    const output = await run(["relations", "list", "--issue", "ENG-124", "--blocked-by"], gateway)

    expect(output).toMatchObject({ blockedIssue: "ENG-124" })
    expect((output.relations as Array<{ blockerIssue: string }>)[0]?.blockerIssue).toBe("ENG-123")
    expect((output.relations as Array<{ identifier?: string }>)[0]?.identifier).toBeUndefined()
    expect((output.help as string[])[0]).toContain("relations list --issue 'ENG-124' --blocked-by --after 'next-cursor'")
  })

  test("blocked-by shorthands reject generic relation flags before gateway access", async () => {
    let calls = 0
    const gateway = fakeGateway({
      createRelation: () => { calls += 1; return Effect.succeed(mutation(baseRelation)) },
      listRelations: () => { calls += 1; return Effect.succeed(page([])) }
    })

    for (const argv of [
      ["relations", "create", "--issue", "ENG-124", "--blocked-by", "ENG-123", "--related-issue", "ENG-125"],
      ["relations", "create", "--issue", "ENG-124", "--blocked-by", "ENG-123", "--type", "blocks"],
      ["relations", "list", "--issue", "ENG-124", "--blocked-by", "--type", "blocks"],
      ["relations", "list", "--issue", "ENG-124", "--blocked-by", "--direction", "incoming"]
    ]) {
      const parsed = parseArgs(argv, commandSpecs)
      const error = await Effect.runPromise(Effect.flip(runCommand(parsed, gateway, "/repo/src/main.ts")))
      expect(error).toBeInstanceOf(UsageError)
      expect(error.message).toContain("must not combine")
    }

    expect(calls).toBe(0)
  })

  test("generic relation create still requires both related issue and type before gateway access", async () => {
    let calls = 0
    const gateway = fakeGateway({
      createRelation: () => { calls += 1; return Effect.succeed(mutation(baseRelation)) }
    })

    for (const argv of [
      ["relations", "create", "--issue", "ENG-123", "--related-issue", "ENG-124"],
      ["relations", "create", "--issue", "ENG-123", "--type", "blocks"]
    ]) {
      const parsed = parseArgs(argv, commandSpecs)
      const error = await Effect.runPromise(Effect.flip(runCommand(parsed, gateway, "/repo/src/main.ts")))
      expect(error).toBeInstanceOf(UsageError)
    }

    expect(calls).toBe(0)
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

  test("complete-comment-body help safely replays the displayed page", async () => {
    const issueId = "ENG-$(echo injected)'`$HOME"
    const gateway = fakeGateway({
      listComments: (input) => {
        expect(input).toEqual({ issue: issueId, after: "cursor-1", limit: 7 })
        return Effect.succeed(page([{
          id: "comment-id",
          issueId: baseIssue.id,
          body: "x".repeat(600),
          createdAt: baseIssue.createdAt,
          updatedAt: baseIssue.updatedAt,
          author: "Henrik",
          url: baseIssue.url
        }]))
      }
    })

    const output = await run([
      "comments", "list", "--issue", issueId, "--after", "cursor-1", "--limit", "7"
    ], gateway)
    const help = (output.help as string[])[0]!

    expect(help).toContain("comments list --issue 'ENG-$(echo injected)'\"'\"'`$HOME' --after 'cursor-1' --limit '7' --full")
    expect(help).not.toContain('"$(echo injected)')
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

  test("noncanonical update timestamps fail before gateway access", async () => {
    let calls = 0
    const gateway = fakeGateway({
      updateIssueDescription: () => {
        calls += 1
        return Effect.succeed(mutation(detail()))
      }
    })

    for (const timestamp of [
      "2026-07-08T00:00:00Z",
      "2026-07-08T00:00:00.0001Z",
      "2026-07-08T00:00:00.000+00:00",
      "2026-02-30T00:00:00.000Z"
    ]) {
      const parsed = parseArgs([
        "issues", "update", "--id", "ENG-100", "--description-file", "x", "--if-updated-at", timestamp
      ], commandSpecs)
      const error = await Effect.runPromise(Effect.flip(runCommand(parsed, gateway, "/repo/src/main.ts")))
      expect(error._tag).toBe("UsageError")
      expect(error.message).toContain("canonical timestamp")
    }
    expect(calls).toBe(0)
  })

  test("malformed and conflicting flags fail before gateway access", async () => {
    let calls = 0
    const gateway = fakeGateway({
      createComment: () => { calls += 1; return Effect.succeed(mutation({ id: "x", issueId: "x", body: "x", createdAt: "x", updatedAt: "x", author: "x", url: "x" })) },
      updateIssueDescription: () => { calls += 1; return Effect.succeed(mutation(detail())) },
      listLabels: () => { calls += 1; return Effect.succeed(page([])) },
      listRelations: () => { calls += 1; return Effect.succeed(page([])) },
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
      ["labels", "list", "--issue", "ENG-123", "--name", "x", "--after", "label:01"],
      ["relations", "list", "--issue", "ENG-123", "--after", "invalid"],
      ["wayfinder", "frontier", "--map", "ENG-100", "--after", "invalid"]
    ]) {
      const parsed = parseArgs(argv, commandSpecs)
      const exit = await Effect.runPromiseExit(runCommand(parsed, gateway, "/repo/src/main.ts"))
      expect(exit._tag).toBe("Failure")
    }
    expect(calls).toBe(0)
  })
})
