import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createOAuthSession, readOAuthCodeFromCallbackUrl } from "../src/oauth"

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
