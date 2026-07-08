import { describe, expect, test } from "bun:test"
import { truncateText } from "../src/output"

describe("truncateText", () => {
  test("keeps short text", () => {
    expect(truncateText("hello", 10, false)).toEqual({
      text: "hello",
      truncated: false,
      total: 5
    })
  })

  test("truncates long text with total count", () => {
    expect(truncateText("hello world", 5, false)).toEqual({
      text: "hello...",
      truncated: true,
      total: 11
    })
  })
})
