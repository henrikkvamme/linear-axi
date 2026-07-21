import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, closeSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, truncateSync, watch, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { Effect } from "effect"
import { commandSpecs, parseArgs } from "../src/args"
import { runAttachmentCommand, syncDirectory, type AttachmentRuntime } from "../src/attachments"
import { statFileAt, writeFileDescriptor } from "../src/native-files"
import { LinearApiError } from "../src/errors"
import type { LinearGateway } from "../src/linear"

const roots: Array<string> = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const gateway = (result: unknown): LinearGateway => ({
  close: () => Effect.void,
  callOfficialTool: () => Effect.succeed(result)
} as unknown as LinearGateway)

const run = (argv: ReadonlyArray<string>, result: unknown, runtime?: Partial<AttachmentRuntime>) => {
  const parsed = parseArgs(argv, commandSpecs)
  const effect = runAttachmentCommand(parsed, gateway(result), runtime)
  if (!effect) throw new Error("attachment command was not dispatched")
  return Effect.runPromise(effect)
}

const detail = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: "attachment-1",
  filename: "trace.txt",
  title: "Trace",
  contentType: "text/plain; charset=utf-8",
  size: 12,
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-20T11:00:00.000Z",
  issue: { id: "issue-1", identifier: "ENG-123" },
  downloadUrl: "https://uploads.linear.app/private/signed?secret=value",
  ...overrides
})

describe("attachment content boundary", () => {
  test("view reports content availability without leaking signed material", async () => {
    const output = await run(["attachments", "view", "--id", "attachment-1"], detail({
      downloadRequest: {
        url: "https://uploads.linear.app/private/signed?secret=value",
        headers: { "x-signed-secret": "private" }
      }
    }))

    expect(output).toEqual({
      attachment: {
        id: "attachment-1",
        filename: "trace.txt",
        title: "Trace",
        subtitle: null,
        mediaType: "text/plain; charset=utf-8",
        size: 12,
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-20T11:00:00.000Z",
        issue: { id: "issue-1", identifier: "ENG-123" },
        content: { available: true, transport: "authenticated-signed-https" }
      },
      help: []
    })
    expect(JSON.stringify(output)).not.toMatch(/uploads\.linear|signed-secret|private/)
  })

  test("view reports external link attachments as unavailable content", async () => {
    const output = await run(["attachments", "view", "--id", "attachment-1"], detail({
      downloadUrl: null,
      url: "https://example.com/reference"
    }))

    expect(output).toMatchObject({
      attachment: { content: { available: false, transport: "unavailable" } }
    })
  })

  test("read emits bounded UTF-8 text and makes terminal controls explicit", async () => {
    const bytes = new TextEncoder().encode("hello\u001b[31mred\u0007\u009b31m\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\n")
    const output = await run(["attachments", "read", "--id", "attachment-1", "--max-bytes", "64"], detail({ size: bytes.length }), {
      fetcher: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 5))
          controller.enqueue(bytes.subarray(5))
          controller.close()
        }
      }), { status: 200, headers: { "content-length": String(bytes.length) } })
    })

    expect(output).toEqual({
      attachment: { id: "attachment-1", filename: "trace.txt", mediaType: "text/plain; charset=utf-8", size: bytes.length },
      text: "hello\\u001b[31mred\\u0007\\u009b31m\\u061c\\u200e\\u200f\\u202a\\u202b\\u202c\\u202d\\u202e\\u2066\\u2067\\u2068\\u2069\n",
      bytesRead: bytes.length,
      truncated: false,
      help: []
    })
  })

  test("complete reads reject same-size content that fails checksum verification", async () => {
    const expected = new TextEncoder().encode("hello world\n")
    const corrupted = new TextEncoder().encode("hello worle\n")
    const error = await Effect.runPromise(Effect.flip(runEffect(
      ["attachments", "read", "--id", "attachment-1"],
      detail({ size: expected.length, sha256: createHash("sha256").update(expected).digest("hex") }),
      { fetcher: async () => new Response(corrupted, { status: 200 }) }
    )))

    expect(error.message).toContain("checksum verification failed")
  })

  test("read rejects binary media before fetching", async () => {
    let fetched = false
    const error = await Effect.runPromise(Effect.flip(runEffect(
      ["attachments", "read", "--id", "attachment-1"],
      detail({ contentType: "image/png" }),
      { fetcher: async () => { fetched = true; return new Response() } }
    )))

    expect(error.message).toContain("not an allowed textual media type")
    expect(fetched).toBe(false)
  })

  test("read treats empty UTF-8 text as definitive success and rejects invalid encoding", async () => {
    const empty = await run(["attachments", "read", "--id", "attachment-1"], detail({ size: 0 }), {
      fetcher: async () => new Response(new Uint8Array(), { status: 200, headers: { "content-length": "0" } })
    })
    expect(empty).toMatchObject({ text: "", bytesRead: 0, truncated: false })

    const error = await Effect.runPromise(Effect.flip(runEffect(
      ["attachments", "read", "--id", "attachment-1"],
      detail({ size: 2 }),
      { fetcher: async () => new Response(new Uint8Array([0xc3, 0x28]), { status: 200 }) }
    )))
    expect(error.message).toContain("not valid UTF-8")
  })

  test("read rejects a missing response body when metadata expects content", async () => {
    const error = await Effect.runPromise(Effect.flip(runEffect(
      ["attachments", "read", "--id", "attachment-1"],
      detail({ size: 12 }),
      { fetcher: async () => new Response(null, { status: 200 }) }
    )))

    expect(error.message).toContain("length did not match")
  })

  test("content fetch rejects successful responses that are not full-body HTTP 200", async () => {
    for (const response of [
      new Response(null, { status: 204 }),
      new Response("partial", { status: 206 })
    ]) {
      const error = await Effect.runPromise(Effect.flip(runEffect(
        ["attachments", "read", "--id", "attachment-1"],
        detail({ size: null }),
        { fetcher: async () => response }
      )))

      expect(error.message).toContain(`returned HTTP ${response.status}`)
    }
  })

  test("read fails closed when content exceeds metadata or the full-text ceiling", async () => {
    const metadataError = await Effect.runPromise(Effect.flip(runEffect(
      ["attachments", "read", "--id", "attachment-1"],
      detail({ size: 2 }),
      { fetcher: async () => new Response("three", { status: 200 }) }
    )))
    expect(metadataError.message).toContain("exceeded its metadata size")

    const oversized = new Uint8Array(1024 * 1024 + 1).fill(97)
    const ceilingError = await Effect.runPromise(Effect.flip(runEffect(
      ["attachments", "read", "--id", "attachment-1", "--full"],
      detail({ size: null }),
      { fetcher: async () => new Response(oversized, { status: 200 }) }
    )))
    expect(ceilingError.message).toContain("full-text safety ceiling")
  })

  test("bounded read backs up from a split UTF-8 character without misreporting invalid text", async () => {
    const bytes = new TextEncoder().encode("abc€tail")
    const output = await run(["attachments", "read", "--id", "attachment-1", "--max-bytes", "5"], detail({ size: bytes.length }), {
      fetcher: async () => new Response(bytes, { status: 200 })
    })
    expect(output).toMatchObject({ text: "abc", bytesRead: 3, truncated: true })
  })

  test("bounded read does not discard an invalid trailing UTF-8 byte", async () => {
    const error = await Effect.runPromise(Effect.flip(runEffect(
      ["attachments", "read", "--id", "attachment-1", "--max-bytes", "4"],
      detail({ size: 5 }),
      { fetcher: async () => new Response(new Uint8Array([0x61, 0x62, 0x63, 0xff, 0x64]), { status: 200 }) }
    )))

    expect(error.message).toContain("not valid UTF-8")
  })

  test("full read accepts unknown-size text exactly at the safety ceiling", async () => {
    const bytes = new Uint8Array(1024 * 1024).fill(97)
    const output = await run(["attachments", "read", "--id", "attachment-1", "--full"], detail({ size: null }), {
      fetcher: async () => new Response(bytes, { status: 200 })
    })

    expect(output).toMatchObject({ bytesRead: bytes.byteLength, truncated: false })
  })

  test("download streams to an atomic file and refuses collisions before fetching", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-attachment-"))
    roots.push(root)
    const outputPath = join(root, "trace.txt")
    const bytes = new TextEncoder().encode("hello world\n")
    let fetches = 0
    const runtime = {
      fetcher: async () => {
        fetches += 1
        return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } })
      }
    }

    const output = await run(["attachments", "download", "--id", "attachment-1", "--output", outputPath], detail({
      size: bytes.length,
      sha256: "A948904F2F0F479B8F8197694B30184B0D2ED1C1CD2A1EC0FB85D299A192A447"
    }), runtime)
    expect(readFileSync(outputPath)).toEqual(Buffer.from(bytes))
    expect(output).toMatchObject({ attachmentId: "attachment-1", path: outputPath, bytes: bytes.length, mediaType: "text/plain; charset=utf-8" })
    expect(output.sha256).toMatch(/^[a-f0-9]{64}$/)

    writeFileSync(outputPath, "keep")
    const error = await Effect.runPromise(Effect.flip(runEffect(
      ["attachments", "download", "--id", "attachment-1", "--output", outputPath],
      detail({ size: bytes.length }),
      runtime
    )))
    expect(error.message).toContain("destination already exists")
    expect(fetches).toBe(1)
    expect(readFileSync(outputPath, "utf8")).toBe("keep")
    expect(existsSync(`${outputPath}.partial`)).toBe(false)
  })

  test("download writer completes every short file write", () => {
    const bytes = new TextEncoder().encode("a complete streamed download")
    const output: Array<number> = []
    writeFileDescriptor(-1, bytes, (_fd, remaining, length) => {
      const written = Math.max(1, Math.floor(length / 2))
      output.push(...remaining.subarray(0, written))
      return written
    })

    expect(Uint8Array.from(output)).toEqual(bytes)
  })

  test("overwrite fails closed before fetching without conditional replacement support", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-attachment-"))
    roots.push(root)
    const outputPath = join(root, "trace.txt")
    writeFileSync(outputPath, "original")
    let fetched = false
    const error = await Effect.runPromise(Effect.flip(runEffect(
      ["attachments", "download", "--id", "attachment-1", "--output", outputPath, "--overwrite"],
      detail(),
      { fetcher: async () => { fetched = true; return new Response("downloaded") } }
    )))

    expect(error.message).toContain("atomic conditional overwrite")
    expect(fetched).toBe(false)
    expect(readFileSync(outputPath, "utf8")).toBe("original")
  })

  test("pinned identity checks do not require destination read permission", () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-attachment-"))
    roots.push(root)
    const outputPath = join(root, "private.txt")
    writeFileSync(outputPath, "private")
    chmodSync(outputPath, 0)
    const directoryFd = openSync(root, constants.O_RDONLY)
    try {
      const expected = lstatSync(outputPath)
      expect(statFileAt(directoryFd, "private.txt")).toEqual({
        dev: BigInt(expected.dev),
        ino: BigInt(expected.ino)
      })
    } finally {
      closeSync(directoryFd)
    }
  })

  test("download supports a destination basename at the filesystem limit", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-attachment-"))
    roots.push(root)
    const outputPath = join(root, "a".repeat(255))
    const bytes = new TextEncoder().encode("downloaded")

    await run(["attachments", "download", "--id", "attachment-1", "--output", outputPath], detail({ size: bytes.length }), {
      fetcher: async () => new Response(bytes)
    })

    expect(readFileSync(outputPath)).toEqual(Buffer.from(bytes))
  })

  test("download fails if the pinned destination directory moves during installation", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-attachment-"))
    roots.push(root)
    const outputDir = join(root, "output")
    const moved = join(root, "moved")
    mkdirSync(outputDir)
    const outputPath = join(outputDir, "trace.txt")
    const bytes = new TextEncoder().encode("hello world\n")
    let swapped = false
    const watcher = watch(outputDir, (_event, filename) => {
      if (!swapped && filename === "trace.txt") {
        swapped = true
        renameSync(outputDir, moved)
        mkdirSync(outputDir)
      }
    })

    try {
      const error = await Effect.runPromise(Effect.flip(runEffect(
        ["attachments", "download", "--id", "attachment-1", "--output", outputPath],
        detail({ size: bytes.length }),
        { fetcher: async () => new Response(bytes) }
      )))
      expect(error.message).toContain("directory changed")
      expect(existsSync(outputPath)).toBe(false)
      expect(existsSync(join(moved, "trace.txt"))).toBe(true)
    } finally {
      watcher.close()
    }
  })

  test("download fails if the installed destination is replaced before completion", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-attachment-"))
    roots.push(root)
    const outputPath = join(root, "trace.txt")
    const displacedPath = join(root, "verified.txt")
    const bytes = new TextEncoder().encode("hello world\n")
    let replaced = false
    const watcher = watch(root, (_event, filename) => {
      if (!replaced && filename === "trace.txt" && existsSync(outputPath)) {
        replaced = true
        renameSync(outputPath, displacedPath)
        writeFileSync(outputPath, "concurrent replacement")
      }
    })

    try {
      const error = await Effect.runPromise(Effect.flip(runEffect(
        ["attachments", "download", "--id", "attachment-1", "--output", outputPath],
        detail({ size: bytes.length }),
        { fetcher: async () => new Response(bytes) }
      )))
      expect(replaced).toBe(true)
      expect(error.message).toContain("destination changed")
      expect(readFileSync(displacedPath)).toEqual(Buffer.from(bytes))
      expect(readFileSync(outputPath, "utf8")).toBe("concurrent replacement")
    } finally {
      watcher.close()
    }
  })

  test("download binds installation to the file descriptor that received the bytes", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-attachment-"))
    roots.push(root)
    const outputPath = join(root, "trace.txt")
    const displacedPath = join(root, "displaced.partial")
    const bytes = new TextEncoder().encode("hello world\n")
    let replaced = false

    const error = await Effect.runPromise(Effect.flip(runEffect(
      ["attachments", "download", "--id", "attachment-1", "--output", outputPath],
      detail({ size: bytes.length }),
      {
        fetcher: async () => new Response(new ReadableStream({
          async pull(controller) {
            while (!replaced) {
              const temporary = readdirSync(root).find((name) => name.endsWith(".partial"))
              if (temporary) {
                const temporaryPath = join(root, temporary)
                renameSync(temporaryPath, displacedPath)
                writeFileSync(temporaryPath, "concurrent replacement")
                replaced = true
                break
              }
              await Bun.sleep(1)
            }
            controller.enqueue(bytes)
            controller.close()
          }
        }))
      }
    )))
    expect(replaced).toBe(true)
    expect(error.message).toContain("destination changed")
    expect(readFileSync(displacedPath)).toEqual(Buffer.from(bytes))
    expect(readFileSync(outputPath, "utf8")).toBe("concurrent replacement")
  })

  test("content fetch refuses redirects outside Linear storage before requesting them", async () => {
    const targets = [
      "https://127.0.0.1/private",
      "https://[::1]/private",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/private",
      "https://uploads.linear.app.evil.test/private",
      "https://evil-uploads.linear.app/private",
      "https://uploads.linear.app:8443/private"
    ]

    for (const target of targets) {
      const requests: Array<string> = []
      const error = await Effect.runPromise(Effect.flip(runEffect(
        ["attachments", "read", "--id", "attachment-1"],
        detail(),
        {
          fetcher: async (input) => {
            requests.push(String(input))
            if (requests.length === 1) return new Response(null, { status: 307, headers: { location: target } })
            return new Response("hello world\n", { status: 200 })
          }
        }
      )))

      expect(error.message).toContain("untrusted redirect")
      expect(requests).toEqual(["https://uploads.linear.app/private/signed?secret=value"])
    }
  })

  test("content fetch follows same-origin redirects without forwarding signed headers", async () => {
    const requests: Array<{ readonly url: string; readonly headers: HeadersInit | undefined }> = []
    const output = await run(
      ["attachments", "read", "--id", "attachment-1"],
      detail({ downloadRequest: { url: "https://uploads.linear.app/private/signed", headers: { "x-signed-secret": "private" } } }),
      {
        fetcher: async (input, init) => {
          requests.push({ url: String(input), headers: init?.headers })
          if (requests.length === 1) return new Response(null, { status: 307, headers: { location: "/private/next" } })
          return new Response("hello world\n", { status: 200 })
        }
      }
    )

    expect(output).toMatchObject({ text: "hello world\n", truncated: false })
    expect(requests).toEqual([
      { url: "https://uploads.linear.app/private/signed", headers: { "x-signed-secret": "private" } },
      { url: "https://uploads.linear.app/private/next", headers: {} }
    ])
  })

  test("content fetch validates every redirect hop", async () => {
    const requests: Array<string> = []
    const error = await Effect.runPromise(Effect.flip(runEffect(
      ["attachments", "read", "--id", "attachment-1"],
      detail(),
      {
        fetcher: async (input) => {
          const url = String(input)
          requests.push(url)
          if (requests.length === 1) {
            return new Response(null, { status: 307, headers: { location: "/private/next" } })
          }
          return new Response(null, { status: 307, headers: { location: "https://10.0.0.1/private" } })
        }
      }
    )))

    expect(error.message).toContain("untrusted redirect")
    expect(requests).toEqual([
      "https://uploads.linear.app/private/signed?secret=value",
      "https://uploads.linear.app/private/next"
    ])
  })

  test("download removes partial data on checksum mismatch and rejects non-HTTPS redirects", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-attachment-"))
    roots.push(root)
    const outputPath = join(root, "trace.txt")
    const bytes = new TextEncoder().encode("hello world\n")
    const checksumError = await Effect.runPromise(Effect.flip(runEffect(
      ["attachments", "download", "--id", "attachment-1", "--output", outputPath],
      detail({ size: bytes.length, sha256: "0".repeat(64) }),
      { fetcher: async () => new Response(bytes, { status: 200 }) }
    )))
    expect(checksumError.message).toContain("checksum")
    expect(existsSync(outputPath)).toBe(false)
    expect(readdirSync(root)).toEqual([])

    const redirectError = await Effect.runPromise(Effect.flip(runEffect(
      ["attachments", "download", "--id", "attachment-1", "--output", outputPath],
      detail({ size: bytes.length }),
      { fetcher: async () => new Response(null, { status: 307, headers: { location: "http://example.test/private?secret=value" } }) }
    )))
    expect(redirectError.message).toContain("non-HTTPS redirect")
    expect(JSON.stringify(redirectError)).not.toContain("secret=value")
    expect(readdirSync(root)).toEqual([])
  })

  test("download cancels stalled bodies and refuses a swapped destination directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-attachment-"))
    roots.push(root)
    const outputDir = join(root, "output")
    mkdirSync(outputDir)
    const outputPath = join(outputDir, "trace.txt")
    let canceled = false
    const timeoutError = await Effect.runPromise(Effect.flip(runEffect(
      ["attachments", "download", "--id", "attachment-1", "--output", outputPath],
      detail({ size: 12 }),
      {
        requestTimeoutMs: 10,
        fetcher: async () => new Response(new ReadableStream({
          cancel() { canceled = true }
        }), { status: 200 })
      }
    )))
    expect(timeoutError.message).toContain("stream failed")
    expect(canceled).toBe(true)
    expect(readdirSync(outputDir)).toEqual([])

    const moved = join(root, "moved")
    let swapCanceled = false
    const swapError = await Effect.runPromise(Effect.flip(runEffect(
      ["attachments", "download", "--id", "attachment-1", "--output", outputPath],
      detail({ size: 12 }),
      {
        fetcher: async () => {
          renameSync(outputDir, moved)
          symlinkSync(moved, outputDir)
          return new Response(new ReadableStream({
            cancel() { swapCanceled = true }
          }), { status: 200 })
        }
      }
    )))
    expect(swapError.message).toMatch(/directory changed|pin the destination directory/)
    expect(swapCanceled).toBe(true)
    expect(existsSync(join(moved, "trace.txt"))).toBe(false)
    expect(readdirSync(moved)).toEqual([])

    rmSync(outputDir)
    renameSync(moved, outputDir)
    const replaced = join(root, "replaced")
    const samePathError = await Effect.runPromise(Effect.flip(runEffect(
      ["attachments", "download", "--id", "attachment-1", "--output", outputPath],
      detail({ size: 12 }),
      {
        fetcher: async () => new Response(new ReadableStream({
          pull(controller) {
            renameSync(outputDir, replaced)
            mkdirSync(outputDir)
            controller.enqueue(new TextEncoder().encode("hello world\n"))
            controller.close()
          }
        }, { highWaterMark: 0 }), { status: 200 })
      }
    )))
    expect(samePathError.message).toContain("directory changed")
    expect(existsSync(join(replaced, "trace.txt"))).toBe(false)
    expect(existsSync(outputPath)).toBe(false)
  })
})

describe("resumable attachment upload", () => {
  test("recovery persistence propagates directory synchronization failures", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-upload-"))
    roots.push(root)

    const error = await Effect.runPromise(Effect.flip(syncDirectory(join(root, "missing"))))

    expect(error.message).toContain("durably persist upload recovery metadata")
  })

  test("rejects non-regular sources before any official call", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-upload-"))
    roots.push(root)
    let calls = 0
    const parsed = parseArgs(["attachments", "upload", "--issue", "ENG-123", "--file", root], commandSpecs)
    const effect = runAttachmentCommand(parsed, {
      ...gateway({}),
      callOfficialTool: () => { calls += 1; return Effect.succeed({}) }
    }, { stateRoot: join(root, "state") })!

    const error = await Effect.runPromise(Effect.flip(effect))
    expect(error.message).toContain("regular file")
    expect(calls).toBe(0)

    const target = join(root, "target.txt")
    const link = join(root, "link.txt")
    writeFileSync(target, "safe")
    symlinkSync(target, link)
    const symlinkParsed = parseArgs(["attachments", "upload", "--issue", "ENG-123", "--file", link], commandSpecs)
    const symlinkEffect = runAttachmentCommand(symlinkParsed, {
      ...gateway({}),
      callOfficialTool: () => { calls += 1; return Effect.succeed({}) }
    }, { stateRoot: join(root, "state") })!
    const symlinkError = await Effect.runPromise(Effect.flip(symlinkEffect))
    expect(symlinkError.message).toContain("regular file")
    expect(calls).toBe(0)
  })

  test("rejects unknown media and default-oversized files before official calls", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-upload-"))
    roots.push(root)
    const unknown = join(root, "payload.unknown")
    const large = join(root, "large.txt")
    writeFileSync(unknown, "content")
    writeFileSync(large, "x")
    truncateSync(large, 100 * 1024 * 1024 + 1)
    let calls = 0
    const linearGateway = { ...gateway({}), callOfficialTool: () => { calls += 1; return Effect.succeed({}) } }
    for (const file of [unknown, large]) {
      const parsed = parseArgs(["attachments", "upload", "--issue", "ENG-123", "--file", file], commandSpecs)
      const effect = runAttachmentCommand(parsed, linearGateway, { stateRoot: join(root, "state") })!
      const error = await Effect.runPromise(Effect.flip(effect))
      expect(error.message).toMatch(/media type|outside the allowed upload bound/)
    }
    expect(calls).toBe(0)
  })

  test("refuses prepared upload URLs outside trusted storage before sending bytes", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-upload-"))
    roots.push(root)
    const source = join(root, "trace.txt")
    writeFileSync(source, "hello world\n")
    let uploadUrl = ""
    let fetches = 0
    let finalizes = 0
    const uploadGateway = {
      ...gateway({}),
      callOfficialTool: (name: string) => {
        if (name === "get_issue") return Effect.succeed({ id: "issue-1", identifier: "ENG-123", attachments: [] })
        if (name === "prepare_attachment_upload") return Effect.succeed({
          assetUrl: "https://uploads.linear.app/assets/stable-1",
          uploadRequest: { url: uploadUrl, headers: { "content-type": "text/plain" } }
        })
        if (name === "create_attachment_from_upload") finalizes += 1
        return Effect.succeed({ id: "attachment-1" })
      }
    } as LinearGateway

    for (const unsafeUrl of [
      "https://127.0.0.1/put",
      "https://[::1]/put",
      "https://10.0.0.1/put",
      "https://localhost/put",
      "https://metadata.google.internal/put",
      "https://storage.googleapis.com.evil.test/put",
      "https://storage.googleapis.com:8443/put"
    ]) {
      uploadUrl = unsafeUrl
      const error = await Effect.runPromise(Effect.flip(runAttachmentCommand(
        parseArgs(["attachments", "upload", "--issue", "ENG-123", "--file", source], commandSpecs),
        uploadGateway,
        {
          stateRoot: join(root, "state"),
          fetcher: async () => {
            fetches += 1
            return new Response(null, { status: 200 })
          }
        }
      )!))
      expect(error.message).toContain("unsafe or malformed prepared upload request")
    }

    expect(fetches).toBe(0)
    expect(finalizes).toBe(0)
  })

  test("uploads by prepare, streaming PUT, finalize, and verified readback", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-upload-"))
    roots.push(root)
    const source = join(root, "trace.txt")
    writeFileSync(source, "hello world\n")
    const calls: Array<{ name: string; args: Readonly<Record<string, unknown>> }> = []
    let uploaded = ""
    const uploadGateway = {
      ...gateway({}),
      callOfficialTool: (name: string, args: Readonly<Record<string, unknown>>) => {
        calls.push({ name, args })
        if (name === "get_issue") return Effect.succeed({ id: "issue-1", identifier: "ENG-123", attachments: [] })
        if (name === "prepare_attachment_upload") return Effect.succeed({
          assetUrl: "https://uploads.linear.app/assets/stable-1",
          uploadRequest: {
            url: "https://linear-assets.storage.googleapis.com/put?signature=secret",
            headers: { "content-type": "text/plain", "content-length": "12", "x-signed-secret": "header-secret" }
          }
        })
        if (name === "create_attachment_from_upload") return Effect.succeed({ id: "attachment-1" })
        if (name === "get_attachment") return Effect.succeed(detail({
          size: 12,
          issue: { id: "issue-1", identifier: "ENG-123" },
          assetUrl: "https://uploads.linear.app/assets/stable-1",
          sha256: "a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447"
        }))
        return Effect.die(`unexpected ${name}`)
      }
    } as LinearGateway
    const output = await runUpload(source, uploadGateway, {
      stateRoot: join(root, "state"),
      fetcher: async (_url, init) => {
        expect(init?.headers).toEqual({
          "content-type": "text/plain",
          "content-length": "12",
          "x-signed-secret": "header-secret"
        })
        const headers = new Headers(init?.headers)
        expect(headers.has("authorization")).toBe(false)
        expect(headers.get("content-length")).toBe("12")
        expect(headers.get("content-type")).toBe("text/plain")
        expect(headers.get("x-signed-secret")).toBe("header-secret")
        uploaded = await new Response(init?.body).text()
        return new Response(null, { status: 200 })
      }
    })

    expect(uploaded).toBe("hello world\n")
    expect(calls.map((call) => call.name)).toEqual([
      "get_issue", "prepare_attachment_upload", "create_attachment_from_upload", "get_attachment"
    ])
    expect(output).toMatchObject({
      attachmentId: "attachment-1",
      issue: { id: "issue-1", identifier: "ENG-123" },
      filename: "trace.txt",
      bytes: 12,
      mediaType: "text/plain",
      sha256: "a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447"
    })
    const recoveryPath = join(root, "state", readdirSync(join(root, "state")).find((name) => name.endsWith(".json"))!)
    const recovery = readFileSync(recoveryPath, "utf8")
    expect(recovery).not.toContain(source)
    expect(recovery).not.toMatch(/signature=secret|header-secret|authorization|bearer/i)
    expect(recovery).toContain('"stage":"finalized"')
    expect(lstatSync(recoveryPath).mode & 0o777).toBe(0o600)
  })

  test("reconciles ambiguous finalize without creating a duplicate", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-upload-"))
    roots.push(root)
    const source = join(root, "trace.txt")
    writeFileSync(source, "hello world\n")
    let finalized = false
    let finalizeCalls = 0
    const uploadGateway = {
      ...gateway({}),
      callOfficialTool: (name: string) => {
        if (name === "get_issue") return Effect.succeed({
          id: "issue-1",
          identifier: "ENG-123",
          attachments: finalized ? [{ ...detail(), url: "https://uploads.linear.app/assets/stable-1" }] : []
        })
        if (name === "prepare_attachment_upload") return Effect.succeed({
          assetUrl: "https://uploads.linear.app/assets/stable-1",
          uploadRequest: { url: "https://storage.googleapis.com/put", headers: { "content-type": "text/plain" } }
        })
        if (name === "create_attachment_from_upload") {
          finalizeCalls += 1
          finalized = true
          return Effect.fail(new LinearApiError({ message: "response lost", help: "retry" }))
        }
        if (name === "get_attachment") return Effect.succeed(detail({
          issue: { id: "issue-1", identifier: "ENG-123" },
          assetUrl: "https://uploads.linear.app/assets/stable-1",
          sha256: "a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447"
        }))
        return Effect.die(`unexpected ${name}`)
      }
    } as LinearGateway
    const runtime = {
      stateRoot: join(root, "state"),
      fetcher: async (_url: string | URL | Request, init?: RequestInit) => {
        await new Response(init?.body).arrayBuffer()
        return new Response(null, { status: 200 })
      }
    }

    await expect(runUpload(source, uploadGateway, runtime)).rejects.toThrow("outcome is unknown")
    const output = await runUpload(source, uploadGateway, runtime)
    const repeated = await runUpload(source, uploadGateway, runtime)

    expect(finalizeCalls).toBe(1)
    expect(output).toMatchObject({ attachmentId: "attachment-1", changed: false, recovery: "finalized attachment verified" })
    expect(repeated).toMatchObject({ attachmentId: "attachment-1", changed: false, recovery: "finalized attachment verified" })
  })

  test("rejects a finalized upload whose subtitle differs from the intent", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-upload-"))
    roots.push(root)
    const source = join(root, "trace.txt")
    writeFileSync(source, "hello world\n")
    const uploadGateway = {
      ...gateway({}),
      callOfficialTool: (name: string) => {
        if (name === "get_issue") return Effect.succeed({ id: "issue-1", identifier: "ENG-123", attachments: [] })
        if (name === "prepare_attachment_upload") return Effect.succeed({
          assetUrl: "https://uploads.linear.app/assets/stable-1",
          uploadRequest: { url: "https://storage.googleapis.com/put", headers: { "content-type": "text/plain" } }
        })
        if (name === "create_attachment_from_upload") return Effect.succeed({ id: "attachment-1" })
        if (name === "get_attachment") return Effect.succeed(detail({
          subtitle: "Different subtitle",
          issue: { id: "issue-1", identifier: "ENG-123" },
          assetUrl: "https://uploads.linear.app/assets/stable-1",
          sha256: "a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447"
        }))
        return Effect.die(`unexpected ${name}`)
      }
    } as LinearGateway
    const parsed = parseArgs([
      "attachments", "upload", "--issue", "ENG-123", "--file", source, "--subtitle", "Expected subtitle"
    ], commandSpecs)
    const effect = runAttachmentCommand(parsed, uploadGateway, {
      stateRoot: join(root, "state"),
      fetcher: async (_url, init) => {
        await new Response(init?.body).arrayBuffer()
        return new Response(null, { status: 200 })
      }
    })!

    const error = await Effect.runPromise(Effect.flip(effect))
    expect(error.message).toContain("did not match the upload intent")
  })

  test("allows only one concurrent upload for the same recovery intent", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-upload-"))
    roots.push(root)
    const source = join(root, "trace.txt")
    writeFileSync(source, "hello world\n")
    let prepares = 0
    let finalizes = 0
    let releaseFirstPut!: () => void
    const firstPutEntered = new Promise<void>((resolvePromise) => {
      releaseFirstPut = resolvePromise
    })
    let notifyFirstPut!: () => void
    const firstPutStarted = new Promise<void>((resolvePromise) => {
      notifyFirstPut = resolvePromise
    })
    const assets = new Map<string, string>()
    const uploadGateway = {
      ...gateway({}),
      callOfficialTool: (name: string, args: Readonly<Record<string, unknown>>) => {
        if (name === "get_issue") return Effect.succeed({ id: "issue-1", identifier: "ENG-123", attachments: [] })
        if (name === "prepare_attachment_upload") {
          prepares += 1
          return Effect.succeed({
            assetUrl: `https://uploads.linear.app/assets/stable-${prepares}`,
            uploadRequest: { url: `https://storage.googleapis.com/put/${prepares}`, headers: { "content-type": "text/plain" } }
          })
        }
        if (name === "create_attachment_from_upload") {
          finalizes += 1
          const id = `attachment-${finalizes}`
          assets.set(id, String(args.assetUrl))
          return Effect.succeed({ id })
        }
        if (name === "get_attachment") {
          const id = String(args.id)
          return Effect.succeed(detail({
            id,
            issue: { id: "issue-1", identifier: "ENG-123" },
            assetUrl: assets.get(id),
            sha256: "a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447"
          }))
        }
        return Effect.die(`unexpected ${name}`)
      }
    } as LinearGateway
    let puts = 0
    const runtime = {
      stateRoot: join(root, "state"),
      fetcher: async (_url: string | URL | Request, init?: RequestInit) => {
        puts += 1
        if (puts === 1) {
          notifyFirstPut()
          await firstPutEntered
        }
        await new Response(init?.body).arrayBuffer()
        return new Response(null, { status: 200 })
      }
    }

    const first = runUpload(source, uploadGateway, runtime)
    await firstPutStarted
    const second = runUpload(source, uploadGateway, runtime)
    try {
      await expect(second).rejects.toThrow("already in progress")
    } finally {
      releaseFirstPut()
      await first
    }

    const recoveryPath = join(root, "state", readdirSync(join(root, "state")).find((name) => name.endsWith(".json"))!)
    writeFileSync(`${recoveryPath}.lock`, JSON.stringify({ version: 1, owner: "stale-owner", pid: process.pid }))
    const recovered = await runUpload(source, uploadGateway, runtime)

    expect(recovered).toMatchObject({ changed: false, recovery: "finalized attachment verified" })
    expect(existsSync(`${recoveryPath}.lock`)).toBe(true)
    expect(prepares).toBe(1)
    expect(finalizes).toBe(1)
  })

  test("a partial streaming transfer persists no signed material and safely re-prepares", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-upload-"))
    roots.push(root)
    const source = join(root, "trace.txt")
    const sourceBytes = Buffer.alloc(256 * 1024, 0x61)
    writeFileSync(source, sourceBytes)
    const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex")
    let prepares = 0
    let puts = 0
    const uploadGateway = {
      ...gateway({}),
      callOfficialTool: (name: string) => {
        if (name === "get_issue") return Effect.succeed({ id: "issue-1", identifier: "ENG-123", attachments: [] })
        if (name === "prepare_attachment_upload") {
          prepares += 1
          return Effect.succeed({
            assetUrl: `https://uploads.linear.app/assets/stable-${prepares}`,
            uploadRequest: { url: `https://storage.googleapis.com/put?secret=${prepares}`, headers: { "x-private": `header-${prepares}`, "content-type": "text/plain" } }
          })
        }
        if (name === "create_attachment_from_upload") return Effect.succeed({ id: "attachment-1" })
        if (name === "get_attachment") return Effect.succeed(detail({
          size: sourceBytes.byteLength,
          issue: { id: "issue-1", identifier: "ENG-123" },
          assetUrl: "https://uploads.linear.app/assets/stable-2",
          sha256: sourceSha256
        }))
        return Effect.die(`unexpected ${name}`)
      }
    } as LinearGateway
    const runtime = {
      stateRoot: join(root, "state"),
      fetcher: async (_url: string | URL | Request, init?: RequestInit) => {
        puts += 1
        const reader = (init?.body as ReadableStream<Uint8Array>).getReader()
        if (puts === 1) {
          const first = await reader.read()
          expect(first.done).toBe(false)
          await reader.cancel()
          throw new Error("contains https://storage.googleapis.com/put?secret=1")
        }
        let streamed = 0
        let largestChunk = 0
        while (true) {
          const part = await reader.read()
          if (part.done) break
          streamed += part.value.byteLength
          largestChunk = Math.max(largestChunk, part.value.byteLength)
        }
        expect(streamed).toBe(sourceBytes.byteLength)
        expect(largestChunk).toBeLessThan(sourceBytes.byteLength)
        return new Response(null, { status: 200 })
      }
    }

    const failedParsed = parseArgs(["attachments", "upload", "--issue", "ENG-123", "--file", source], commandSpecs)
    const failedEffect = runAttachmentCommand(failedParsed, uploadGateway, runtime)!
    const error = await Effect.runPromise(Effect.flip(failedEffect))
    expect(error.message).toBe("Direct attachment byte transfer failed")
    const recoveryPath = join(root, "state", readdirSync(join(root, "state")).find((name) => name.endsWith(".json"))!)
    expect(readFileSync(recoveryPath, "utf8")).not.toMatch(/secret=1|header-1|storage\.example/)

    await runUpload(source, uploadGateway, runtime)
    expect(prepares).toBe(2)
    expect(puts).toBe(2)
  })

  test("upload rejects bytes changed after source hashing before finalize", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-upload-"))
    roots.push(root)
    const source = join(root, "trace.txt")
    writeFileSync(source, "hello world\n")
    let finalized = false
    const uploadGateway = {
      ...gateway({}),
      callOfficialTool: (name: string) => {
        if (name === "get_issue") return Effect.succeed({ id: "issue-1", identifier: "ENG-123", attachments: [] })
        if (name === "prepare_attachment_upload") return Effect.succeed({
          assetUrl: "https://uploads.linear.app/assets/stable-1",
          uploadRequest: { url: "https://storage.googleapis.com/put", headers: { "content-type": "text/plain" } }
        })
        if (name === "create_attachment_from_upload") finalized = true
        return Effect.succeed({ id: "attachment-1" })
      }
    } as LinearGateway

    const error = await Effect.runPromise(Effect.flip(runAttachmentCommand(
      parseArgs(["attachments", "upload", "--issue", "ENG-123", "--file", source], commandSpecs),
      uploadGateway,
      {
        stateRoot: join(root, "state"),
        fetcher: async (_url, init) => {
          writeFileSync(source, "HELLO WORLD\n")
          await new Response(init?.body).arrayBuffer()
          return new Response(null, { status: 200 })
        }
      }
    )!))

    expect(error.message).toContain("bytes changed during transfer")
    expect(finalized).toBe(false)
  })

  test("upload refuses cross-origin redirects before finalize", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-upload-"))
    roots.push(root)
    const source = join(root, "trace.txt")
    writeFileSync(source, "hello world\n")
    let finalized = false
    const uploadGateway = {
      ...gateway({}),
      callOfficialTool: (name: string) => {
        if (name === "get_issue") return Effect.succeed({ id: "issue-1", identifier: "ENG-123", attachments: [] })
        if (name === "prepare_attachment_upload") return Effect.succeed({
          assetUrl: "https://uploads.linear.app/assets/stable-1",
          uploadRequest: { url: "https://storage.googleapis.com/put", headers: { "content-type": "text/plain" } }
        })
        if (name === "create_attachment_from_upload") finalized = true
        return Effect.succeed({ id: "attachment-1" })
      }
    } as LinearGateway
    const error = await Effect.runPromise(Effect.flip(runAttachmentCommand(
      parseArgs(["attachments", "upload", "--issue", "ENG-123", "--file", source], commandSpecs),
      uploadGateway,
      { stateRoot: join(root, "state"), fetcher: async () => new Response(null, { status: 307, headers: { location: "https://evil.example/put" } }) }
    )!))
    expect(error.message).toContain("cross-origin redirect")
    expect(finalized).toBe(false)
  })

  test("prepare response loss leaves no recovery and a stalled PUT times out cleanly", async () => {
    const root = mkdtempSync(join(tmpdir(), "linear-axi-upload-"))
    roots.push(root)
    const source = join(root, "trace.txt")
    writeFileSync(source, "hello world\n")
    let prepares = 0
    const uploadGateway = {
      ...gateway({}),
      callOfficialTool: (name: string) => {
        if (name === "get_issue") return Effect.succeed({ id: "issue-1", identifier: "ENG-123", attachments: [] })
        if (name === "prepare_attachment_upload") {
          prepares += 1
          if (prepares === 1) return Effect.fail(new LinearApiError({ message: "prepare response lost", help: "retry" }))
          return Effect.succeed({
            assetUrl: "https://uploads.linear.app/assets/stable-2",
            uploadRequest: { url: "https://storage.googleapis.com/put", headers: { "content-type": "text/plain" } }
          })
        }
        return Effect.die(`unexpected ${name}`)
      }
    } as LinearGateway
    const stateRoot = join(root, "state")
    await expect(runUpload(source, uploadGateway, { stateRoot })).rejects.toThrow("prepare response lost")
    expect(readdirSync(stateRoot).some((name) => name.endsWith(".json"))).toBe(false)

    const parsed = parseArgs(["attachments", "upload", "--issue", "ENG-123", "--file", source], commandSpecs)
    let uploadAborted = false
    const timeoutError = await Effect.runPromise(Effect.flip(runAttachmentCommand(parsed, uploadGateway, {
      stateRoot,
      requestTimeoutMs: 10,
      fetcher: async (_url, init) => {
        init?.signal?.addEventListener("abort", () => { uploadAborted = true }, { once: true })
        return new Promise<Response>(() => undefined)
      }
    })!))
    await Bun.sleep(0)
    expect(timeoutError.message).toBe("Direct attachment byte transfer failed")
    expect(uploadAborted).toBe(true)
    expect(prepares).toBe(2)
    const recovery = readFileSync(join(stateRoot, readdirSync(stateRoot).find((name) => name.endsWith(".json"))!), "utf8")
    expect(recovery).toContain('"stage":"prepared"')
    expect(recovery).not.toContain("storage.example")
  })
})

const runEffect = (
  argv: ReadonlyArray<string>,
  result: unknown,
  runtime?: Partial<AttachmentRuntime>
) => {
  const parsed = parseArgs(argv, commandSpecs)
  const effect = runAttachmentCommand(parsed, gateway(result), runtime)
  if (!effect) throw new Error("attachment command was not dispatched")
  return effect
}

const runUpload = (
  source: string,
  linearGateway: LinearGateway,
  runtime: Partial<AttachmentRuntime>
) => {
  const parsed = parseArgs(["attachments", "upload", "--issue", "ENG-123", "--file", source], commandSpecs)
  const effect = runAttachmentCommand(parsed, linearGateway, runtime)
  if (!effect) throw new Error("attachment upload was not dispatched")
  return Effect.runPromise(effect)
}
