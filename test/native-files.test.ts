import { expect, test } from "bun:test"

const repoRoot = process.cwd()
const unavailablePlatform = process.platform === "darwin" ? "linux" : "darwin"

test("unrelated commands do not load platform-native file helpers", () => {
  const result = Bun.spawnSync({
    cmd: [
      "bun",
      "-e",
      `Object.defineProperty(process, "platform", { value: ${JSON.stringify(unavailablePlatform)} }); await import("./src/commands.ts"); console.log("loaded")`
    ],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe"
  })

  expect(result.exitCode).toBe(0)
  expect(new TextDecoder().decode(result.stderr)).toBe("")
  expect(new TextDecoder().decode(result.stdout)).toBe("loaded\n")
})

test("attachment file operations report unavailable native support", () => {
  const script = [
    `Object.defineProperty(process, "platform", { value: ${JSON.stringify(unavailablePlatform)} })`,
    'const [{ Effect }, { commandSpecs, parseArgs }, { runAttachmentCommand }] = await Promise.all([import("effect"), import("./src/args.ts"), import("./src/attachments.ts")])',
    'const parsed = parseArgs(["attachments", "download", "--id", "attachment-1", "--output", "./native-unavailable-output"], commandSpecs)',
    'const gateway = { close: () => Effect.void, callOfficialTool: () => Effect.die("gateway should not be called") }',
    'const operation = runAttachmentCommand(parsed, gateway)',
    'try { await Effect.runPromise(operation) } catch (error) { console.log(JSON.stringify({ name: error.name, message: error.message, help: error.help })) }'
  ].join("; ")
  const result = Bun.spawnSync({
    cmd: ["bun", "-e", script],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe"
  })

  expect(result.exitCode).toBe(0)
  expect(new TextDecoder().decode(result.stderr)).toBe("")
  expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual({
    name: "LinearDomainError",
    message: "Safe local attachment file operations are unavailable on this platform",
    help: "Run this attachment upload or download on a supported macOS or Linux installation."
  })
})
