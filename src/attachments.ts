import { constants } from "node:fs"
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
  readonly dev: number
  readonly ino: number
  readonly mtimeMs: number
  readonly ctimeMs: number
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
    const issue = yield* resolveUploadIssue(readStringFlag(parsed.flags, "issue")!, gateway)
    const title = readStringFlag(parsed.flags, "title") ?? null
    const subtitle = readStringFlag(parsed.flags, "subtitle") ?? null
    const recoveryPath = resolve(runtime.stateRoot, `${uploadRecoveryKey(issue.id, source, title, subtitle)}.json`)
    let recovery = yield* loadRecovery(recoveryPath)
    if (recovery && !recoveryMatches(recovery, issue, source, title, subtitle)) {
      return yield* domain("Upload recovery metadata conflicts with this file intent", "Remove only the named private recovery record after inspecting it, then retry.")
    }

    if (recovery?.stage === "finalized" && recovery.attachmentId) {
      const verified = yield* verifyUploadedAttachment(recovery.attachmentId, issue, source, title, recovery.assetUrl, gateway)
      return uploadOutput(verified, issue, source, false, "finalized attachment verified")
    }

    if (recovery?.stage === "transferred" && recovery.assetUrl) {
      const reconciled = findRecoveredAttachment(issue.attachments, recovery.assetUrl, source, title)
      if (reconciled) {
        const verified = yield* verifyUploadedAttachment(reconciled.id, issue, source, title, recovery.assetUrl, gateway)
        recovery = { ...recovery, stage: "finalized", attachmentId: verified.id }
        yield* persistRecovery(recoveryPath, recovery)
        return uploadOutput(verified, issue, source, false, "finalized attachment verified")
      }
      return yield* finalizeUpload(parsed, gateway, recoveryPath, recovery, issue, source, title)
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
      return yield* finalizeUpload(parsed, gateway, recoveryPath, recovery, issue, source, title)
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
      `Run \`linear-axi attachments download --id ${attachment.id} --output <path>\` and inspect it with an appropriate local tool.`
    )
  }
  if (full && attachment.size !== null && attachment.size > MAX_READ_BYTES) {
    return yield* domain(
      `Attachment ${attachment.id} exceeds the ${MAX_READ_BYTES}-byte full-text safety ceiling`,
      `Run \`linear-axi attachments download --id ${attachment.id} --output <path>\` instead.`
    )
  }
  const response = yield* fetchContent(attachment, runtime)
  const read = yield* readBoundedResponse(response, limit, attachment.size, runtime.requestTimeoutMs)
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(read.bytes)
  } catch {
    return yield* domain(
      `Attachment ${attachment.id} is not valid UTF-8 text`,
      `Run \`linear-axi attachments download --id ${attachment.id} --output <path>\` to preserve the original bytes.`
    )
  }
  const safeText = makeTerminalSafe(text)
  const truncated = read.truncated || (attachment.size !== null && attachment.size > read.bytes.byteLength)
  return {
    attachment: {
      id: attachment.id,
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      size: attachment.size
    },
    text: safeText,
    bytesRead: read.bytes.byteLength,
    truncated,
    help: truncated && !full ? [`Run \`linear-axi attachments read --id ${attachment.id} --full\` for allowed text up to ${MAX_READ_BYTES} bytes.`] : []
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
  const attachment = yield* getAttachment(parsed, gateway)
  if (attachment.size !== null && attachment.size > maxBytes) {
    return yield* domain(
      `Attachment ${attachment.id} is ${attachment.size} bytes, above the ${maxBytes}-byte download limit`,
      `Retry with \`--max-bytes ${attachment.size}\` if this exact size is intended.`
    )
  }
  const response = yield* fetchContent(attachment, runtime)
  const result = yield* writeAtomicDownload(response, target, attachment, maxBytes, runtime.requestTimeoutMs)
  return {
    attachmentId: attachment.id,
    path: target.path,
    bytes: result.bytes,
    mediaType: attachment.mediaType,
    sha256: result.sha256,
    help: []
  }
})

const getAttachment = Effect.fn("Attachments.get")(function*(parsed: ParsedArgs, gateway: LinearGateway) {
  const id = readStringFlag(parsed.flags, "id")!
  const value = yield* gateway.callOfficialTool("get_attachment", { id })
  const attachment = decodeDetail(value)
  if (!attachment || attachment.id !== id) {
    return yield* domain(
      "Official Linear MCP output shape drifted while resolving the attachment",
      `Run \`linear-axi attachments view --id ${id}\` to retry the exact immutable id.`
    )
  }
  return attachment
})

const listAttachments = Effect.fn("Attachments.list")(function*(parsed: ParsedArgs, gateway: LinearGateway) {
  const selector = readStringFlag(parsed.flags, "issue")!
  const limit = readLimitFlag(parsed.flags, 100)
  const offset = yield* decodeCursor(readStringFlag(parsed.flags, "after"), selector)
  const issue = yield* gateway.callOfficialTool("get_issue", { id: selector })
  if (!Predicate.isObject(issue) || !nonEmptyString(issue.id) || !matchesIssue(issue, selector)) {
    return yield* Effect.fail(new LinearDomainError({
      message: "Official Linear MCP output shape drifted while resolving the attachment issue",
      help: `Run \`linear-axi issues view --id ${selector}\` to inspect the issue.`
    }))
  }
  if (!Array.isArray(issue.attachments) || issue.attachments.some((value) => !Predicate.isObject(value))) {
    return yield* Effect.fail(new LinearDomainError({
      message: "Official Linear MCP output shape drifted: expected issue attachments",
      help: `Run \`linear-axi issues view --id ${selector} --full\` to inspect the issue.`
    }))
  }
  const all = issue.attachments.map(toSummary)
  if (all.some((value) => value === undefined)) {
    return yield* Effect.fail(new LinearDomainError({
      message: "Official Linear MCP output shape drifted: an attachment had no immutable id",
      help: `Run \`linear-axi issues view --id ${selector} --full\` to inspect the issue.`
    }))
  }
  const rows = all as ReadonlyArray<AttachmentSummary>
  if (offset > rows.length) {
    return yield* Effect.fail(new UsageError({
      message: "invalid --after cursor: attachment page is no longer available",
      help: `Run \`linear-axi attachments list --issue ${selector}\` to restart pagination.`
    }))
  }
  const items = rows.slice(offset, offset + limit)
  const nextOffset = offset + items.length
  const hasNext = nextOffset < rows.length
  const identifier = nonEmptyString(issue.identifier) ? issue.identifier : undefined
  return {
    issue: { id: issue.id, ...(identifier ? { identifier } : {}) },
    count: `${items.length} ${items.length === 1 ? "attachment" : "attachments"} shown`,
    page: { hasNext, endCursor: hasNext ? encodeCursor(selector, nextOffset) : null },
    ...(items.length === 0
      ? { attachments: `0 attachments found for ${selector}` }
      : { attachments: items }),
    help: hasNext
      ? [`Run \`linear-axi attachments list --issue ${selector} --after ${encodeCursor(selector, nextOffset)} --limit ${limit}\` for the next page.`]
      : items.length > 0
        ? ["Run `linear-axi attachments view --id <attachment-id>` for metadata and content availability."]
        : []
  }
})

const toSummary = (value: Record<string, unknown>): AttachmentSummary | undefined => {
  if (!nonEmptyString(value.id)) return undefined
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
  if (!Predicate.isObject(value)) return undefined
  const summary = toSummary(value)
  if (!summary) return undefined
  const request = Predicate.isObject(value.downloadRequest)
    ? value.downloadRequest
    : Predicate.isObject(value.contentRequest)
      ? value.contentRequest
      : undefined
  const contentUrl = firstString(
    request?.url,
    value.downloadUrl,
    value.contentUrl,
    value.assetUrl,
    value.url
  )
  const issue = Predicate.isObject(value.issue) && nonEmptyString(value.issue.id)
    ? { id: value.issue.id, ...(nonEmptyString(value.issue.identifier) ? { identifier: value.issue.identifier } : {}) }
    : null
  return {
    ...summary,
    subtitle: firstString(value.subtitle),
    issue,
    contentUrl,
    assetUrl: firstString(value.assetUrl, value.url),
    headers: decodeHeaders(request?.headers),
    sha256: validSha256(firstString(value.sha256, value.checksum))
  }
}

const publicDetail = (attachment: AttachmentDetail) => ({
  id: attachment.id,
  filename: attachment.filename,
  title: attachment.title,
  subtitle: attachment.subtitle,
  mediaType: attachment.mediaType,
  size: attachment.size,
  createdAt: attachment.createdAt,
  updatedAt: attachment.updatedAt,
  issue: attachment.issue,
  content: {
    available: attachment.contentUrl !== null,
    transport: attachment.contentUrl === null ? "unavailable" : "authenticated-signed-https"
  }
})

const decodeHeaders = (value: unknown): Readonly<Record<string, string>> => {
  if (Predicate.isObject(value)) {
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
  }
  if (Array.isArray(value)) {
    return Object.fromEntries(value.flatMap((entry) => Predicate.isObject(entry) && nonEmptyString(entry.key) && typeof entry.value === "string"
      ? [[entry.key, entry.value] as const]
      : []))
  }
  return {}
}

const validSha256 = (value: string | null): string | null =>
  value !== null && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null

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
      code === 127 || (code >= 128 && code <= 159)) {
      output += `\\u${code.toString(16).padStart(4, "0")}`
    } else if (code === 13) {
      output += "\\r"
    } else {
      output += character
    }
  }
  return output
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
      if (!response.ok) {
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

const safeAssetUrl = (raw: string): Effect.Effect<string, LinearDomainError> => Effect.try({
  try: () => {
    const url = new URL(raw)
    if (url.protocol !== "https:" || url.username || url.password || url.hostname !== "uploads.linear.app") throw new Error("unsafe")
    return url.toString()
  },
  catch: () => new LinearDomainError({
    message: "Linear returned an unsafe attachment content location",
    help: "Retry the command and do not supply or substitute a download URL."
  })
})

const safeRedirectUrl = (raw: string, current: string): Effect.Effect<string, LinearDomainError> => Effect.try({
  try: () => {
    const url = new URL(raw, current)
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsafe")
    return url.toString()
  },
  catch: () => new LinearDomainError({
    message: "Attachment download refused a non-HTTPS redirect",
    help: "Retry the command to request fresh authenticated content metadata."
  })
})

const safeRequestHeaders = (headers: Readonly<Record<string, string>>): Effect.Effect<Record<string, string>, LinearDomainError> => {
  const forbidden = Object.keys(headers).find((key) => ["authorization", "cookie", "proxy-authorization"].includes(key.toLowerCase()))
  return forbidden
    ? domain("Linear returned forbidden credentials for the separate attachment host", "Retry the command and do not forward Linear authentication to asset storage.")
    : Effect.succeed({ ...headers })
}

const readBoundedResponse = Effect.fn("Attachments.readBounded")(function*(
  response: Response,
  limit: number,
  expectedSize: number | null,
  timeoutMs: number
) {
  if (!response.body) return { bytes: new Uint8Array(), truncated: expectedSize !== null && expectedSize > 0 }
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
      if (total === limit && (expectedSize === null || expectedSize > total)) {
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
    try: () => lstat(path),
    catch: () => new UsageError({ message: "--file does not exist or is a broken link", help: "Pass an explicit existing local regular file." })
  })
  if (!link.isFile() || link.isSymbolicLink()) return yield* usage("--file must be an explicit local regular file, not a directory, link, device, FIFO, or socket", parsed)
  const handle = yield* Effect.tryPromise({
    try: () => open(path, constants.O_RDONLY | constants.O_NOFOLLOW),
    catch: () => new UsageError({ message: "--file could not be opened safely as a regular file", help: "Pass an explicit non-symlink local file." })
  })
  const metadata = yield* Effect.tryPromise({
    try: () => handle.stat(),
    catch: () => new UsageError({ message: "--file metadata could not be read", help: "Check the file and retry." })
  })
  if (!metadata.isFile() || Number(metadata.dev) !== Number(link.dev) || Number(metadata.ino) !== Number(link.ino)) {
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
    dev: Number(metadata.dev), ino: Number(metadata.ino), mtimeMs: metadata.mtimeMs, ctimeMs: metadata.ctimeMs, handle
  }
  yield* assertSourceUnchanged(source)
  return source
})

const assertSourceUnchanged = Effect.fn("Attachments.assertSourceUnchanged")(function*(source: UploadSource) {
  const current = yield* Effect.tryPromise({
    try: () => source.handle.stat(),
    catch: () => new UsageError({ message: "--file became unavailable during upload", help: "Retry with a stable regular file." })
  })
  if (!current.isFile() || Number(current.size) !== source.size || Number(current.dev) !== source.dev ||
    Number(current.ino) !== source.ino || current.mtimeMs !== source.mtimeMs || current.ctimeMs !== source.ctimeMs) {
    return yield* Effect.fail(new UsageError({ message: "--file changed during upload", help: "Retry only after the source file is stable." }))
  }
})

const resolveUploadIssue = Effect.fn("Attachments.resolveUploadIssue")(function*(selector: string, gateway: LinearGateway) {
  const value = yield* gateway.callOfficialTool("get_issue", { id: selector })
  if (!Predicate.isObject(value) || !nonEmptyString(value.id) || !nonEmptyString(value.identifier) || !matchesIssue(value, selector) ||
    !Array.isArray(value.attachments) || value.attachments.some((attachment) => !Predicate.isObject(attachment))) {
    return yield* domain("Official Linear MCP output shape drifted while resolving the upload issue", `Run \`linear-axi issues view --id ${selector} --full\` to inspect it.`)
  }
  return { id: value.id, identifier: value.identifier, attachments: value.attachments as ReadonlyArray<Record<string, unknown>> }
})

const uploadRecoveryKey = (
  issueId: string,
  source: UploadSource,
  title: string | null,
  subtitle: string | null
): string => new Bun.CryptoHasher("sha256").update(JSON.stringify({ issueId, sha256: source.sha256, mediaType: source.mediaType, title, subtitle })).digest("hex")

const loadRecovery = (path: string): Effect.Effect<UploadRecovery | null, LinearDomainError> => Effect.tryPromise({
  try: async () => {
    try {
      const metadata = await lstat(path)
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("unsafe recovery file")
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      let text: string
      try { text = await handle.readFile("utf8") } finally { await handle.close() }
      const value = JSON.parse(text) as unknown
      if (!Predicate.isObject(value) || value.version !== 1 || !["prepared", "transferred", "finalized"].includes(String(value.stage))) throw new Error("shape")
      return value as unknown as UploadRecovery
    } catch (cause) {
      if (Predicate.hasProperty(cause, "code") && cause.code === "ENOENT") return null
      throw cause
    }
  },
  catch: () => new LinearDomainError({ message: "Private upload recovery metadata is unreadable or invalid", help: "Inspect the recovery directory permissions before retrying." })
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

const persistRecovery = Effect.fn("Attachments.persistRecovery")(function*(path: string, recovery: UploadRecovery) {
  const parent = dirname(path)
  yield* Effect.tryPromise({
    try: async () => {
      await mkdir(parent, { recursive: true, mode: 0o700 })
      if ((await realpath(parent)) !== resolve(parent) || (await lstat(parent)).isSymbolicLink()) throw new Error("unsafe recovery directory")
      await chmod(parent, 0o700)
    },
    catch: () => new LinearDomainError({ message: "Could not create the private upload recovery directory", help: "Check state-directory permissions and retry." })
  })
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

const decodePreparedUpload = (value: unknown): Effect.Effect<PreparedUpload, LinearDomainError> => {
  if (!Predicate.isObject(value) || !nonEmptyString(value.assetUrl) || !Predicate.isObject(value.uploadRequest) ||
    !nonEmptyString(value.uploadRequest.url)) {
    return domain("Official Linear MCP output shape drifted while preparing the upload", "Retry the upload from the same explicit file intent.")
  }
  const assetUrl = validPrivateAssetUrl(value.assetUrl)
  const uploadUrl = validUploadUrl(value.uploadRequest.url)
  const headers = decodeHeaders(value.uploadRequest.headers)
  if (!assetUrl || !uploadUrl || Object.keys(headers).length === 0) {
    return domain("Linear returned an unsafe or incomplete upload request", "Retry the upload and do not substitute an upload URL or headers.")
  }
  return safeRequestHeaders(headers).pipe(Effect.map((safeHeaders) => ({ assetUrl, uploadUrl, headers: safeHeaders })))
}

const validPrivateAssetUrl = (raw: string): string | null => {
  try {
    const url = new URL(raw)
    return url.protocol === "https:" && url.hostname === "uploads.linear.app" && !url.username && !url.password && !url.search && !url.hash
      ? url.toString()
      : null
  } catch { return null }
}

const validUploadUrl = (raw: string): string | null => {
  try {
    const url = new URL(raw)
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null
  } catch { return null }
}

const transferUpload = Effect.fn("Attachments.transferUpload")(function*(prepared: PreparedUpload, source: UploadSource, runtime: AttachmentRuntime) {
  let url = prepared.uploadUrl
  for (let redirects = 0; redirects <= 2; redirects += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), runtime.requestTimeoutMs)
    const stream = source.handle.createReadStream({ start: 0, end: source.size - 1, autoClose: false })
    const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>
    const response = yield* Effect.tryPromise({
      try: () => abortablePromise(runtime.fetcher(url, {
        method: "PUT",
        headers: prepared.headers,
        body,
        redirect: "manual",
        signal: controller.signal,
        duplex: "half"
      } as RequestInit), controller.signal),
      catch: () => new LinearDomainError({
        message: "Direct attachment byte transfer failed",
        help: "Retry the same upload command; it will safely prepare a fresh signed request."
      })
    }).pipe(Effect.ensuring(Effect.sync(() => clearTimeout(timeout))))
    if (![307, 308].includes(response.status)) {
      void response.body?.cancel().catch(() => undefined)
      if (!response.ok) {
        return yield* domain(`Direct attachment byte transfer returned HTTP ${response.status}`, "Retry the same upload command; it will safely prepare a fresh signed request.")
      }
      return
    }
    void response.body?.cancel().catch(() => undefined)
    const location = response.headers.get("location")
    if (!location || redirects === 2) {
      return yield* domain("Direct attachment upload redirect was invalid or exceeded the safety limit", "Retry the same upload command.")
    }
    const redirected = validUploadUrl(new URL(location, url).toString())
    if (!redirected || new URL(redirected).origin !== new URL(url).origin) {
      return yield* domain("Direct attachment upload refused an unsafe cross-origin redirect", "Retry the same upload command; never substitute an upload URL.")
    }
    url = redirected
  }
})

const finalizeUpload = Effect.fn("Attachments.finalizeUpload")(function*(
  _parsed: ParsedArgs,
  gateway: LinearGateway,
  recoveryPath: string,
  recovery: UploadRecovery,
  issue: { readonly id: string; readonly identifier: string },
  source: UploadSource,
  title: string | null
) {
  if (!recovery.assetUrl) return yield* domain("Upload recovery metadata has no transferred asset identity", "Retry the same upload command to prepare a fresh transfer.")
  const result = yield* gateway.callOfficialTool("create_attachment_from_upload", {
    issue: issue.id,
    assetUrl: recovery.assetUrl,
    ...(recovery.title === null ? {} : { title: recovery.title }),
    ...(recovery.subtitle === null ? {} : { subtitle: recovery.subtitle })
  }).pipe(Effect.mapError(() => new LinearApiError({
    message: "Attachment finalize response was lost or failed after dispatch; mutation outcome is unknown",
    help: `Retry \`linear-axi attachments upload --issue ${issue.identifier} --file <same-file>\`; recovery will verify before finalizing again.`
  })))
  const attachmentId = Predicate.isObject(result) && nonEmptyString(result.id)
    ? result.id
    : Predicate.isObject(result) && Predicate.isObject(result.attachment) && nonEmptyString(result.attachment.id)
      ? result.attachment.id
      : null
  if (!attachmentId) {
    return yield* domain("Official Linear MCP output shape drifted after attachment finalize", `Retry the same upload command; recovery will inspect ${issue.identifier} before another finalize.`)
  }
  const verified = yield* verifyUploadedAttachment(attachmentId, issue, source, title, recovery.assetUrl, gateway)
  yield* persistRecovery(recoveryPath, { ...recovery, stage: "finalized", attachmentId })
  return uploadOutput(verified, issue, source, true, "attachment uploaded and verified")
})

const findRecoveredAttachment = (
  attachments: ReadonlyArray<Record<string, unknown>>,
  assetUrl: string,
  source: UploadSource,
  title: string | null
): { readonly id: string } | null => {
  const match = attachments.find((attachment) => nonEmptyString(attachment.id) &&
    firstString(attachment.assetUrl, attachment.url, attachment.downloadUrl) === assetUrl &&
    (firstString(attachment.filename, attachment.name) === null || firstString(attachment.filename, attachment.name) === source.filename) &&
    (title === null || firstString(attachment.title) === title))
  return match && nonEmptyString(match.id) ? { id: match.id } : null
}

const verifyUploadedAttachment = Effect.fn("Attachments.verifyUploadedAttachment")(function*(
  attachmentId: string,
  issue: { readonly id: string; readonly identifier: string },
  source: UploadSource,
  title: string | null,
  assetUrl: string | null,
  gateway: LinearGateway
) {
  const detail = decodeDetail(yield* gateway.callOfficialTool("get_attachment", { id: attachmentId }))
  const sameIssue = detail?.issue?.id === issue.id || detail?.issue?.identifier === issue.identifier
  const sameFilename = detail?.filename === source.filename || (detail?.filename === null && title !== null && detail?.title === title)
  const sameTitle = title === null || detail?.title === title
  const sameSize = detail?.size === source.size
  const sameType = detail?.mediaType?.split(";", 1)[0]?.trim().toLowerCase() === source.mediaType
  const sameChecksum = detail?.sha256 === null || detail?.sha256 === source.sha256
  const sameAsset = assetUrl === null || detail?.assetUrl === assetUrl
  if (!detail || detail.id !== attachmentId || !sameIssue || !sameFilename || !sameTitle || !sameSize || !sameType || !sameChecksum || !sameAsset) {
    return yield* domain("Finalized attachment verification did not match the upload intent", `Run \`linear-axi attachments view --id ${attachmentId}\` and do not repeat finalize blindly.`)
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
  filename: source.filename,
  bytes: source.size,
  mediaType: source.mediaType,
  sha256: source.sha256,
  changed,
  recovery,
  help: []
})

const matchesIssue = (issue: Record<string, unknown>, selector: string): boolean =>
  [issue.id, issue.identifier].some((value) => typeof value === "string" && value.toLowerCase() === selector.toLowerCase())

const firstString = (...values: ReadonlyArray<unknown>): string | null =>
  values.find((value): value is string => typeof value === "string" && value.length > 0) ?? null

const firstNumber = (...values: ReadonlyArray<unknown>): number | null =>
  values.find((value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ?? null

const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0

const encodeCursor = (issue: string, offset: number): string =>
  `att1.${Buffer.from(JSON.stringify({ issue, offset }), "utf8").toString("base64url")}`

const decodeCursor = (
  cursor: string | undefined,
  issue: string
): Effect.Effect<number, UsageError> => Effect.try({
  try: () => {
    if (cursor === undefined) return 0
    if (!cursor.startsWith("att1.")) throw new Error("prefix")
    const value = JSON.parse(Buffer.from(cursor.slice(5), "base64url").toString("utf8")) as unknown
    if (!Predicate.isObject(value) || value.issue !== issue || !Number.isSafeInteger(value.offset) || Number(value.offset) < 0) {
      throw new Error("shape")
    }
    return Number(value.offset)
  },
  catch: () => new UsageError({
    message: "invalid --after cursor for attachments list",
    help: `Run \`linear-axi attachments list --issue ${issue}\` to restart pagination.`
  })
})

interface DownloadTarget {
  readonly path: string
  readonly parent: string
  readonly existing: { readonly dev: number; readonly ino: number } | null
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
  return { path, parent, existing: existing ? { dev: Number(existing.dev), ino: Number(existing.ino) } : null } satisfies DownloadTarget
})

const writeAtomicDownload = Effect.fn("Attachments.writeAtomicDownload")(function*(
  response: Response,
  target: DownloadTarget,
  attachment: AttachmentDetail,
  maxBytes: number,
  timeoutMs: number
) {
  const temp = resolve(target.parent, `.${basename(target.path)}.${randomUUID()}.partial`)
  const acquire = Effect.tryPromise({
    try: () => open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600),
    catch: () => new LinearDomainError({ message: "Could not create a private temporary download file", help: "Check destination directory permissions and retry." })
  })
  return yield* Effect.acquireUseRelease(acquire, (handle) => Effect.gen(function*() {
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
          yield* Effect.tryPromise({
            try: () => handle.write(next.value),
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
    if (attachment.sha256 !== null && sha256 !== attachment.sha256) {
      return yield* domain("Attachment checksum verification failed", "Do not use the partial content; retry the download.")
    }
    yield* Effect.tryPromise({
      try: () => handle.sync(),
      catch: () => new LinearDomainError({ message: "Could not fsync the downloaded attachment", help: "Check the destination filesystem and retry." })
    })
    yield* verifyTargetUnchanged(target)
    yield* Effect.tryPromise({
      try: () => rename(temp, target.path),
      catch: () => new LinearDomainError({ message: "Could not atomically install the downloaded attachment", help: "Check destination permissions and retry." })
    })
    yield* syncDirectory(target.parent)
    return { bytes, sha256 }
  }), (handle) => Effect.promise(async () => {
    await handle.close().catch(() => undefined)
    await unlink(temp).catch(() => undefined)
  }))
})

const verifyTargetUnchanged = Effect.fn("Attachments.verifyTargetUnchanged")(function*(target: DownloadTarget) {
  const currentParent = yield* Effect.promise(() => realpath(dirname(target.path)).catch(() => undefined))
  if (currentParent !== target.parent) {
    return yield* domain("Destination directory changed during download; refusing unsafe install", "Inspect the destination path and retry explicitly.")
  }
  const current = yield* Effect.promise(() => lstat(target.path).catch(() => undefined))
  if (target.existing === null && current !== undefined) {
    return yield* domain("Destination changed during download; refusing to replace it", "Inspect the destination and retry explicitly.")
  }
  if (target.existing !== null && (!current || !current.isFile() || current.isSymbolicLink() ||
    current.dev !== target.existing.dev || current.ino !== target.existing.ino)) {
    return yield* domain("Destination changed during download; refusing unsafe overwrite", "Inspect the destination and retry explicitly.")
  }
})

const syncDirectory = (path: string): Effect.Effect<void> => Effect.tryPromise({
  try: async () => {
    const handle = await open(path, constants.O_RDONLY)
    try { await handle.sync() } finally { await handle.close() }
  },
  catch: () => undefined
}).pipe(Effect.catch(() => Effect.void))

const byteLimit = (
  parsed: ParsedArgs,
  fallback: number,
  maximum: number
): Effect.Effect<number, UsageError> => {
  const raw = readStringFlag(parsed.flags, "max-bytes")
  if (raw === undefined) return Effect.succeed(fallback)
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 && value <= maximum
    ? Effect.succeed(value)
    : usage(`--max-bytes must be an integer between 1 and ${maximum}`, parsed)
}

const usage = (message: string, parsed: Pick<ParsedArgs, "command">): Effect.Effect<never, UsageError> =>
  Effect.fail(new UsageError({ message, help: `Run \`linear-axi ${parsed.command.join(" ")} --help\` for valid options.` }))

const domain = (message: string, help: string): Effect.Effect<never, LinearDomainError> =>
  Effect.fail(new LinearDomainError({ message, help }))

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
