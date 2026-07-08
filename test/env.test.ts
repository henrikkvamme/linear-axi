import { describe, expect, test } from "bun:test"
import { parseDotEnv } from "../src/env"

describe("parseDotEnv", () => {
  test("parses dotenv assignments without overriding shell semantics", () => {
    expect(parseDotEnv([
      "LINEAR_API_KEY=lin_api_123",
      "LINEAR_TEAM=BEN # repo default",
      "export LINEAR_OAUTH_SCOPE=\"read,write\"",
      "IGNORED",
      ""
    ].join("\n"))).toEqual({
      LINEAR_API_KEY: "lin_api_123",
      LINEAR_TEAM: "BEN",
      LINEAR_OAUTH_SCOPE: "read,write"
    })
  })
})
