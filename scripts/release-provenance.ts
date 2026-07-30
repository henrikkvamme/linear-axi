import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

export const packagedRevisionPath = "SOURCE_REVISION"

const exactRevision = /^[0-9a-f]{40}$/i

export const validateRevision = (value: string, source: string): string => {
  const revision = value.trim()
  if (!exactRevision.test(revision)) {
    throw new Error(`${source} must be an exact 40-hex immutable revision, received ${JSON.stringify(revision)}.`)
  }
  return revision.toLowerCase()
}

export const hasGitMetadata = (): boolean => existsSync(".git")

const probeGit = (
  subject: string,
  probe: "worktree" | "HEAD" | "index" | "status" | "archive",
  args: ReadonlyArray<string>
): string => {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    stdout: "pipe",
    stderr: "pipe"
  })
  if (result.exitCode !== 0) {
    const diagnostic = result.stderr.toString().trim()
    throw new Error(`${subject} could not verify Git ${probe} (exit ${result.exitCode})${diagnostic ? `: ${diagnostic}` : "."}`)
  }
  return result.stdout.toString().trim()
}

export const verifyCleanCheckout = (subject: string): string => {
  const worktree = probeGit(subject, "worktree", ["rev-parse", "--is-inside-work-tree"])
  if (worktree !== "true") {
    throw new Error(`${subject} could not verify Git worktree: expected true, received ${JSON.stringify(worktree)}.`)
  }

  const revision = validateRevision(probeGit(subject, "HEAD", ["rev-parse", "HEAD"]), `${subject} Git HEAD`)
  const indexEntries = probeGit(subject, "index", ["ls-files", "-v", "-z", "--", ":/"])
    .split("\0")
    .filter((entry) => entry.length > 0)
  const exemptEntries = indexEntries.filter((entry) => {
    const tag = entry[0]
    return tag === "S" || (tag !== undefined && tag >= "a" && tag <= "z")
  })
  if (exemptEntries.length > 0) {
    throw new Error(`${subject} rejects Git index exemptions so the immutable revision identifies the source exactly.`)
  }

  const dirty = probeGit(subject, "status", [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--ignore-submodules=none"
  ])
  if (dirty.length > 0) {
    throw new Error(`${subject} requires a clean checkout so the immutable revision identifies the source exactly.`)
  }
  return revision
}

export const exportImmutableRevision = (
  subject: string,
  revision: string
): { readonly root: string; readonly cleanup: () => void } => {
  const snapshot = mkdtempSync(join(process.cwd(), ".linear-axi-release-snapshot-"))
  const archive = join(snapshot, "source.tar")
  const root = join(snapshot, "source")
  mkdirSync(root)
  try {
    probeGit(subject, "archive", ["archive", "--format=tar", `--output=${archive}`, revision])
    const extracted = Bun.spawnSync({
      cmd: ["tar", "-xf", archive, "-C", root],
      stdout: "pipe",
      stderr: "pipe"
    })
    if (extracted.exitCode !== 0) {
      const diagnostic = extracted.stderr.toString().trim()
      throw new Error(`${subject} could not extract immutable Git archive (exit ${extracted.exitCode})${diagnostic ? `: ${diagnostic}` : "."}`)
    }
    rmSync(archive)
    return {
      root,
      cleanup: () => rmSync(snapshot, { recursive: true, force: true })
    }
  } catch (error) {
    rmSync(snapshot, { recursive: true, force: true })
    throw error
  }
}

export const readPackagedRevision = (): string | undefined => {
  if (!existsSync(packagedRevisionPath)) return undefined
  const metadata = lstatSync(packagedRevisionPath)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Packaged source revision must be a regular file: ${packagedRevisionPath}.`)
  }
  return validateRevision(readFileSync(packagedRevisionPath, "utf8"), "Packaged source revision")
}
