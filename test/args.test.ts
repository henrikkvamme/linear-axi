import { describe, expect, test } from "bun:test"
import { commandSpecs, parseArgs } from "../src/args"
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
})
