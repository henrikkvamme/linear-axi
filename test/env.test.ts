import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { credentialsFilePath, loadEnv, parseDotEnv } from "../src/env"

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

describe("loadEnv", () => {
  test("loads managed, OAuth, repo, and process credentials in explicit precedence order", () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-env-test-"))
    const home = join(root, "home")
    const cwd = join(root, "repo")
    const configDir = join(home, ".config", "linear-axi")
    mkdirSync(configDir, { recursive: true })
    mkdirSync(cwd)
    writeFileSync(join(configDir, "secrets.env"), "SOURCE=managed\nMANAGED_ONLY=yes\n")
    writeFileSync(join(configDir, "credentials.env"), "SOURCE=oauth\nOAUTH_ONLY=yes\n")
    writeFileSync(join(cwd, ".env"), "SOURCE=repo\nREPO_ONLY=yes\n")

    expect(loadEnv(cwd, { HOME: home, SOURCE: "process" })).toMatchObject({
      SOURCE: "process",
      MANAGED_ONLY: "yes",
      OAUTH_ONLY: "yes",
      REPO_ONLY: "yes"
    })
  })

  test("uses the XDG credentials file outside a source checkout", () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-env-test-"))
    const cwd = join(root, "work")
    const configHome = join(root, "config")
    mkdirSync(join(configHome, "linear-axi"), { recursive: true })
    mkdirSync(cwd)
    writeFileSync(join(configHome, "linear-axi", "credentials.env"), "LINEAR_ACCESS_TOKEN=oauth-token\n")

    const env = loadEnv(cwd, { XDG_CONFIG_HOME: configHome })

    expect(env.LINEAR_ACCESS_TOKEN).toBe("oauth-token")
    expect(credentialsFilePath(env)).toBe(join(configHome, "linear-axi", "credentials.env"))
  })

  test("honors an explicit credential file", () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-env-test-"))
    const cwd = join(root, "work")
    const credentialFile = join(root, "credentials.env")
    mkdirSync(cwd)
    writeFileSync(credentialFile, "LINEAR_API_KEY=explicit-key\n")

    const env = loadEnv(cwd, { LINEAR_AXI_ENV_FILE: credentialFile })

    expect(env.LINEAR_API_KEY).toBe("explicit-key")
    expect(credentialsFilePath(env)).toBe(credentialFile)
  })
})
