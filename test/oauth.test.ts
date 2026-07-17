import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import {
  benderBrowserRequestArgs,
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

  test("does not pass OAuth URLs through the Windows command shell", () => {
    const url = "https://linear.app/oauth/authorize?client_id=client1&scope=read%2Cwrite&state=state1"

    expect(browserOpenCommand("win32", url)).toEqual({
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url]
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

  test("refuses to write credentials through a symlink", async () => {
    if (process.platform === "win32") {
      return
    }

    const root = mkdtempSync(join(tmpdir(), "linear-axi-oauth-env-test-"))
    const target = join(root, "target.env")
    const envFile = join(root, "credentials.env")
    writeFileSync(target, "SAFE=unchanged\n")
    symlinkSync(target, envFile)

    const exit = await Effect.runPromiseExit(writeOAuthEnv(envFile, {
      LINEAR_ACCESS_TOKEN: "secret-token"
    }))

    expect(exit._tag).toBe("Failure")
    expect(readFileSync(target, "utf8")).toBe("SAFE=unchanged\n")
  })

  test("refuses to write credentials through a directory symlink", async () => {
    if (process.platform === "win32") {
      return
    }

    const root = mkdtempSync(join(tmpdir(), "linear-axi-oauth-env-test-"))
    const targetDirectory = join(root, "target")
    const credentialDirectory = join(root, "linear-axi")
    mkdirSync(targetDirectory)
    symlinkSync(targetDirectory, credentialDirectory)

    const exit = await Effect.runPromiseExit(writeOAuthEnv(join(credentialDirectory, "credentials.env"), {
      LINEAR_ACCESS_TOKEN: "secret-token"
    }))

    expect(exit._tag).toBe("Failure")
    expect(() => readFileSync(join(targetDirectory, "credentials.env"), "utf8")).toThrow()
  })

  test("replaces conflicting credentials when saving OAuth", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-oauth-env-test-"))
    const envFile = join(root, "credentials.env")
    writeFileSync(envFile, "LINEAR_API_KEY=stale-api-key\n")

    await Effect.runPromise(writeOAuthEnv(envFile, {
      LINEAR_ACCESS_TOKEN: "oauth-token"
    }))

    expect(readFileSync(envFile, "utf8")).toBe("LINEAR_ACCESS_TOKEN=oauth-token\n")
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

describe("benderBrowserRequestArgs", () => {
  test("prepares the intended OAuth page before requesting phone takeover", () => {
    const url = "https://linear.app/oauth/authorize?client_id=client1&state=state1"

    expect(benderBrowserRequestArgs(url, "Authorize Linear OAuth for linear-axi", "task-123")).toEqual([
      "request",
      "--service",
      "Linear",
      "--domain",
      "linear.app",
      "--task-id",
      "task-123",
      "--reason",
      "Authorize Linear OAuth for linear-axi",
      "--target-url",
      url,
      "--wait"
    ])
  })
})
