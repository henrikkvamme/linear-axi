import { encode } from "@toon-format/toon"

export type OutputValue = Record<string, unknown>

export const writeToon = (value: OutputValue): void => {
  process.stdout.write(encode(value))
  process.stdout.write("\n")
}

export const errorOutput = (message: string, help?: string): OutputValue => ({
  error: message,
  ...(help ? { help } : {})
})

export const truncateText = (
  value: string | null | undefined,
  maxLength: number,
  full: boolean
): { text: string; truncated: boolean; total: number } => {
  const text = value ?? ""

  if (full || text.length <= maxLength) {
    return { text, truncated: false, total: text.length }
  }

  return {
    text: `${text.slice(0, maxLength)}...`,
    truncated: true,
    total: text.length
  }
}
