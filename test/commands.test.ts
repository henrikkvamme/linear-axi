import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { commandSpecs, parseArgs } from "../src/args"
import { runCommand } from "../src/commands"
import { UsageError } from "../src/errors"
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

const fakeGateway = (overrides: Partial<LinearGateway> = {}): LinearGateway => ({
  callOfficialTool: () => Effect.succeed({}),
  authStatus: () => Effect.succeed({
    authenticated: true,
    method: "apiKey",
    viewer: { id: "user-id", name: "Henrik" }
  }),
  listTeams: () => Effect.succeed([{ id: "team-id", key: "ENG", name: "Engineering" }]),
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
  listLabels: () => Effect.succeed(page([{ id: "label-id", name: "wayfinder:task", scope: "workspace", teamId: null, color: "#123456", description: "Task", isGroup: false, archivedAt: null }])),
  createLabel: () => Effect.succeed(mutation({ id: "label-id", name: "wayfinder:task", scope: "workspace", teamId: null, color: "#123456", description: "Task", isGroup: false, archivedAt: null }, true, "label created")),
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
})

const run = async (argv: ReadonlyArray<string>, gateway = fakeGateway()) => {
  const parsed = parseArgs(argv, commandSpecs)
  return Effect.runPromise(runCommand(parsed, gateway, "/repo/src/main.ts"))
}

describe("runCommand", () => {
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

  test("official update commands reject ambiguous parents and send typed arrays", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    let projectReads = 0
    const gateway = fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_project") {
          return Effect.succeed(projectReads++ === 0
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
      { name: "save_project", args: { id: "project-id", setTeams: ["ENG", "OPS"], priority: 2 } },
      { name: "get_project", args: { query: "project-id" } }
    ])
    expect(output).toMatchObject({ changed: true, result: "official save_project update verified" })
  })

  test("official project lead updates canonicalize me before verification", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    const output = await run(["projects", "update", "--id", "project-id", "--lead", "me"], fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_user") return Effect.succeed({ id: "user-id", name: "Henrik", email: "henrik@example.com" })
        if (name === "get_project") return Effect.succeed({ id: "project-id", lead: { id: "user-id", name: "Henrik" } })
        throw new Error("must not save an already satisfied lead")
      }
    }))

    expect(calls).toEqual([
      { name: "get_user", args: { query: "me" } },
      { name: "get_project", args: { query: "project-id" } }
    ])
    expect(output).toMatchObject({ changed: false, result: "requested properties already match (no-op)" })
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
      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain("could not be verified")
    }
  })

  test("official removal verification requires an explicit valid collection readback", async () => {
    for (const project of [{ id: "project-id" }, { id: "project-id", teams: [{}] }]) {
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
      expect(error._tag).toBe("LinearDomainError")
      expect(error.message).toContain("could not be verified")
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

  test("official rich-text updates accept Linear-normalized readback", async () => {
    const cases = [
      { argv: ["documents", "update", "--id", "document-id", "--content", "[doc](https://example.com)\r\n"], read: "get_document", value: { id: "document-id", content: "[doc](<https://example.com>)" } },
      { argv: ["projects", "update", "--id", "project-id", "--description", "[project](https://example.com)\r\n"], read: "get_project", value: { id: "project-id", description: "[project](<https://example.com>)" } },
      { argv: ["releases", "update", "--id", "release-id", "--description", "[release](https://example.com)\r\n"], read: "get_release", value: { id: "release-id", description: "[release](<https://example.com>)" } },
      { argv: ["release-notes", "update", "--id", "note-id", "--content", "[note](https://example.com)\r\n"], read: "get_release_note", value: { id: "note-id", content: "[note](<https://example.com>)" } },
      { argv: ["milestones", "update", "--project", "Roadmap", "--id", "milestone-id", "--description", "[milestone](https://example.com)\r\n"], read: "get_milestone", value: { id: "milestone-id", description: "[milestone](<https://example.com>)" } },
      { argv: ["status-updates", "update", "--type", "project", "--id", "update-id", "--body", "[status](https://example.com)\r\n"], read: "get_status_updates", value: { statusUpdates: [{ id: "update-id", type: "project", body: "[status](<https://example.com>)" }] } }
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
        : [entry.read])
      expect(output).toMatchObject({ changed: false, result: "requested properties already match (no-op)" })
    }
  })

  test("official update verification accepts every documented reference selector", async () => {
    const cases = [
      { argv: ["documents", "update", "--id", "document-id", "--issue", "ENG-123"], read: "get_document", value: { id: "document-id", issue: { id: "issue-id", identifier: "ENG-123" } } },
      { argv: ["documents", "update", "--id", "document-id", "--cycle", "7"], read: "get_document", value: { id: "document-id", cycle: { id: "cycle-id", number: 7 } } },
      { argv: ["releases", "update", "--id", "release-id", "--stage", "started"], read: "get_release", value: { id: "release-id", stage: { id: "stage-id", name: "In progress", type: "started" } } }
    ] as const

    for (const entry of cases) {
      let saves = 0
      const output = await run(entry.argv, fakeGateway({
        callOfficialTool: (name) => {
          if (name.startsWith("save_")) saves += 1
          return Effect.succeed(entry.value)
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
        if (name === "get_document") return Effect.succeed(documentReads++ === 0
          ? { id: "document-id", cycle: null, team: null }
          : { id: "document-id", cycle: { id: "cycle-id", name: "Cycle 7" }, team: { id: "team-id", name: "Engineering" } })
        if (name === "save_document") return Effect.succeed({ id: "document-id" })
        return Effect.succeed({})
      }
    })
    await run(["documents", "update", "--id", "document-id", "--cycle", "Cycle 7", "--team", "Engineering"], gateway)
    expect(calls[1]).toEqual({ name: "save_document", args: { id: "document-id", cycle: "Cycle 7", team: "Engineering" } })

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
        if (name === "get_release_note") {
          return Effect.succeed({ id: "note-id", releases: reads++ === 0 ? [] : [{ id: "release-1" }] })
        }
        return Effect.succeed({ id: "note-id" })
      }
    }))
    expect(calls).toEqual([
      { name: "get_release_note", args: { id: "note-id", includeReleases: true } },
      { name: "save_release_note", args: { id: "note-id", releases: ["release-1"] } },
      { name: "get_release_note", args: { id: "note-id", includeReleases: true } }
    ])
    expect(output).toMatchObject({ changed: true, result: "official save_release_note update verified" })
  })

  test("verification failures provide exact tool-specific inspection commands", async () => {
    const cases = [
      { argv: ["documents", "update", "--id", "document-id", "--title", "New"], read: "get_document", before: { id: "document-id", title: "Old" }, help: "linear-axi documents view --id 'document-id' --full" },
      { argv: ["projects", "update", "--id", "project-id", "--state", "started"], read: "get_project", before: { id: "project-id", state: "planned" }, help: "linear-axi projects view --query 'project-id' --full" },
      { argv: ["releases", "update", "--id", "release-id", "--name", "New"], read: "get_release", before: { id: "release-id", name: "Old" }, help: "linear-axi releases view --id 'release-id' --full" },
      { argv: ["release-notes", "update", "--id", "note-id", "--title", "New"], read: "get_release_note", before: { id: "note-id", title: "Old" }, help: "linear-axi release-notes view --id 'note-id' --full" },
      { argv: ["status-updates", "update", "--type", "project", "--id", "update-id", "--health", "onTrack"], read: "get_status_updates", before: { statusUpdates: [{ id: "update-id", type: "project", health: "offTrack" }] }, help: "linear-axi status-updates view --type 'project' --id 'update-id' --full" }
    ] as const

    for (const entry of cases) {
      const error = await Effect.runPromise(Effect.flip(runCommand(parseArgs(entry.argv, commandSpecs), fakeGateway({
        callOfficialTool: (name) => Effect.succeed(name === entry.read ? entry.before : { id: "ignored" })
      }), "/repo/src/main.ts")))
      expect(error._tag).toBe("LinearDomainError")
      expect(error.help).toContain(entry.help)
    }

    const milestoneError = await Effect.runPromise(Effect.flip(runCommand(parseArgs([
      "milestones", "update", "--project", "Roadmap", "--id", "Launch", "--target-date", "2026-09-01"
    ], commandSpecs), fakeGateway({
      callOfficialTool: (name) => {
        if (name === "get_project") return Effect.succeed({ id: "project-id", name: "Roadmap" })
        if (name === "get_milestone") return Effect.succeed({ id: "milestone-id", name: "Launch", targetDate: "2026-08-01" })
        return Effect.succeed({})
      }
    }), "/repo/src/main.ts")))
    expect(milestoneError.help).toContain("linear-axi milestones view --project 'project-id' --query 'milestone-id' --full")
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

      expect(error._tag).toBe("LinearDomainError")
      expect(reads).toBe(Object.keys(saveResult).length === 0 ? 0 : 1)
    }
  })

  test("advanced issue create preflights exact identity and performs one mutation", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    const gateway = fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG", name: "Engineering" })
        if (name === "list_issue_labels") return Effect.succeed({ labels: [{ id: "label-id", name: "Bug" }], hasNextPage: false })
        if (name === "list_issues") return Effect.succeed({ issues: [], hasNextPage: false })
        if (name === "list_users") return Effect.succeed({ users: [{ id: "user-id", email: "alice@example.com", name: "Alice" }], hasNextPage: false })
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
          if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
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

  test("advanced issue labels share one guarded collection scan", async () => {
    let labelPages = 0
    const output = await run([
      "issues", "create", "--team", "ENG", "--title", "Launch", "--labels-json", '["Bug","Urgent"]', "--if-absent"
    ], fakeGateway({
      callOfficialTool: (name, args) => {
        if (name === "get_team") return Effect.succeed({ id: "team-id", key: "ENG" })
        if (name === "list_issue_labels") {
          labelPages += 1
          return args.cursor === undefined
            ? Effect.succeed({ labels: [{ id: "bug-id", name: "Bug" }], hasNextPage: true, cursor: "labels-2" })
            : Effect.succeed({ labels: [{ id: "urgent-id", name: "Urgent" }], hasNextPage: false })
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
    }))

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
          return Effect.succeed(reads === 1
            ? { id: "issue-id", identifier: "ENG-123", teamId: "team-id", releases: [], relations: { blocks: [] } }
            : { id: "issue-id", identifier: "ENG-123", teamId: "team-id", releases: [{ id: "release-id" }], relations: { blocks: [{ id: "blocked-id", identifier: "ENG-2" }] } })
        }
        if (name === "get_issue") return Effect.succeed({ id: "blocked-id", identifier: "ENG-2", teamId: "team-id" })
        if (name === "list_releases") return Effect.succeed({ releases: [{ id: "release-id", version: "v1" }], hasNextPage: false })
        return Effect.succeed({ id: "issue-id" })
      }
    }))

    expect(calls.filter(({ name, args }) => name === "get_issue" && args.id === "eng-123")).toEqual([
      { name: "get_issue", args: { id: "eng-123", includeReleases: true, includeRelations: true } },
      { name: "get_issue", args: { id: "eng-123", includeReleases: true, includeRelations: true } }
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
    expect(error._tag).toBe("LinearDomainError")
    expect(error.message).toContain("could not be verified")
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

      expect(error._tag).toBe("LinearDomainError")
      expect(saves).toBe(1)
    }
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
    expect(error._tag).toBe("LinearDomainError")
    expect(error.help).toContain("linear-axi issues inspect --id 'ENG-123' --full")
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
      { name: "save_issue", args: { id: "ENG-123", title: "Renamed", assignee: null, estimate: null, project: null, cycle: null, parentId: null, labels: [] } },
      { name: "get_issue", args: { id: "ENG-123" } }
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

  test("issue assignee updates canonicalize me before retry verification", async () => {
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    const output = await run(["issues", "update", "--id", "ENG-123", "--assignee", "me"], fakeGateway({
      callOfficialTool: (name, args) => {
        calls.push({ name, args })
        if (name === "get_issue") return Effect.succeed({ id: "issue-id", identifier: "ENG-123", teamId: "team-id", assignee: { id: "user-id", name: "Henrik" } })
        if (name === "get_user") return Effect.succeed({ id: "user-id", name: "Henrik" })
        throw new Error("must not repeat an already satisfied assignee mutation")
      }
    }))

    expect(calls).toEqual([
      { name: "get_issue", args: { id: "ENG-123" } },
      { name: "get_user", args: { query: "me" } }
    ])
    expect(output).toMatchObject({ changed: false, result: "requested issue properties already match (no-op)" })
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
        expect(input.fields).toEqual(["id", "name", "color"])
        return Effect.succeed(page([{ id: "label-id", name: "wayfinder:task", scope: "workspace", teamId: null, color: "#123456", description: "Task", isGroup: false, archivedAt: null }]))
      }
    })
    const created = await run(["labels", "create", "--workspace", "--name", "wayfinder:task", "--color", "#123456", "--if-absent"])
    const listed = await run(["labels", "list", "--workspace", "--include-archived", "--fields", "id,name,color"], gateway)
    const applied = await run(["labels", "apply", "--issue", "ENG-123", "--label", "wayfinder:task"])
    expect(created.changed).toBe(true)
    expect(listed.labels).toEqual([{ id: "label-id", name: "wayfinder:task", color: "#123456" }])
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
