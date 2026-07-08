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
