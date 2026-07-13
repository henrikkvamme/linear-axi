import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type Env = Record<string, string | undefined>

export const loadEnv = (cwd: string, base: Env = process.env): Env => {
  const files = base.LINEAR_AXI_ENV_FILE
    ? [base.LINEAR_AXI_ENV_FILE, join(cwd, ".env")]
    : [managedSecretsFilePath(base), credentialsFilePath(base), join(cwd, ".env")]
  const loaded: Env = {}

  for (const file of files) {
    if (existsSync(file)) {
      Object.assign(loaded, parseDotEnv(readFileSync(file, "utf8")))
    }
  }

  return {
    ...loaded,
    ...base
  }
}

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
