import { encode } from "@toon-format/toon"
import { Predicate } from "effect"

export type OutputValue = Record<string, unknown>

export const encodeToon = (value: OutputValue): string => encode(value)

export const writeToon = (value: OutputValue): void => {
  process.stdout.write(encodeToon(value))
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

export const truncateDetail = (
  value: unknown
): { readonly value: unknown; readonly fields: ReadonlyArray<{ readonly field: string; readonly total: number }> } => {
  if (!Predicate.isObject(value)) return { value, fields: [] }
  const fields: Array<{ readonly field: string; readonly total: number }> = []
  const rendered = Object.fromEntries(Object.entries(value).map(([key, field]) => {
    if (typeof field === "string" && ["body", "content", "description", "instructions", "text"].includes(key)) {
      const truncated = truncateText(field, 1200, false)
      if (truncated.truncated) fields.push({ field: key, total: truncated.total })
      return [key, truncated.text]
    }
    return [key, field]
  }))
  return { value: rendered, fields }
}
