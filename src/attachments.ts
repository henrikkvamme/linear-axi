import { constants, createReadStream, fstatSync } from "node:fs"
import { chmod, lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { Effect, Predicate } from "effect"
import type { ParsedArgs } from "./args"
import { readLimitFlag, readStringFlag } from "./args"
import { LinearApiError, LinearDomainError, UsageError, type CliError } from "./errors"
import type { LinearGateway } from "./linear"
import type { OutputValue } from "./output"
import {
  closeFileDescriptor,
  createPrivateFileAt,
  ensureNativeFileSupport,
  statFileAt,
  syncFileDescriptor,
  tryLinkFileAt,
  tryLockFileDescriptor,
  tryUnlinkFileAt,
  unlockFileDescriptor,
  writeFileDescriptor,
  type NativeFileIdentity
} from "./native-files"
import {
  decodeAttachmentCursor,
  decodeAttachmentWire,
  decodeFinalizedUpload,
  decodeHeadersWire,
  decodeIssueAttachments,
  decodeLinearDownloadUrl,
  decodeLinearUploadUrl,
  decodePreparedUploadWire,
  decodeUploadRecovery,
  type AttachmentWire,
  type FinalizedUploadWire,
  type HeadersWire,
  type IssueAttachments,
  type PreparedUploadWire
} from "./attachment-schema"

interface AttachmentSummary {
  readonly id: string
  readonly filename: string | null
  readonly title: string | null
  readonly mediaType: string | null
  readonly size: number | null
  readonly createdAt: string | null
  readonly updatedAt: string | null
}

interface AttachmentDetail extends AttachmentSummary {
  readonly subtitle: string | null
  readonly issue: { readonly id: string; readonly identifier?: string } | null
  readonly contentUrl: string | null
  readonly assetUrl: string | null
  readonly headers: Readonly<Record<string, string>>
  readonly sha256: string | null
}

export interface AttachmentRuntime {
  readonly fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  readonly requestTimeoutMs: number
  readonly stateRoot: string
}

const DEFAULT_RUNTIME: AttachmentRuntime = {
  fetcher: fetch,
  requestTimeoutMs: 30_000,
  stateRoot: resolve(process.env.XDG_STATE_HOME ?? resolve(process.env.HOME ?? process.cwd(), ".local", "state"), "linear-axi", "uploads")
}
const DEFAULT_READ_BYTES = 32 * 1024
const MAX_READ_BYTES = 1024 * 1024
const DEFAULT_DOWNLOAD_BYTES = 1024 * 1024 * 1024
const OFFICIAL_MAX_BYTES = 2 * 1024 * 1024 * 1024 - 1

export const runAttachmentCommand = (
  parsed: ParsedArgs,
  gateway: LinearGateway,
  runtimeOverrides: Partial<AttachmentRuntime> = {}
): Effect.Effect<OutputValue, CliError> | undefined => {
  const runtime = { ...DEFAULT_RUNTIME, ...runtimeOverrides }
  if (parsed.command.join(" ") === "attachments list") return listAttachments(parsed, gateway)
  if (parsed.command.join(" ") === "attachments view") return viewAttachment(parsed, gateway)
  if (parsed.command.join(" ") === "attachments read") return readAttachment(parsed, gateway, runtime)
  if (parsed.command.join(" ") === "attachments download") return downloadAttachment(parsed, gateway, runtime)
  if (parsed.command.join(" ") === "attachments upload") return uploadAttachment(parsed, gateway, runtime)
  return undefined
}

interface UploadSource {
  readonly path: string
  readonly filename: string
  readonly size: number
  readonly mediaType: string
  readonly sha256: string
  readonly dev: bigint
  readonly ino: bigint
  readonly mtimeNs: bigint
  readonly ctimeNs: bigint
  readonly handle: Awaited<ReturnType<typeof open>>
}

interface UploadRecovery {
  readonly version: 1
  readonly stage: "prepared" | "transferred" | "finalized"
  readonly issueId: string
  readonly issueIdentifier: string
  readonly filename: string
  readonly size: number
  readonly mediaType: string
  readonly sha256: string
  readonly title: string | null
  readonly subtitle: string | null
  readonly assetUrl: string | null
  readonly attachmentId: string | null
}

const uploadAttachment = Effect.fn("Attachments.upload")(function*(
  parsed: ParsedArgs,
  gateway: LinearGateway,
  runtime: AttachmentRuntime
) {
  return yield* Effect.acquireUseRelease(
    openUploadSource(parsed),
    (source) => Effect.gen(function*() {
      yield* requireNativeFiles()
      const issue = yield* resolveUploadIssue(readStringFlag(parsed.flags, "issue")!, gateway)
      const title = readStringFlag(parsed.flags, "title") ?? null
      const subtitle = readStringFlag(parsed.flags, "subtitle") ?? null
      const recoveryPath = resolve(runtime.stateRoot, `${uploadRecoveryKey(issue.id, source, title, subtitle)}.json`)
      return yield* Effect.acquireUseRelease(
        acquireUploadIntentLock(recoveryPath),
        () => Effect.gen(function*() {
          let recovery = yield* loadRecovery(recoveryPath)
          if (recovery && !recoveryMatches(recovery, issue, source, title, subtitle)) {
            return yield* domain("Upload recovery metadata conflicts with this file intent", "Remove only the named private recovery record after inspecting it, then retry.")
          }

          if (recovery?.stage === "finalized" && recovery.attachmentId) {
            const verified = yield* verifyUploadedAttachment(
              recovery.attachmentId, issue, source, recovery.title, recovery.subtitle, recovery.assetUrl, gateway
            )
            return uploadOutput(verified, issue, source, false, "finalized attachment verified")
          }

          if (recovery?.stage === "transferred" && recovery.assetUrl) {
            const reconciled = findRecoveredAttachment(issue.attachments, recovery.assetUrl, source, recovery.title, recovery.subtitle)
            if (reconciled) {
              const verified = yield* verifyUploadedAttachment(
                reconciled.id, issue, source, recovery.title, recovery.subtitle, recovery.assetUrl, gateway
              )
              recovery = { ...recovery, stage: "finalized", attachmentId: verified.id }
              yield* persistRecovery(recoveryPath, recovery)
              return uploadOutput(verified, issue, source, false, "finalized attachment verified")
            }
            return yield* finalizeUpload(gateway, recoveryPath, recovery, issue, source)
          }

          yield* assertSourceUnchanged(source)
          const preparedRaw = yield* gateway.callOfficialTool("prepare_attachment_upload", {
            issue: issue.id,
            filename: source.filename,
            contentType: source.mediaType,
            size: source.size,
            ...(title === null ? {} : { title }),
            ...(subtitle === null ? {} : { subtitle })
          })
          const prepared = yield* decodePreparedUpload(preparedRaw)
          recovery = {
            version: 1,
            stage: "prepared",
            issueId: issue.id,
            issueIdentifier: issue.identifier,
            filename: source.filename,
            size: source.size,
            mediaType: source.mediaType,
            sha256: source.sha256,
            title,
            subtitle,
            assetUrl: prepared.assetUrl,
            attachmentId: null
          }
          yield* persistRecovery(recoveryPath, recovery)
          yield* transferUpload(prepared, source, runtime)
          yield* assertSourceUnchanged(source)
          recovery = { ...recovery, stage: "transferred" }
          yield* persistRecovery(recoveryPath, recovery)
          return yield* finalizeUpload(gateway, recoveryPath, recovery, issue, source)
        }),
        releaseUploadIntentLock
      )
    }),
    (source) => Effect.promise(() => source.handle.close().catch(() => undefined))
  )
})

const viewAttachment = Effect.fn("Attachments.view")(function*(parsed: ParsedArgs, gateway: LinearGateway) {
  const attachment = yield* getAttachment(parsed, gateway)
  return {
    attachment: publicDetail(attachment),
    help: []
  }
})

const readAttachment = Effect.fn("Attachments.read")(function*(
  parsed: ParsedArgs,
  gateway: LinearGateway,
  runtime: AttachmentRuntime
) {
  const full = parsed.flags.get("full") === true
  if (full && parsed.flags.has("max-bytes")) return yield* usage("--full and --max-bytes are mutually exclusive", parsed)
  const limit = full ? MAX_READ_BYTES : yield* byteLimit(parsed, DEFAULT_READ_BYTES, MAX_READ_BYTES)
  const attachment = yield* getAttachment(parsed, gateway)
  if (!isTextMediaType(attachment.mediaType)) {
    return yield* domain(
      `Attachment ${attachment.id} is not an allowed textual media type`,
      `Run \`linear-axi attachments download --id=${shellQuote(attachment.id)} --output <path>\` and inspect it with an appropriate local tool.`
    )
  }
  if (full && attachment.size !== null && attachment.size > MAX_READ_BYTES) {
    return yield* domain(
      `Attachment ${attachment.id} exceeds the ${MAX_READ_BYTES}-byte full-text safety ceiling`,
      `Run \`linear-axi attachments download --id=${shellQuote(attachment.id)} --output <path>\` instead.`
    )
  }
  const response = yield* fetchContent(attachment, runtime)
  const read = yield* readBoundedResponse(response, limit, attachment.size, runtime.requestTimeoutMs)
  if (full && read.truncated) {
    return yield* domain(
      `Attachment ${attachment.id} exceeds the ${MAX_READ_BYTES}-byte full-text safety ceiling`,
      `Run \`linear-axi attachments download --id=${shellQuote(attachment.id)} --output <path>\` instead.`
    )
  }
  if (!read.truncated) yield* verifyAttachmentChecksum(digestSha256(read.bytes), attachment.sha256)
  const decoded = decodeUtf8(read.bytes, read.truncated)
  if (!decoded) {
    return yield* domain(
      `Attachment ${attachment.id} is not valid UTF-8 text`,
      `Run \`linear-axi attachments download --id=${shellQuote(attachment.id)} --output <path>\` to preserve the original bytes.`
    )
  }
  const safeText = makeTerminalSafe(decoded.text)
  const truncated = read.truncated || (attachment.size !== null && attachment.size > read.bytes.byteLength)
  return {
    attachment: {
      id: attachment.id,
      filename: terminalSafeMetadata(attachment.filename),
      mediaType: terminalSafeMetadata(attachment.mediaType),
      size: attachment.size
    },
    text: safeText,
    bytesRead: decoded.bytesRead,
    truncated,
    help: truncated && !full ? [`Run \`linear-axi attachments read --id=${shellQuote(attachment.id)} --full\` for allowed text up to ${MAX_READ_BYTES} bytes.`] : []
  }
})

const downloadAttachment = Effect.fn("Attachments.download")(function*(
  parsed: ParsedArgs,
  gateway: LinearGateway,
  runtime: AttachmentRuntime
) {
  const output = readStringFlag(parsed.flags, "output")!
  const target = yield* validateDownloadTarget(output, parsed.flags.get("overwrite") === true)
  const maxBytes = yield* byteLimit(parsed, DEFAULT_DOWNLOAD_BYTES, OFFICIAL_MAX_BYTES)
  yield* requireNativeFiles()
  const attachment = yield* getAttachment(parsed, gateway)
  if (attachment.size !== null && attachment.size > maxBytes) {
    return yield* domain(
      `Attachment ${attachment.id} is ${attachment.size} bytes, above the ${maxBytes}-byte download limit`,
      `Retry with \`--max-bytes ${attachment.size}\` if this exact size is intended.`
    )
  }
  return yield* Effect.acquireUseRelease(
    fetchContent(attachment, runtime),
    (response) => Effect.gen(function*() {
      const result = yield* writeAtomicDownload(response, target, attachment, maxBytes, runtime.requestTimeoutMs)
      return {
        attachmentId: attachment.id,
        path: target.path,
        bytes: result.bytes,
        mediaType: terminalSafeMetadata(attachment.mediaType),
        sha256: result.sha256,
        help: []
      }
    }),
    cancelResponseBody
  )
})

const getAttachment = Effect.fn("Attachments.get")(function*(parsed: ParsedArgs, gateway: LinearGateway) {
  const id = readStringFlag(parsed.flags, "id")!
  const value = yield* gateway.callOfficialTool("get_attachment", { id })
  const attachment = decodeDetail(value)
  if (!attachment || attachment.id !== id) {
    return yield* domain(
      "Official Linear MCP output shape drifted while resolving the attachment",
      `Run \`linear-axi attachments view --id=${shellQuote(id)}\` to retry the exact immutable id.`
    )
  }
  return attachment
})

const listAttachments = Effect.fn("Attachments.list")(function*(parsed: ParsedArgs, gateway: LinearGateway) {
  const selector = readStringFlag(parsed.flags, "issue")!
  const limit = readLimitFlag(parsed.flags, 100)
  const offset = yield* decodeCursor(readStringFlag(parsed.flags, "after"), selector)
  const issueRaw = yield* gateway.callOfficialTool("get_issue", { id: selector })
  let issue: IssueAttachments
  try { issue = decodeIssueAttachments(issueRaw) } catch {
    return yield* Effect.fail(new LinearDomainError({
      message: "Official Linear MCP output shape drifted while resolving the attachment issue",
      help: `Run \`linear-axi issues view --id=${shellQuote(selector)}\` to inspect the issue.`
    }))
  }
  if (!matchesIssue(issue, selector)) return yield* domain("Official Linear MCP returned a different issue", `Run \`linear-axi issues view --id=${shellQuote(selector)}\` to inspect it.`)
  const rows = issue.attachments.map((attachment) => publicSummary(toSummary(attachment)))
  if (offset > rows.length) {
    return yield* Effect.fail(new UsageError({
      message: "invalid --after cursor: attachment page is no longer available",
      help: `Run \`linear-axi attachments list --issue=${shellQuote(selector)}\` to restart pagination.`
    }))
  }
  const items = rows.slice(offset, offset + limit)
  const nextOffset = offset + items.length
  const hasNext = nextOffset < rows.length
  const identifier = Predicate.isString(issue.identifier) && issue.identifier.length > 0 ? issue.identifier : undefined
  return {
    issue: { id: issue.id, ...(identifier ? { identifier } : {}) },
    count: `${items.length} ${items.length === 1 ? "attachment" : "attachments"} shown`,
    page: { hasNext, endCursor: hasNext ? encodeCursor(selector, nextOffset) : null },
    ...(items.length === 0
      ? { attachments: `0 attachments found for ${selector}` }
      : { attachments: items }),
    help: hasNext
      ? [`Run \`linear-axi attachments list --issue=${shellQuote(selector)} --after=${shellQuote(encodeCursor(selector, nextOffset))} --limit ${limit}\` for the next page.`]
      : items.length > 0
        ? ["Run `linear-axi attachments view --id <attachment-id>` for metadata and content availability."]
        : []
  }
})

const toSummary = (value: AttachmentWire): AttachmentSummary => {
  return {
    id: value.id,
    filename: firstString(value.filename, value.name),
    title: firstString(value.title),
    mediaType: firstString(value.contentType, value.mediaType, value.mimeType),
    size: firstNumber(value.size, value.byteSize),
    createdAt: firstString(value.createdAt),
    updatedAt: firstString(value.updatedAt)
  }
}

const decodeDetail = (value: unknown): AttachmentDetail | undefined => {
  let attachment: AttachmentWire
  try { attachment = decodeAttachmentWire(value) } catch { return undefined }
  const summary = toSummary(attachment)
  const request = attachment.downloadRequest
    ? attachment.downloadRequest
    : attachment.contentRequest
      ? attachment.contentRequest
      : undefined
  const contentUrl = firstString(
    request?.url,
    attachment.downloadUrl,
    attachment.contentUrl,
    attachment.assetUrl,
    attachment.url
  )
  const issue = attachment.issue
    ? { id: attachment.issue.id, ...(Predicate.isString(attachment.issue.identifier) && attachment.issue.identifier.length > 0 ? { identifier: attachment.issue.identifier } : {}) }
    : null
  return {
    ...summary,
    subtitle: firstString(attachment.subtitle),
    issue,
    contentUrl,
    assetUrl: firstString(attachment.assetUrl, attachment.url),
    headers: decodeHeaders(request?.headers),
    sha256: firstString(attachment.sha256, attachment.checksum)?.toLowerCase() ?? null
  }
}

const publicSummary = (attachment: AttachmentSummary): AttachmentSummary => ({
  ...attachment,
  filename: terminalSafeMetadata(attachment.filename),
  title: terminalSafeMetadata(attachment.title),
  mediaType: terminalSafeMetadata(attachment.mediaType)
})

const publicDetail = (attachment: AttachmentDetail) => {
  const contentAvailable = isLinearDownloadUrl(attachment.contentUrl)
  return {
    id: attachment.id,
    filename: terminalSafeMetadata(attachment.filename),
    title: terminalSafeMetadata(attachment.title),
    subtitle: terminalSafeMetadata(attachment.subtitle),
    mediaType: terminalSafeMetadata(attachment.mediaType),
    size: attachment.size,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
    issue: attachment.issue,
    content: {
      available: contentAvailable,
      transport: contentAvailable ? "authenticated-signed-https" : "unavailable"
    }
  }
}

const isLinearDownloadUrl = (value: string | null): boolean => {
  if (value === null) return false
  try {
    decodeLinearDownloadUrl(value)
    return true
  } catch {
    return false
  }
}

const decodeHeaders = (value: unknown): Readonly<Record<string, string>> => {
  let headers: HeadersWire
  try { headers = decodeHeadersWire(value) } catch { return {} }
  return Array.isArray(headers)
    ? Object.fromEntries(headers.map((entry) => [entry.key, entry.value]))
    : headers as Readonly<Record<string, string>>
}

const isTextMediaType = (value: string | null): boolean => {
  if (value === null) return false
  const [mediaType, ...parameters] = value.toLowerCase().split(";").map((part) => part.trim())
  const allowed = mediaType === "application/json" || mediaType === "application/xml" ||
    mediaType === "application/yaml" || mediaType === "application/x-yaml" ||
    mediaType === "application/toml" || mediaType === "application/javascript" ||
    mediaType === "application/sql" || mediaType === "image/svg+xml" ||
    mediaType?.startsWith("text/") === true
  if (!allowed) return false
  const charset = parameters.find((parameter) => parameter.startsWith("charset="))
  return charset === undefined || charset === "charset=utf-8" || charset === "charset=utf8"
}

const makeTerminalSafe = (value: string): string => {
  let output = ""
  for (const character of value) {
    const code = character.codePointAt(0)!
    if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) ||
      code === 127 || (code >= 128 && code <= 159) || code === 0x061c || code === 0x200e || code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) {
      output += `\\u${code.toString(16).padStart(4, "0")}`
    } else if (code === 13) {
      output += "\\r"
    } else {
      output += character
    }
  }
  return output
}

const terminalSafeMetadata = (value: string | null): string | null => value === null ? null : makeTerminalSafe(value)

const digestSha256 = (bytes: Uint8Array): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex")

const verifyAttachmentChecksum = Effect.fn("Attachments.verifyChecksum")(function*(actual: string, expected: string | null) {
  if (expected !== null && actual !== expected) {
    return yield* domain("Attachment checksum verification failed", "Do not use the content; retry the attachment command.")
  }
})

const decodeUtf8 = (bytes: Uint8Array, truncated: boolean): { readonly text: string; readonly bytesRead: number } | null => {
  const incompleteSuffix = truncated ? incompleteUtf8SuffixLength(bytes) : 0
  const candidate = bytes.subarray(0, bytes.byteLength - incompleteSuffix)
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(candidate), bytesRead: candidate.byteLength }
  } catch {
    return null
  }
}

const incompleteUtf8SuffixLength = (bytes: Uint8Array): number => {
  if (bytes.byteLength === 0) return 0
  let leadIndex = bytes.byteLength - 1
  while (leadIndex >= 0 && leadIndex >= bytes.byteLength - 4 && (bytes[leadIndex]! & 0xc0) === 0x80) leadIndex -= 1
  if (leadIndex < 0 || leadIndex < bytes.byteLength - 4) return 0
  const lead = bytes[leadIndex]!
  const expected = lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 0
  const present = bytes.byteLength - leadIndex
  if (expected === 0 || present >= expected) return 0
  for (let index = leadIndex + 1; index < bytes.byteLength; index += 1) {
    if ((bytes[index]! & 0xc0) !== 0x80) return 0
  }
  if (present >= 2) {
    const second = bytes[leadIndex + 1]!
    if ((lead === 0xe0 && second < 0xa0) || (lead === 0xed && second > 0x9f) ||
      (lead === 0xf0 && second < 0x90) || (lead === 0xf4 && second > 0x8f)) return 0
  }
  return present
}

const fetchContent = Effect.fn("Attachments.fetchContent")(function*(attachment: AttachmentDetail, runtime: AttachmentRuntime) {
  if (attachment.contentUrl === null) {
    return yield* domain(
      `Attachment ${attachment.id} has no downloadable content`,
      "Use `linear-axi attachments view --id <attachment-id>` to inspect its metadata."
    )
  }
  let url = yield* safeAssetUrl(attachment.contentUrl)
  let headers = yield* safeRequestHeaders(attachment.headers)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), runtime.requestTimeoutMs)
    const response = yield* Effect.tryPromise({
      try: () => abortablePromise(runtime.fetcher(url, { method: "GET", headers, redirect: "manual", signal: controller.signal }), controller.signal),
      catch: () => new LinearDomainError({
        message: `Attachment ${attachment.id} download request failed`,
        help: "Check network access and retry the same attachment command."
      })
    }).pipe(Effect.ensuring(Effect.sync(() => clearTimeout(timeout))))
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => undefined)
        return yield* domain(
          `Attachment ${attachment.id} download returned HTTP ${response.status}`,
          "Retry the command to request fresh authenticated content metadata."
        )
      }
      return response
    }
    void response.body?.cancel().catch(() => undefined)
    const location = response.headers.get("location")
    if (location === null || redirects === 3) {
      return yield* domain(
        `Attachment ${attachment.id} download redirect was invalid or exceeded the safety limit`,
        "Retry the command to request fresh authenticated content metadata."
      )
    }
    url = yield* safeRedirectUrl(location, url)
    headers = {}
  }
  return yield* domain(`Attachment ${attachment.id} download exceeded the redirect safety limit`, "Retry the command.")
})

const safeAssetUrl = Effect.fn("Attachments.safeAssetUrl")(function*(raw: string) {
  return yield* Effect.try({
    try: () => decodeLinearDownloadUrl(raw),
    catch: () => new LinearDomainError({
      message: "Linear returned an unsafe attachment content location",
      help: "Retry the command and do not supply or substitute a download URL."
    })
  })
})

const safeRedirectUrl = Effect.fn("Attachments.safeRedirectUrl")(function*(raw: string, current: string) {
  return yield* Effect.try({
    try: () => decodeLinearDownloadUrl(new URL(raw, current).toString()),
    catch: () => new LinearDomainError({
      message: "Attachment download refused a non-HTTPS redirect or an untrusted redirect origin",
      help: "Retry the command to request fresh authenticated content metadata."
    })
  })
})

const safeRequestHeaders = Effect.fn("Attachments.safeRequestHeaders")(function*(headers: Readonly<Record<string, string>>) {
  const forbidden = Object.keys(headers).find((key) => ["authorization", "cookie", "proxy-authorization"].includes(key.toLowerCase()))
  if (forbidden) return yield* domain("Linear returned forbidden credentials for the separate attachment host", "Retry the command and do not forward Linear authentication to asset storage.")
  return { ...headers }
})

const cancelResponseBody = Effect.fn("Attachments.cancelResponseBody")(function*(response: Response) {
  yield* Effect.promise(async () => {
    try { await response.body?.cancel() } catch {}
  })
})

const readBoundedResponse = Effect.fn("Attachments.readBounded")(function*(
  response: Response,
  limit: number,
  expectedSize: number | null,
  timeoutMs: number
) {
  if (!response.body) {
    if (expectedSize !== null && expectedSize > 0) {
      return yield* domain("Attachment content length did not match its metadata", "Retry the command to request fresh attachment metadata.")
    }
    return { bytes: new Uint8Array(), truncated: false }
  }
  const reader = response.body.getReader()
  const chunks: Array<Uint8Array> = []
  let total = 0
  let truncated = false
  try {
    while (true) {
      const next = yield* Effect.tryPromise({
        try: () => readWithTimeout(reader, timeoutMs),
        catch: () => new LinearDomainError({ message: "Attachment content stream failed", help: "Retry the same command." })
      })
      if (next.done) break
      if (expectedSize !== null && total + next.value.byteLength > expectedSize) {
        void reader.cancel().catch(() => undefined)
        return yield* domain("Attachment content exceeded its metadata size", "Retry the command to request fresh attachment metadata.")
      }
      const remaining = limit - total
      if (next.value.byteLength > remaining) {
        if (remaining > 0) chunks.push(next.value.subarray(0, remaining))
        total += Math.max(remaining, 0)
        truncated = true
        void reader.cancel().catch(() => undefined)
        break
      }
      chunks.push(next.value)
      total += next.value.byteLength
      if (total === limit && expectedSize !== null && expectedSize > total) {
        truncated = true
        void reader.cancel().catch(() => undefined)
        break
      }
    }
  } finally {
    try { reader.releaseLock() } catch {}
  }
  if (!truncated && expectedSize !== null && total !== expectedSize) {
    return yield* domain("Attachment content length did not match its metadata", "Retry the command to request fresh attachment metadata.")
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, truncated }
})

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  yaml: "application/yaml", yml: "application/yaml", xml: "application/xml", toml: "application/toml",
  js: "application/javascript", mjs: "application/javascript", ts: "text/typescript", tsx: "text/tsx",
  html: "text/html", css: "text/css", sql: "application/sql", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf", zip: "application/zip", gz: "application/gzip", mp4: "video/mp4", mov: "video/quicktime"
}
const SUPPORTED_MEDIA_TYPES = new Set(Object.values(MIME_BY_EXTENSION))

const openUploadSource = Effect.fn("Attachments.openUploadSource")(function*(parsed: ParsedArgs) {
  const raw = readStringFlag(parsed.flags, "file")!
  if (raw.includes("\0")) return yield* usage("--file contains a NUL byte", parsed)
  const path = resolve(raw)
  const link = yield* Effect.tryPromise({
    try: () => lstat(path, { bigint: true }),
    catch: () => new UsageError({ message: "--file does not exist or is a broken link", help: "Pass an explicit existing local regular file." })
  })
  if (!link.isFile() || link.isSymbolicLink()) return yield* usage("--file must be an explicit local regular file, not a directory, link, device, FIFO, or socket", parsed)
  const handle = yield* Effect.tryPromise({
    try: () => open(path, constants.O_RDONLY | constants.O_NOFOLLOW),
    catch: () => new UsageError({ message: "--file could not be opened safely as a regular file", help: "Pass an explicit non-symlink local file." })
  })
  const metadata = yield* Effect.tryPromise({
    try: () => handle.stat({ bigint: true }),
    catch: () => new UsageError({ message: "--file metadata could not be read", help: "Check the file and retry." })
  })
  if (!metadata.isFile() || metadata.dev !== link.dev || metadata.ino !== link.ino) {
    yield* Effect.promise(() => handle.close().catch(() => undefined))
    return yield* usage("--file changed while it was being opened safely", parsed)
  }
  const size = Number(metadata.size)
  const allowLarge = parsed.flags.get("allow-large") === true
  const defaultMax = 100 * 1024 * 1024
  if (!Number.isSafeInteger(size) || size <= 0 || size > OFFICIAL_MAX_BYTES || (!allowLarge && size > defaultMax)) {
    yield* Effect.promise(() => handle.close().catch(() => undefined))
    const help = size > defaultMax && size <= OFFICIAL_MAX_BYTES
      ? "Retry with --allow-large only if this exact large file is intended."
      : `Linear requires a non-empty file smaller than ${OFFICIAL_MAX_BYTES + 1} bytes.`
    return yield* Effect.fail(new UsageError({ message: `--file size ${size} is outside the allowed upload bound`, help }))
  }
  const filename = basename(path)
  const override = readStringFlag(parsed.flags, "media-type")
  const extension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase() : ""
  const mediaType = override ?? MIME_BY_EXTENSION[extension]
  if (!mediaType || !SUPPORTED_MEDIA_TYPES.has(mediaType.toLowerCase())) {
    yield* Effect.promise(() => handle.close().catch(() => undefined))
    return yield* usage("--file has an unknown or unsupported media type", parsed)
  }
  if (override && !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(override)) {
    yield* Effect.promise(() => handle.close().catch(() => undefined))
    return yield* usage("--media-type must be a supported MIME type without parameters", parsed)
  }
  const hasher = new Bun.CryptoHasher("sha256")
  const buffer = new Uint8Array(64 * 1024)
  let offset = 0
  while (offset < size) {
    const read = yield* Effect.tryPromise({
      try: () => handle.read(buffer, 0, Math.min(buffer.byteLength, size - offset), offset),
      catch: () => new UsageError({ message: "--file could not be read safely", help: "Check the file and retry." })
    })
    if (read.bytesRead === 0) {
      yield* Effect.promise(() => handle.close().catch(() => undefined))
      return yield* usage("--file was truncated while hashing", parsed)
    }
    hasher.update(buffer.subarray(0, read.bytesRead))
    offset += read.bytesRead
  }
  const source: UploadSource = {
    path, filename, size, mediaType: mediaType.toLowerCase(), sha256: hasher.digest("hex"),
    dev: metadata.dev, ino: metadata.ino, mtimeNs: metadata.mtimeNs, ctimeNs: metadata.ctimeNs, handle
  }
  yield* assertSourceUnchanged(source)
  return source
})

const assertSourceUnchanged = Effect.fn("Attachments.assertSourceUnchanged")(function*(source: UploadSource) {
  const current = yield* Effect.tryPromise({
    try: () => source.handle.stat({ bigint: true }),
    catch: () => new UsageError({ message: "--file became unavailable during upload", help: "Retry with a stable regular file." })
  })
  if (!current.isFile() || Number(current.size) !== source.size || current.dev !== source.dev ||
    current.ino !== source.ino || current.mtimeNs !== source.mtimeNs || current.ctimeNs !== source.ctimeNs) {
    return yield* Effect.fail(new UsageError({ message: "--file changed during upload", help: "Retry only after the source file is stable." }))
  }
})

const resolveUploadIssue = Effect.fn("Attachments.resolveUploadIssue")(function*(selector: string, gateway: LinearGateway) {
  const value = yield* gateway.callOfficialTool("get_issue", { id: selector })
  let issue: IssueAttachments
  try { issue = decodeIssueAttachments(value) } catch {
    return yield* domain("Official Linear MCP output shape drifted while resolving the upload issue", `Run \`linear-axi issues view --id=${shellQuote(selector)} --full\` to inspect it.`)
  }
  if (!Predicate.isString(issue.identifier) || issue.identifier.length === 0 || !matchesIssue(issue, selector)) {
    return yield* domain("Official Linear MCP returned a different upload issue", `Run \`linear-axi issues view --id=${shellQuote(selector)} --full\` to inspect it.`)
  }
  return { id: issue.id, identifier: issue.identifier, attachments: issue.attachments }
})

const uploadRecoveryKey = (
  issueId: string,
  source: UploadSource,
  title: string | null,
  subtitle: string | null
): string => new Bun.CryptoHasher("sha256").update(JSON.stringify({ issueId, sha256: source.sha256, mediaType: source.mediaType, title, subtitle })).digest("hex")

const loadRecovery = Effect.fn("Attachments.loadRecovery")(function*(path: string) {
  return yield* Effect.tryPromise({
    try: async () => {
      try {
        const metadata = await lstat(path)
        if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("unsafe recovery file")
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
        let text: string
        try { text = await handle.readFile("utf8") } finally { await handle.close() }
        return decodeUploadRecovery(JSON.parse(text)) as UploadRecovery
      } catch (cause) {
        if (Predicate.hasProperty(cause, "code") && cause.code === "ENOENT") return null
        throw cause
      }
    },
    catch: () => new LinearDomainError({ message: "Private upload recovery metadata is unreadable or invalid", help: "Inspect the recovery directory permissions before retrying." })
  })
})

const recoveryMatches = (
  recovery: UploadRecovery,
  issue: { readonly id: string; readonly identifier: string },
  source: UploadSource,
  title: string | null,
  subtitle: string | null
): boolean => recovery.issueId === issue.id && recovery.issueIdentifier === issue.identifier &&
  recovery.filename === source.filename && recovery.size === source.size && recovery.mediaType === source.mediaType &&
  recovery.sha256 === source.sha256 && recovery.title === title && recovery.subtitle === subtitle

interface UploadIntentLock {
  readonly handle: Awaited<ReturnType<typeof open>>
}

const ensureRecoveryDirectory = Effect.fn("Attachments.ensureRecoveryDirectory")(function*(parent: string) {
  yield* Effect.tryPromise({
    try: async () => {
      await mkdir(parent, { recursive: true, mode: 0o700 })
      if ((await realpath(parent)) !== resolve(parent) || (await lstat(parent)).isSymbolicLink()) throw new Error("unsafe recovery directory")
      await chmod(parent, 0o700)
    },
    catch: () => new LinearDomainError({ message: "Could not create the private upload recovery directory", help: "Check state-directory permissions and retry." })
  })
})

const acquireUploadIntentLock = Effect.fn("Attachments.acquireUploadIntentLock")(function*(recoveryPath: string) {
  const parent = dirname(recoveryPath)
  const path = `${recoveryPath}.lock`
  yield* ensureRecoveryDirectory(parent)
  const handle = yield* Effect.tryPromise({
    try: () => open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600),
    catch: () => new LinearDomainError({ message: "Could not open private upload recovery ownership", help: "Check state-directory permissions and retry." })
  })
  const safe = yield* Effect.promise(async () => {
    try {
      const [opened, current] = await Promise.all([handle.stat({ bigint: true }), lstat(path, { bigint: true })])
      return opened.isFile() && !current.isSymbolicLink() && opened.dev === current.dev && opened.ino === current.ino
    } catch {
      return false
    }
  })
  if (!safe) {
    yield* Effect.promise(() => handle.close().catch(() => undefined))
    return yield* domain("Private upload recovery ownership changed while opening", "Inspect the private recovery directory before retrying.")
  }
  if (!tryLockFileDescriptor(handle.fd)) {
    yield* Effect.promise(() => handle.close().catch(() => undefined))
    return yield* domain("An identical attachment upload is already in progress", "Wait for the active upload to finish, then retry the same command.")
  }
  return { handle } satisfies UploadIntentLock
})

const releaseUploadIntentLock = Effect.fn("Attachments.releaseUploadIntentLock")(function*(lock: UploadIntentLock) {
  yield* Effect.sync(() => {
    try { unlockFileDescriptor(lock.handle.fd) } catch {}
  })
  yield* Effect.promise(() => lock.handle.close().catch(() => undefined))
})

const persistRecovery = Effect.fn("Attachments.persistRecovery")(function*(path: string, recovery: UploadRecovery) {
  const parent = dirname(path)
  yield* ensureRecoveryDirectory(parent)
  const temp = resolve(parent, `.${basename(path)}.${randomUUID()}.tmp`)
  const handle = yield* Effect.tryPromise({
    try: () => open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600),
    catch: () => new LinearDomainError({ message: "Could not create private upload recovery metadata", help: "Check state-directory permissions and retry." })
  })
  let installed = false
  try {
    yield* Effect.tryPromise({
      try: async () => { await handle.writeFile(JSON.stringify(recovery), "utf8"); await handle.sync() },
      catch: () => new LinearDomainError({ message: "Could not persist upload recovery metadata", help: "Check state-directory disk space and retry." })
    })
    yield* Effect.tryPromise({
      try: () => rename(temp, path),
      catch: () => new LinearDomainError({ message: "Could not atomically install upload recovery metadata", help: "Check state-directory permissions and retry." })
    })
    installed = true
    yield* syncDirectory(parent)
  } finally {
    yield* Effect.promise(() => handle.close().catch(() => undefined))
    if (!installed) yield* Effect.promise(() => unlink(temp).catch(() => undefined))
  }
})

interface PreparedUpload {
  readonly assetUrl: string
  readonly uploadUrl: string
  readonly headers: Readonly<Record<string, string>>
}

const decodePreparedUpload = Effect.fn("Attachments.decodePreparedUpload")(function*(value: unknown) {
  let prepared: PreparedUploadWire
  try { prepared = decodePreparedUploadWire(value) } catch {
    return yield* domain("Linear returned an unsafe or malformed prepared upload request", "Retry the upload from the same explicit file intent.")
  }
  const assetUrl = prepared.assetUrl
  const uploadUrl = prepared.uploadRequest.url
  const headers = decodeHeaders(prepared.uploadRequest.headers)
  if (Object.keys(headers).length === 0) {
    return yield* domain("Linear returned an unsafe or incomplete upload request", "Retry the upload and do not substitute an upload URL or headers.")
  }
  const safeHeaders = yield* safeRequestHeaders(headers)
  return { assetUrl, uploadUrl, headers: safeHeaders }
})

interface HashedUploadBody {
  readonly body: ReadableStream<Uint8Array>
  readonly sha256: Promise<string>
  readonly destroy: () => void
}

const hashedUploadBody = (source: UploadSource): HashedUploadBody => {
  const stream = createReadStream("", { fd: source.handle.fd, start: 0, end: source.size - 1, autoClose: false })
  const hasher = new Bun.CryptoHasher("sha256")
  let settled = false
  let resolveSha256!: (value: string) => void
  let rejectSha256!: (cause: unknown) => void
  const sha256 = new Promise<string>((resolvePromise, rejectPromise) => {
    resolveSha256 = resolvePromise
    rejectSha256 = rejectPromise
  })
  const settle = (continuation: () => void) => {
    if (settled) return
    settled = true
    continuation()
  }
  const body = (Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>).pipeThrough(new TransformStream({
    transform(chunk, controller) {
      hasher.update(chunk)
      controller.enqueue(chunk)
    },
    flush() {
      settle(() => resolveSha256(hasher.digest("hex")))
    }
  }))
  stream.once("error", (cause) => settle(() => rejectSha256(cause)))
  stream.once("close", () => {
    if (!stream.readableEnded) settle(() => rejectSha256(new Error("upload source stream closed before completion")))
  })
  void sha256.catch(() => undefined)
  return { body, sha256, destroy: () => stream.destroy() }
}

const transferUpload = Effect.fn("Attachments.transferUpload")(function*(prepared: PreparedUpload, source: UploadSource, runtime: AttachmentRuntime) {
  const headers = yield* uploadRequestHeaders(prepared.headers, source.size)
  let url = prepared.uploadUrl
  for (let redirects = 0; redirects <= 2; redirects += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), runtime.requestTimeoutMs)
    const upload = hashedUploadBody(source)
    const transferred = yield* Effect.tryPromise({
      try: async () => {
        const response = await abortablePromise(runtime.fetcher(url, {
          method: "PUT",
          headers,
          body: upload.body,
          redirect: "manual",
          signal: controller.signal,
          duplex: "half"
        } as RequestInit), controller.signal)
        if (!response.ok || [307, 308].includes(response.status)) return { response, sha256: null }
        return { response, sha256: await abortablePromise(upload.sha256, controller.signal) }
      },
      catch: () => new LinearDomainError({
        message: "Direct attachment byte transfer failed",
        help: "Retry the same upload command; it will safely prepare a fresh signed request."
      })
    }).pipe(
      Effect.onError(() => Effect.sync(upload.destroy)),
      Effect.ensuring(Effect.sync(() => clearTimeout(timeout)))
    )
    const response = transferred.response
    if (![307, 308].includes(response.status)) {
      void response.body?.cancel().catch(() => undefined)
      if (!response.ok) {
        upload.destroy()
        return yield* domain(`Direct attachment byte transfer returned HTTP ${response.status}`, "Retry the same upload command; it will safely prepare a fresh signed request.")
      }
      if (transferred.sha256 !== source.sha256) {
        upload.destroy()
        return yield* domain("Upload source bytes changed during transfer", "Retry only after the source file is stable.")
      }
      return
    }
    upload.destroy()
    void response.body?.cancel().catch(() => undefined)
    const location = response.headers.get("location")
    if (!location || redirects === 2) {
      return yield* domain("Direct attachment upload redirect was invalid or exceeded the safety limit", "Retry the same upload command.")
    }
    let redirected: string
    try { redirected = decodeLinearUploadUrl(new URL(location, url).toString()) } catch {
      return yield* domain("Direct attachment upload refused an unsafe cross-origin redirect", "Retry the same upload command; never substitute an upload URL.")
    }
    if (new URL(redirected).origin !== new URL(url).origin) {
      return yield* domain("Direct attachment upload refused an unsafe cross-origin redirect", "Retry the same upload command; never substitute an upload URL.")
    }
    url = redirected
  }
})

const uploadRequestHeaders = Effect.fn("Attachments.uploadRequestHeaders")(function*(
  headers: Readonly<Record<string, string>>,
  size: number
) {
  const expected = String(size)
  const contentLengths = Object.entries(headers).filter(([key]) => key.toLowerCase() === "content-length")
  if (contentLengths.some(([, value]) => value !== expected)) {
    return yield* domain("Linear returned an upload request with an invalid content length", "Retry the same upload command to prepare a fresh signed request.")
  }
  return contentLengths.length > 0 ? headers : { ...headers, "Content-Length": expected }
})

const finalizeUpload = Effect.fn("Attachments.finalizeUpload")(function*(
  gateway: LinearGateway,
  recoveryPath: string,
  recovery: UploadRecovery,
  issue: { readonly id: string; readonly identifier: string },
  source: UploadSource
) {
  if (!recovery.assetUrl) return yield* domain("Upload recovery metadata has no transferred asset identity", "Retry the same upload command to prepare a fresh transfer.")
  const result = yield* gateway.callOfficialTool("create_attachment_from_upload", {
    issue: issue.id,
    assetUrl: recovery.assetUrl,
    ...(recovery.title === null ? {} : { title: recovery.title }),
    ...(recovery.subtitle === null ? {} : { subtitle: recovery.subtitle })
  }).pipe(Effect.mapError(() => new LinearApiError({
    message: "Attachment finalize response was lost or failed after dispatch; mutation outcome is unknown",
    help: `Retry \`linear-axi attachments upload --issue=${shellQuote(issue.identifier)} --file <same-file>\`; recovery will verify before finalizing again.`
  })))
  let finalized: FinalizedUploadWire | undefined
  try { finalized = decodeFinalizedUpload(result) } catch {}
  const attachmentId = finalized && "id" in finalized ? finalized.id : finalized?.attachment.id ?? null
  if (!attachmentId) {
    return yield* domain("Official Linear MCP output shape drifted after attachment finalize", `Retry the same upload command; recovery will inspect ${issue.identifier} before another finalize.`)
  }
  const verified = yield* verifyUploadedAttachment(
    attachmentId, issue, source, recovery.title, recovery.subtitle, recovery.assetUrl, gateway
  )
  yield* persistRecovery(recoveryPath, { ...recovery, stage: "finalized", attachmentId })
  return uploadOutput(verified, issue, source, true, "attachment uploaded and verified")
})

const findRecoveredAttachment = (
  attachments: ReadonlyArray<AttachmentWire>,
  assetUrl: string,
  source: UploadSource,
  title: string | null,
  subtitle: string | null
): { readonly id: string } | null => {
  const match = attachments.find((attachment) =>
    firstString(attachment.assetUrl, attachment.url, attachment.downloadUrl) === assetUrl &&
    (firstString(attachment.filename, attachment.name) === null || firstString(attachment.filename, attachment.name) === source.filename) &&
    (title === null || firstString(attachment.title) === title) &&
    (subtitle === null || firstString(attachment.subtitle) === subtitle))
  return match ? { id: match.id } : null
}

const verifyUploadedAttachment = Effect.fn("Attachments.verifyUploadedAttachment")(function*(
  attachmentId: string,
  issue: { readonly id: string; readonly identifier: string },
  source: UploadSource,
  title: string | null,
  subtitle: string | null,
  assetUrl: string | null,
  gateway: LinearGateway
) {
  const detail = decodeDetail(yield* gateway.callOfficialTool("get_attachment", { id: attachmentId }))
  const sameIssue = detail?.issue?.id === issue.id || detail?.issue?.identifier === issue.identifier
  const sameFilename = detail?.filename === source.filename
  const sameTitle = title === null || detail?.title === title
  const sameSubtitle = subtitle === null || detail?.subtitle === subtitle
  const sameSize = detail?.size === source.size
  const sameType = detail?.mediaType?.split(";", 1)[0]?.trim().toLowerCase() === source.mediaType
  const sameChecksum = detail?.sha256 === null || detail?.sha256 === source.sha256
  const sameAsset = assetUrl === null || detail?.assetUrl === assetUrl
  if (!detail || detail.id !== attachmentId || !sameIssue || !sameFilename || !sameTitle || !sameSubtitle || !sameSize || !sameType || !sameChecksum || !sameAsset) {
    return yield* domain("Finalized attachment verification did not match the upload intent", `Run \`linear-axi attachments view --id=${shellQuote(attachmentId)}\` and do not repeat finalize blindly.`)
  }
  return detail
})

const uploadOutput = (
  attachment: AttachmentDetail,
  issue: { readonly id: string; readonly identifier: string },
  source: UploadSource,
  changed: boolean,
  recovery: string
) => ({
  attachmentId: attachment.id,
  issue: { id: issue.id, identifier: issue.identifier },
  filename: makeTerminalSafe(source.filename),
  bytes: source.size,
  mediaType: source.mediaType,
  sha256: source.sha256,
  changed,
  recovery,
  help: []
})

const matchesIssue = (issue: { readonly id: string; readonly identifier?: string | null }, selector: string): boolean =>
  [issue.id, issue.identifier].some((value) => Predicate.isString(value) && value.toLowerCase() === selector.toLowerCase())

const firstString = (...values: ReadonlyArray<unknown>): string | null =>
  values.find((value): value is string => Predicate.isString(value) && value.length > 0) ?? null

const firstNumber = (...values: ReadonlyArray<unknown>): number | null =>
  values.find((value): value is number => Predicate.isNumber(value) && Number.isSafeInteger(value) && value >= 0) ?? null

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`

const encodeCursor = (issue: string, offset: number): string =>
  `att1.${Buffer.from(JSON.stringify({ issue, offset }), "utf8").toString("base64url")}`

const decodeCursor = Effect.fn("Attachments.decodeCursor")(function*(
  cursor: string | undefined,
  issue: string
): Effect.fn.Return<number, UsageError> {
  return yield* Effect.try({
    try: () => {
      if (cursor === undefined) return 0
      if (!cursor.startsWith("att1.")) throw new Error("prefix")
      const value = decodeAttachmentCursor(JSON.parse(Buffer.from(cursor.slice(5), "base64url").toString("utf8")))
      if (value.issue !== issue) {
        throw new Error("shape")
      }
      return value.offset
    },
    catch: () => new UsageError({
      message: "invalid --after cursor for attachments list",
      help: `Run \`linear-axi attachments list --issue=${shellQuote(issue)}\` to restart pagination.`
    })
  })
})

interface DownloadTarget {
  readonly path: string
  readonly parent: string
  readonly parentIdentity: NativeFileIdentity
}

const validateDownloadTarget = Effect.fn("Attachments.validateDownloadTarget")(function*(raw: string, overwrite: boolean) {
  if (raw.includes("\0")) return yield* domain("--output contains a NUL byte", "Choose a regular local destination path.")
  const path = resolve(raw)
  const parentInput = dirname(path)
  const parent = yield* Effect.tryPromise({
    try: () => realpath(parentInput),
    catch: () => new UsageError({ message: "--output parent directory does not exist", help: "Create the destination directory first." })
  })
  if (resolve(parent, basename(path)) !== path) {
    return yield* usage("--output parent resolves through a symlink outside the requested path", {
      command: ["attachments", "download"]
    })
  }
  const parentMetadata = yield* Effect.tryPromise({
    try: () => lstat(parent, { bigint: true }),
    catch: () => new UsageError({ message: "--output parent directory became unavailable", help: "Choose a stable destination directory." })
  })
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
    return yield* usage("--output parent must be a local directory", { command: ["attachments", "download"] })
  }
  const existing = yield* Effect.promise(() => lstat(path).catch(() => undefined))
  if (existing && !overwrite) {
    return yield* usage("destination already exists; pass --overwrite to replace this exact regular file", {
      command: ["attachments", "download"]
    })
  }
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    return yield* usage("--overwrite may replace only an existing regular file", {
      command: ["attachments", "download"]
    })
  }
  if (existing) {
    return yield* domain(
      "Safe atomic conditional overwrite is unavailable",
      "Choose a new output path, or remove the existing file after inspecting it and retry without --overwrite."
    )
  }
  return {
    path,
    parent,
    parentIdentity: { dev: parentMetadata.dev, ino: parentMetadata.ino }
  } satisfies DownloadTarget
})

const writeAtomicDownload = Effect.fn("Attachments.writeAtomicDownload")(function*(
  response: Response,
  target: DownloadTarget,
  attachment: AttachmentDetail,
  maxBytes: number,
  timeoutMs: number
) {
  const acquireParent = Effect.tryPromise({
    try: () => open(target.parent, constants.O_RDONLY | constants.O_NOFOLLOW),
    catch: () => new LinearDomainError({ message: "Could not pin the destination directory", help: "Inspect the destination path and retry." })
  })
  return yield* Effect.acquireUseRelease(
    acquireParent,
    (parentHandle) => Effect.gen(function*() {
      const opened = yield* Effect.tryPromise({
        try: () => parentHandle.stat({ bigint: true }),
        catch: () => new LinearDomainError({ message: "Could not inspect the pinned destination directory", help: "Inspect the destination path and retry." })
      })
      if (!opened.isDirectory() || opened.dev !== target.parentIdentity.dev || opened.ino !== target.parentIdentity.ino) {
        return yield* domain("Destination directory changed before download; refusing unsafe install", "Inspect the destination path and retry explicitly.")
      }
      return yield* writeAtomicDownloadPinned(response, target, attachment, maxBytes, timeoutMs, parentHandle)
    }),
    (parentHandle) => Effect.promise(() => parentHandle.close().catch(() => undefined))
  )
})

const writeAtomicDownloadPinned = Effect.fn("Attachments.writeAtomicDownloadPinned")(function*(
  response: Response,
  target: DownloadTarget,
  attachment: AttachmentDetail,
  maxBytes: number,
  timeoutMs: number,
  parentHandle: Awaited<ReturnType<typeof open>>
) {
  const destination = basename(target.path)
  const temp = `.linear-axi-${randomUUID()}.partial`
  const acquire = Effect.try({
    try: () => {
      const opened = createPrivateFileAt(parentHandle.fd, temp)
      if (opened < 0) throw new Error("openat failed")
      return opened
    },
    catch: () => new LinearDomainError({ message: "Could not create a private temporary download file", help: "Check destination directory permissions and retry." })
  })
  let installed = false
  return yield* Effect.acquireUseRelease(acquire, (fd) => Effect.gen(function*() {
    const reader = response.body?.getReader()
    const hasher = new Bun.CryptoHasher("sha256")
    let bytes = 0
    if (reader) {
      try {
        while (true) {
          const next = yield* Effect.tryPromise({
            try: () => readWithTimeout(reader, timeoutMs),
            catch: () => new LinearDomainError({ message: "Attachment download stream failed", help: "Retry the same command." })
          })
          if (next.done) break
          bytes += next.value.byteLength
          if (bytes > maxBytes || (attachment.size !== null && bytes > attachment.size)) {
            void reader.cancel().catch(() => undefined)
            return yield* domain("Attachment download exceeded its declared safety bound", "Retry with fresh metadata or a larger explicit --max-bytes value.")
          }
          hasher.update(next.value)
          yield* Effect.try({
            try: () => writeFileDescriptor(fd, next.value),
            catch: () => new LinearDomainError({ message: "Writing the attachment destination failed", help: "Check available disk space and retry." })
          })
        }
      } finally {
        try { reader.releaseLock() } catch {}
      }
    }
    if (attachment.size !== null && bytes !== attachment.size) {
      return yield* domain("Attachment download was truncated", "Retry the command to request fresh attachment metadata.")
    }
    const sha256 = hasher.digest("hex")
    yield* verifyAttachmentChecksum(sha256, attachment.sha256)
    if (!syncFileDescriptor(fd)) {
      return yield* domain("Could not fsync the downloaded attachment", "Check the destination filesystem and retry.")
    }
    const stagedIdentity = yield* Effect.try({
      try: () => {
        const metadata = fstatSync(fd, { bigint: true })
        return { dev: metadata.dev, ino: metadata.ino } satisfies NativeFileIdentity
      },
      catch: () => new LinearDomainError({
        message: "Could not verify the private downloaded attachment",
        help: "Check the destination filesystem and retry."
      })
    })
    yield* verifyDownloadParentUnchanged(target)
    yield* installAtomicDownload(parentHandle.fd, temp, destination)
    installed = true
    if (!syncFileDescriptor(parentHandle.fd)) {
      return yield* domain("Could not fsync the destination directory", "Check the destination filesystem and retry.")
    }
    yield* Effect.promise(() => new Promise<void>((resolvePromise) => setImmediate(resolvePromise)))
    yield* verifyCompletedDownloadParent(target)
    yield* verifyCompletedDownloadDestination(parentHandle.fd, destination, stagedIdentity)
    return { bytes, sha256 }
  }), (fd) => Effect.sync(() => {
    try { closeFileDescriptor(fd) } catch {}
    if (!installed) tryUnlinkFileAt(parentHandle.fd, temp)
  }))
})

const installAtomicDownload = Effect.fn("Attachments.installAtomicDownload")(function*(
  directoryFd: number,
  temp: string,
  destination: string
) {
  if (!tryLinkFileAt(directoryFd, temp, destination)) {
    if (statFileAt(directoryFd, destination) !== null) {
      return yield* domain("Destination changed during download; refusing to replace it", "Inspect the destination and retry explicitly.")
    }
    return yield* domain("Could not atomically install the downloaded attachment without replacement", "Check destination filesystem support and permissions, then retry.")
  }
  if (!tryUnlinkFileAt(directoryFd, temp)) {
    return yield* domain("Could not remove the private download staging name", "Inspect the destination directory before retrying.")
  }
})

const verifyDownloadParentUnchanged = Effect.fn("Attachments.verifyDownloadParentUnchanged")(function*(target: DownloadTarget) {
  const current = yield* Effect.promise(() => lstat(target.parent, { bigint: true }).catch(() => undefined))
  if (!current || !current.isDirectory() || current.isSymbolicLink() ||
    current.dev !== target.parentIdentity.dev || current.ino !== target.parentIdentity.ino) {
    return yield* domain("Destination directory changed during download; refusing unsafe install", "Inspect the destination path and retry explicitly.")
  }
})

const verifyCompletedDownloadDestination = Effect.fn("Attachments.verifyCompletedDownloadDestination")(function*(
  directoryFd: number,
  destination: string,
  expected: NativeFileIdentity
) {
  const current = statFileAt(directoryFd, destination)
  if (!current || current.dev !== expected.dev || current.ino !== expected.ino) {
    return yield* domain(
      "Downloaded attachment destination changed before completion; output path was not confirmed",
      "Inspect the destination path and retry explicitly."
    )
  }
})

const verifyCompletedDownloadParent = Effect.fn("Attachments.verifyCompletedDownloadParent")(function*(target: DownloadTarget) {
  const current = yield* Effect.promise(() => lstat(target.parent, { bigint: true }).catch(() => undefined))
  if (!current || !current.isDirectory() || current.isSymbolicLink() ||
    current.dev !== target.parentIdentity.dev || current.ino !== target.parentIdentity.ino) {
    return yield* domain(
      "Destination directory changed as download installation completed; output path was not confirmed",
      "A verified file may remain in the original moved directory; inspect the destination paths before retrying."
    )
  }
})

export const syncDirectory = Effect.fn("Attachments.syncDirectory")(function*(path: string) {
  yield* Effect.tryPromise({
    try: async () => {
      const handle = await open(path, constants.O_RDONLY)
      try { await handle.sync() } finally { await handle.close() }
    },
    catch: () => new LinearDomainError({
      message: "Could not durably persist upload recovery metadata",
      help: "Check the state filesystem and retry the same upload command."
    })
  })
})

const byteLimit = Effect.fn("Attachments.byteLimit")(function*(
  parsed: ParsedArgs,
  fallback: number,
  maximum: number
): Effect.fn.Return<number, UsageError> {
  const raw = readStringFlag(parsed.flags, "max-bytes")
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    return yield* usage(`--max-bytes must be an integer between 1 and ${maximum}`, parsed)
  }
  return value
})

const usage = Effect.fn("Attachments.usage")(function*(message: string, parsed: Pick<ParsedArgs, "command">) {
  return yield* Effect.fail(new UsageError({ message, help: `Run \`linear-axi ${parsed.command.join(" ")} --help\` for valid options.` }))
})

const domain = Effect.fn("Attachments.domain")(function*(message: string, help: string) {
  return yield* Effect.fail(new LinearDomainError({ message, help }))
})

const requireNativeFiles = Effect.fn("Attachments.requireNativeFiles")(function*() {
  yield* Effect.try({
    try: ensureNativeFileSupport,
    catch: () => new LinearDomainError({
      message: "Safe local attachment file operations are unavailable on this platform",
      help: "Run this attachment upload or download on a supported macOS or Linux installation."
    })
  })
})

const abortablePromise = <Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> => {
  if (signal.aborted) return Promise.reject(new Error("request timed out"))
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    const finish = (continuation: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      continuation()
    }
    const onAbort = () => finish(() => rejectPromise(new Error("request timed out")))
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => finish(() => resolvePromise(value)),
      (cause) => finish(() => rejectPromise(cause))
    )
  })
}

const readWithTimeout = <Value>(
  reader: ReadableStreamDefaultReader<Value>,
  timeoutMs: number
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Value>["read"]>>> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  return abortablePromise(reader.read(), controller.signal).finally(() => clearTimeout(timeout)).catch((cause) => {
    void reader.cancel().catch(() => undefined)
    throw cause
  })
}
