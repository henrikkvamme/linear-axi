import { Effect } from "effect"
import { commandSpecs, parseArgs } from "../src/args"
import { runCommand } from "../src/commands"
import type { LinearGateway } from "../src/linear"
import { writeToon } from "../src/output"

const attachment = {
  id: "attachment-1",
  filename: "trace.txt",
  title: "Trace",
  contentType: "text/plain",
  size: 12,
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-20T11:00:00.000Z",
  issue: { id: "issue-1", identifier: "ENG-123" },
  downloadUrl: "https://uploads.linear.app/private/signed"
}
const gateway = {
  close: () => Effect.void,
  callOfficialTool: (name: string) => Effect.succeed(name === "get_issue"
    ? { id: "issue-1", identifier: "ENG-123", attachments: [attachment] }
    : attachment)
} as unknown as LinearGateway

const parsed = parseArgs(Bun.argv.slice(2), commandSpecs)
writeToon(await Effect.runPromise(runCommand(parsed, gateway, process.execPath)))
