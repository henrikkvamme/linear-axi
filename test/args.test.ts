import { describe, expect, test } from "bun:test"
import { commandSpecs, ISSUE_FIELDS, LABEL_FIELDS, parseArgs } from "../src/args"
import { UsageError } from "../src/errors"

describe("parseArgs", () => {
  test("defaults to home", () => {
    const parsed = parseArgs([], commandSpecs)
    expect(parsed.command).toEqual(["home"])
  })

  test("parses command flags", () => {
    const parsed = parseArgs(["issues", "list", "--assignee", "me", "--limit", "5"], commandSpecs)
    expect(parsed.command).toEqual(["issues", "list"])
    expect(parsed.flags.get("assignee")).toBe("me")
    expect(parsed.flags.get("limit")).toBe("5")
  })

  test("parses workflow state listing and transition commands", () => {
    const list = parseArgs(["workflow-states", "list", "--team", "ENG"], commandSpecs)
    const change = parseArgs(["issues", "state", "--id", "ENG-123", "--state", "In Progress"], commandSpecs)

    expect(list.flags.get("team")).toBe("ENG")
    expect(change.flags.get("state")).toBe("In Progress")
  })

  test("parses explicit parent set and clear commands", () => {
    expect(parseArgs(["issues", "parent", "set", "--id", "ENG-2", "--parent", "ENG-1"], commandSpecs).flags.get("parent")).toBe("ENG-1")
    expect(parseArgs(["issues", "parent", "clear", "--id", "ENG-2"], commandSpecs).flags.get("id")).toBe("ENG-2")
  })

  test("parses blocked-by relation shorthands with command-specific flag shapes", () => {
    const create = parseArgs([
      "relations", "create", "--issue", "ENG-124", "--blocked-by", "ENG-123"
    ], commandSpecs)
    const list = parseArgs([
      "relations", "list", "--issue", "ENG-124", "--blocked-by"
    ], commandSpecs)

    expect(create.flags.get("blocked-by")).toBe("ENG-123")
    expect(list.flags.get("blocked-by")).toBe(true)
  })

  test("parses relation removal by id and blocked-by tuple", () => {
    expect(parseArgs(["relations", "remove", "--id", "relation-id"], commandSpecs).flags.get("id")).toBe("relation-id")
    const blockedBy = parseArgs(["relations", "remove", "--issue", "ENG-2", "--blocked-by", "ENG-1"], commandSpecs)
    expect(blockedBy.flags.get("issue")).toBe("ENG-2")
    expect(blockedBy.flags.get("blocked-by")).toBe("ENG-1")
  })

  test("parses additive, subtractive, and explicit replacement label commands", () => {
    expect(parseArgs(["labels", "add", "--issue", "ENG-1", "--label", "Bug"], commandSpecs).flags.get("label")).toBe("Bug")
    expect(parseArgs(["labels", "remove", "--issue", "ENG-1", "--label", "Bug"], commandSpecs).flags.get("label")).toBe("Bug")
    expect(parseArgs(["labels", "replace", "--issue", "ENG-1", "--labels-json", "[]"], commandSpecs).flags.get("labels-json")).toBe("[]")
  })

  test("rejects unknown flags", () => {
    expect(() => parseArgs(["issues", "list", "--stat", "open"], commandSpecs)).toThrow(UsageError)
  })

  test("rejects missing required flags", () => {
    expect(() => parseArgs(["issues", "view"], commandSpecs)).toThrow(UsageError)
  })

  test("allows help without required command flags", () => {
    const parsed = parseArgs(["issues", "view", "--help"], commandSpecs)

    expect(parsed.command).toEqual(["issues", "view"])
    expect(parsed.flags.get("help")).toBe(true)
  })

  test("rejects unknown flags even when help is present", () => {
    expect(() => parseArgs(["issues", "view", "--bogus", "--help"], commandSpecs)).toThrow(UsageError)
  })

  test("rejects malformed flags even when help is present", () => {
    expect(() => parseArgs(["issues", "view", "--full=yes", "--help"], commandSpecs)).toThrow(UsageError)
  })

  test("rejects missing value flags before treating following help as command help", () => {
    expect(() => parseArgs(["issues", "create", "--team", "--help"], commandSpecs)).toThrow(UsageError)
  })

  test("rejects boolean flags with values", () => {
    expect(() => parseArgs(["issues", "view", "--full", "ENG-123"], commandSpecs)).toThrow(UsageError)
  })

  test("supports inline values that start with dashes", () => {
    const parsed = parseArgs(["comments", "create", "--issue=ENG-123", "--body=--not-a-flag"], commandSpecs)

    expect(parsed.flags.get("issue")).toBe("ENG-123")
    expect(parsed.flags.get("body")).toBe("--not-a-flag")
  })

  test("rejects invalid limits during parsing", () => {
    expect(() => parseArgs(["teams", "list", "--limit", "0"], commandSpecs)).toThrow(UsageError)
  })

  test("rejects empty values during parsing", () => {
    for (const args of [
      ["issues", "create", "--team=", "--title", "Child"],
      ["issues", "create", "--team", "ENG", "--title", "Child", "--parent="],
      ["issues", "create", "--team", "ENG", "--title", "Child", "--label="],
      ["issues", "create", "--team", "ENG", "--title", "Child", "--id="],
      ["issues", "close", "--id", "ENG-123", "--state="],
      ["relations", "list", "--issue", "ENG-123", "--after="]
    ]) {
      expect(() => parseArgs(args, commandSpecs)).toThrow(UsageError)
    }
  })

  test("rejects help values", () => {
    expect(() => parseArgs(["--help", "auth"], commandSpecs)).toThrow(UsageError)
  })

  test("parses oauth connect flags", () => {
    const parsed = parseArgs([
      "auth",
      "oauth",
      "connect",
      "--client-id",
      "client1",
      "--write-env",
      "--prompt-consent",
      "--notify"
    ], commandSpecs)

    expect(parsed.command).toEqual(["auth", "oauth", "connect"])
    expect(parsed.flags.get("client-id")).toBe("client1")
    expect(parsed.flags.get("write-env")).toBe(true)
    expect(parsed.flags.get("prompt-consent")).toBe(true)
    expect(parsed.flags.get("notify")).toBe(true)
  })

  test("parses auth login flags", () => {
    const parsed = parseArgs([
      "auth",
      "login",
      "--notify",
      "--timeout",
      "300"
    ], commandSpecs)

    expect(parsed.command).toEqual(["auth", "login"])
    expect(parsed.flags.get("notify")).toBe(true)
    expect(parsed.flags.get("timeout")).toBe("300")
  })

  test("parses auth login without opening a local browser", () => {
    const parsed = parseArgs(["auth", "login", "--no-open"], commandSpecs)

    expect(parsed.command).toEqual(["auth", "login"])
    expect(parsed.flags.get("no-open")).toBe(true)
  })

  test("parses oauth setup flags", () => {
    const parsed = parseArgs([
      "auth",
      "oauth",
      "setup",
      "--notify",
      "--redirect-uri",
      "http://127.0.0.1:14582/oauth/callback"
    ], commandSpecs)

    expect(parsed.command).toEqual(["auth", "oauth", "setup"])
    expect(parsed.flags.get("notify")).toBe(true)
    expect(parsed.flags.get("redirect-uri")).toBe("http://127.0.0.1:14582/oauth/callback")
  })

  test("command help documents every accepted option and an example", () => {
    for (const spec of commandSpecs.filter((candidate) => candidate.path[0] !== "home")) {
      expect(spec.help).toContain("Example:")
      for (const flag of spec.flags) {
        expect(spec.help).toContain(`--${flag}`)
      }
    }
  })

  test("list help derives every accepted field from shared metadata", () => {
    const issueHelp = commandSpecs.find((spec) => spec.path.join(" ") === "issues list")?.help
    const labelHelp = commandSpecs.find((spec) => spec.path.join(" ") === "labels list")?.help

    expect(issueHelp).toContain(`<${ISSUE_FIELDS.join(",")}>`)
    expect(labelHelp).toContain(`<${LABEL_FIELDS.join(",")}>`)
  })

  test("auth login help includes all credential and OAuth controls", () => {
    const help = commandSpecs.find((spec) => spec.path.join(" ") === "auth login")?.help
    for (const flag of ["timeout", "scope", "actor", "env-file", "redirect-uri", "client-id"]) {
      expect(help).toContain(`--${flag}`)
    }
  })

  test("labels list exposes explicit archived-label discovery", () => {
    const parsed = parseArgs(["labels", "list", "--include-archived"], commandSpecs)
    const help = commandSpecs.find((spec) => spec.path.join(" ") === "labels list")?.help

    expect(parsed.flags.get("include-archived")).toBe(true)
    expect(help).toContain("--include-archived")
  })

  test("relation help makes blocked and blocker roles explicit", () => {
    const createHelp = commandSpecs.find((spec) => spec.path.join(" ") === "relations create")?.help
    const listHelp = commandSpecs.find((spec) => spec.path.join(" ") === "relations list")?.help

    expect(createHelp).toContain("--issue <blocked-issue> --blocked-by <blocker-issue>")
    expect(listHelp).toContain("--issue <blocked-issue> --blocked-by")
  })

  const newCommands: ReadonlyArray<ReadonlyArray<string>> = [
    ["issues", "assign"],
    ["issues", "unassign"],
    ["issues", "close"],
    ["issues", "update"],
    ["labels", "list"],
    ["labels", "create"],
    ["labels", "apply"],
    ["relations", "list"],
    ["relations", "create"],
    ["comments", "list"],
    ["wayfinder", "frontier"]
  ]

  for (const command of newCommands) {
    test(`rejects unknown flags for ${command.join(" ")} even with help`, () => {
      expect(() => parseArgs([...command, "--bogus", "--help"], commandSpecs)).toThrow(UsageError)
    })
  }

  for (const [command, required] of [
    [["issues", "assign"], "id"],
    [["issues", "unassign"], "id"],
    [["issues", "close"], "id"],
    [["issues", "update"], "id"],
    [["labels", "create"], "name"],
    [["labels", "apply"], "issue"],
    [["relations", "list"], "issue"],
    [["relations", "create"], "issue"],
    [["comments", "list"], "issue"],
    [["wayfinder", "frontier"], "map"]
  ] as const) {
    test(`rejects missing --${required} for ${command.join(" ")}`, () => {
      expect(() => parseArgs(command, commandSpecs)).toThrow(UsageError)
    })
  }
})
