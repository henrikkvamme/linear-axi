import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type Env = Record<string, string | undefined>

export const loadEnv = (cwd: string, base: Env = process.env): Env => {
  const envFile = join(cwd, ".env")
  if (!existsSync(envFile)) {
    return { ...base }
  }

  return {
    ...parseDotEnv(readFileSync(envFile, "utf8")),
    ...base
  }
}

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
