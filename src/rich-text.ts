export const normalizeRichText = (text: string): string =>
  text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/\n+$/, "")

export const canonicalRichText = (text: string): string =>
  normalizeRichText(text).replace(/\]\(<(https?:\/\/[^>\n]+)>\)/g, "]($1)")

export const richTextEqual = (left: string, right: string): boolean =>
  canonicalRichText(left) === canonicalRichText(right)
