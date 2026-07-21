import { Effect } from "effect"
import { join } from "node:path"
import { commandSpecs, parseArgs } from "../src/args"
import { runAttachmentCommand } from "../src/attachments"
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
  callOfficialTool: (name: string) => Effect.succeed(
    name === "get_issue"
      ? { id: "issue-1", identifier: "ENG-123", attachments: [attachment] }
      : name === "prepare_attachment_upload"
        ? {
            assetUrl: "https://uploads.linear.app/assets/stable-1",
            uploadRequest: { url: "https://storage.example.test/put", headers: { "content-type": "text/plain" } }
          }
        : name === "create_attachment_from_upload"
          ? { id: "attachment-1" }
          : name === "get_attachment"
            ? {
                ...attachment,
                assetUrl: "https://uploads.linear.app/assets/stable-1",
                sha256: "a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447"
              }
            : attachment
  )
} as unknown as LinearGateway

const parsed = parseArgs(Bun.argv.slice(2), commandSpecs)
const attachmentEffect = runAttachmentCommand(parsed, gateway, {
  fetcher: async (_url, init) => {
    if (init?.method === "PUT") {
      await new Response(init.body).arrayBuffer()
      return new Response(null, { status: 200 })
    }
    return new Response("hello world\n", { headers: { "content-type": "text/plain" } })
  },
  requestTimeoutMs: 1_000,
  stateRoot: join(process.cwd(), ".fixture-state")
})
writeToon(await Effect.runPromise(attachmentEffect ?? runCommand(parsed, gateway, process.execPath)))
