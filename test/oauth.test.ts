import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import {
  browserOpenCommand,
  createOAuthSession,
  openOAuthUrl,
  readOAuthCodeFromCallbackUrl,
  writeOAuthEnv
} from "../src/oauth"

describe("browserOpenCommand", () => {
  test("uses the native macOS browser opener", () => {
    expect(browserOpenCommand("darwin", "https://linear.app/oauth/authorize")).toEqual({
      command: "open",
      args: ["https://linear.app/oauth/authorize"]
    })
  })

  test("uses xdg-open on Linux", () => {
    expect(browserOpenCommand("linux", "https://linear.app/oauth/authorize")).toEqual({
      command: "xdg-open",
      args: ["https://linear.app/oauth/authorize"]
    })
  })

  test("launches the selected browser command", () => {
    const calls: Array<{ command: string; args: ReadonlyArray<string> }> = []
    const opened = Effect.runSync(openOAuthUrl("https://linear.app/oauth/authorize", {
      platform: "darwin",
      launch: (command, args) => {
        calls.push({ command, args })
        return 0
      }
    }))

    expect(opened).toBe(true)
    expect(calls).toEqual([{
      command: "open",
      args: ["https://linear.app/oauth/authorize"]
    }])
  })
})

describe("writeOAuthEnv", () => {
  test("creates a private credentials directory and file", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-oauth-env-test-"))
    const envFile = join(root, "config", "linear-axi", "credentials.env")

    await Effect.runPromise(writeOAuthEnv(envFile, {
      LINEAR_ACCESS_TOKEN: "secret-token"
    }))

    expect(statSync(join(root, "config", "linear-axi")).mode & 0o777).toBe(0o700)
    expect(statSync(envFile).mode & 0o777).toBe(0o600)
    expect(readFileSync(envFile, "utf8")).toBe("LINEAR_ACCESS_TOKEN=secret-token\n")
  })
})

describe("createOAuthSession", () => {
  test("builds a Linear OAuth PKCE authorization URL", () => {
    const session = createOAuthSession({
      clientId: "client1",
      redirectUri: "http://127.0.0.1:14582/oauth/callback",
      scope: "read,write",
      actor: "app",
      promptConsent: true
    })
    const url = new URL(session.authorizeUrl)

    expect(url.origin).toBe("https://linear.app")
    expect(url.pathname).toBe("/oauth/authorize")
    expect(url.searchParams.get("client_id")).toBe("client1")
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:14582/oauth/callback")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("scope")).toBe("read,write")
    expect(url.searchParams.get("actor")).toBe("app")
    expect(url.searchParams.get("prompt")).toBe("consent")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("state")).toBe(session.state)
    expect(url.searchParams.get("code_challenge")).toBe(session.codeChallenge)
  })
})

describe("readOAuthCodeFromCallbackUrl", () => {
  const input = {
    callbackPath: "/oauth/callback",
    expectedState: "state1"
  }

  test("extracts code from a pasted callback URL", async () => {
    const code = await Effect.runPromise(readOAuthCodeFromCallbackUrl(
      "http://127.0.0.1:14582/oauth/callback?code=code1&state=state1",
      input
    ))

    expect(code).toBe("code1")
  })

  test("rejects stale callback URLs with the wrong state", async () => {
    const exit = await Effect.runPromiseExit(readOAuthCodeFromCallbackUrl(
      "http://127.0.0.1:14582/oauth/callback?code=code1&state=old",
      input
    ))

    expect(exit._tag).toBe("Failure")
  })

  test("rejects Linear authorization errors", async () => {
    const exit = await Effect.runPromiseExit(readOAuthCodeFromCallbackUrl(
      "http://127.0.0.1:14582/oauth/callback?error=access_denied&state=state1",
      input
    ))

    expect(exit._tag).toBe("Failure")
  })
})
