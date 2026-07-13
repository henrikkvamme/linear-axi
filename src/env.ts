import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type Env = Record<string, string | undefined>

const credentialKeys = ["LINEAR_API_KEY", "LINEAR_ACCESS_TOKEN"] as const
const trustedPathKeys = new Set(["HOME", "XDG_CONFIG_HOME", "LINEAR_AXI_ENV_FILE"])

export const loadEnv = (cwd: string, base: Env = process.env): Env => {
  const repo = readEnvFile(join(cwd, ".env"))
  const explicit = base.LINEAR_AXI_ENV_FILE ? readEnvFile(base.LINEAR_AXI_ENV_FILE) : undefined
  const managed = explicit ? undefined : readEnvFile(managedSecretsFilePath(base))
  const oauth = explicit ? undefined : readEnvFile(credentialsFilePath(base))
  const env: Env = explicit
    ? Object.assign({}, explicit, repo, base)
    : Object.assign({}, managed, oauth, repo, base)
  const credentials = (explicit
    ? [base, explicit, repo]
    : [base, oauth, repo, managed]
  ).find(hasCredentials)

  for (const key of credentialKeys) {
    delete env[key]
    const value = credentials?.[key]
    if (value !== undefined && value.length > 0) {
      env[key] = value
    }
  }

  return env
}

const readEnvFile = (file: string): Env => {
  if (!existsSync(file)) {
    return {}
  }

  const env = parseDotEnv(readFileSync(file, "utf8"))
  for (const key of trustedPathKeys) {
    delete env[key]
  }
  return env
}

const hasCredentials = (env: Env | undefined): boolean =>
  env !== undefined && credentialKeys.some((key) => {
    const value = env[key]
    return value !== undefined && value.length > 0
  })

export const credentialsFilePath = (env: Env = process.env): string =>
  env.LINEAR_AXI_ENV_FILE ?? join(configHome(env), "linear-axi", "credentials.env")

const managedSecretsFilePath = (env: Env): string => join(configHome(env), "linear-axi", "secrets.env")

const configHome = (env: Env): string => env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), ".config")

export const parseDotEnv = (text: string): Env => {
  const env: Env = {}

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith("#")) {
      continue
    }

    const assignment = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line
    const equalsIndex = assignment.indexOf("=")
    if (equalsIndex <= 0) {
      continue
    }

    const key = assignment.slice(0, equalsIndex).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue
    }

    env[key] = parseValue(assignment.slice(equalsIndex + 1).trim())
  }

  return env
}

const parseValue = (value: string): string => {
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1).replaceAll("\\n", "\n").replaceAll('\\"', "\"").replaceAll("\\\\", "\\")
  }

  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
  }

  const commentIndex = value.search(/\s+#/)
  return commentIndex === -1 ? value : value.slice(0, commentIndex).trimEnd()
}
