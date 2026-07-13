import { describe, expect, test } from "bun:test"
import { decode } from "@toon-format/toon"
import { encodeToon, truncateText } from "../src/output"

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

  test("emitted TOON decodes structural strings and tabular counts exactly", () => {
    const value = {
      issue: { id: "1", title: "colon: comma, newline\nnext" },
      rows: [
        { id: "1", title: "alpha,beta" },
        { id: "2", title: "gamma:delta" }
      ],
      empty: []
    }
    const encoded = encodeToon(value)
    expect(encoded).toContain("rows[2]{id,title}:")
    expect(decode(encoded)).toEqual(value)
  })
})
