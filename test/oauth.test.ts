import { describe, expect, test } from "bun:test"
import { createOAuthSession } from "../src/oauth"

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
