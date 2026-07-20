import { DateTime, Option } from "effect"

export const isCanonicalTimestamp = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = Option.getOrUndefined(DateTime.make(value))
  return parsed !== undefined && DateTime.formatIso(parsed) === value
}

export const isCanonicalDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = Option.getOrUndefined(DateTime.make(`${value}T00:00:00.000Z`))
  return parsed !== undefined && DateTime.formatIso(parsed).slice(0, 10) === value
}
