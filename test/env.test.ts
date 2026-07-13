import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { credentialsFilePath, loadEnv, parseDotEnv } from "../src/env"
import { credentialsFromEnv } from "../src/linear"

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
    writeFileSync(credentialFile, "LINEAR_ACCESS_TOKEN=explicit-token\n")
    writeFileSync(join(cwd, ".env"), "LINEAR_API_KEY=repo-key\n")

    const env = loadEnv(cwd, { LINEAR_AXI_ENV_FILE: credentialFile })

    expect(credentialsFromEnv(env)).toEqual({ kind: "accessToken", value: "explicit-token" })
    expect(credentialsFilePath(env)).toBe(credentialFile)
  })

  test("does not let dotenv files redirect credential storage", () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-env-test-"))
    const home = join(root, "home")
    const cwd = join(root, "repo")
    mkdirSync(cwd)
    writeFileSync(join(cwd, ".env"), [
      `HOME=${join(root, "redirected-home")}`,
      `XDG_CONFIG_HOME=${join(root, "redirected-config")}`,
      `LINEAR_AXI_ENV_FILE=${join(root, "redirected.env")}`,
      ""
    ].join("\n"))

    const env = loadEnv(cwd, { HOME: home })

    expect(env.HOME).toBe(home)
    expect(env.XDG_CONFIG_HOME).toBeUndefined()
    expect(env.LINEAR_AXI_ENV_FILE).toBeUndefined()
    expect(credentialsFilePath(env)).toBe(join(home, ".config", "linear-axi", "credentials.env"))
  })

  test("prefers OAuth credentials over repo credentials as one identity", () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-env-test-"))
    const home = join(root, "home")
    const cwd = join(root, "repo")
    const configDir = join(home, ".config", "linear-axi")
    mkdirSync(configDir, { recursive: true })
    mkdirSync(cwd)
    writeFileSync(join(configDir, "credentials.env"), "LINEAR_ACCESS_TOKEN=oauth-token\n")
    writeFileSync(join(cwd, ".env"), "LINEAR_API_KEY=stale-repo-key\n")

    expect(credentialsFromEnv(loadEnv(cwd, { HOME: home }))).toEqual({
      kind: "accessToken",
      value: "oauth-token"
    })
  })

  test("prefers process credentials over file credentials as one identity", () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-env-test-"))
    const home = join(root, "home")
    const cwd = join(root, "repo")
    mkdirSync(cwd)
    writeFileSync(join(cwd, ".env"), "LINEAR_API_KEY=repo-key\n")

    expect(credentialsFromEnv(loadEnv(cwd, {
      HOME: home,
      LINEAR_API_KEY: "",
      LINEAR_ACCESS_TOKEN: "process-token"
    }))).toEqual({
      kind: "accessToken",
      value: "process-token"
    })
  })
})
