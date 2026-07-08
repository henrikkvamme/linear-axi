import { Effect } from "effect"
import { type ParsedArgs, readBooleanFlag, readLimitFlag, readStringFlag, topLevelHelp } from "./args"
import { UsageError, type CliError } from "./errors"
import type { LinearGateway } from "./linear"
import { truncateText, type OutputValue } from "./output"

export const runCommand = (
  parsed: ParsedArgs,
  gateway: LinearGateway,
  binPath: string
): Effect.Effect<OutputValue, CliError> => {
  const path = parsed.command.join(" ")

  if (parsed.flags.get("help") === true) {
    return Effect.succeed({
      help: helpFor(path)
    })
  }

  switch (path) {
    case "home":
      return home(gateway, binPath)
    case "auth status":
      return gateway.authStatus().pipe(
        Effect.map((auth) => ({
          auth,
          help: auth.authenticated ? [] : ["Set LINEAR_API_KEY or LINEAR_ACCESS_TOKEN."]
        }))
      )
    case "teams list":
      return teamsList(parsed, gateway)
    case "issues list":
      return issuesList(parsed, gateway)
    case "issues view":
      return issuesView(parsed, gateway)
    case "issues create":
      return issuesCreate(parsed, gateway)
    case "comments create":
      return commentsCreate(parsed, gateway)
    default:
      return Effect.fail(new UsageError({ message: `unknown command ${path}`, help: topLevelHelp }))
  }
}

const home = (gateway: LinearGateway, binPath: string) =>
  gateway.authStatus().pipe(
    Effect.flatMap((auth) => {
      if (!auth.authenticated) {
        return Effect.succeed({
          bin: collapseHome(binPath),
          description: "Operate Linear through a Bun, Effect, AXI-oriented CLI.",
          auth,
          help: ["Set LINEAR_API_KEY or LINEAR_ACCESS_TOKEN.", "Run `linear-axi teams list` after auth is configured."]
        })
      }

      return gateway.listIssues({ assignee: "me", limit: 10 }).pipe(
        Effect.map((issues) => ({
          bin: collapseHome(binPath),
          description: "Operate Linear through a Bun, Effect, AXI-oriented CLI.",
          auth,
          count: `${issues.length} assigned issues shown`,
          issues,
          help: [
            "Run `linear-axi issues view --id <issue-id-or-key>` for details.",
            "Run `linear-axi teams list` to find team keys."
          ]
        }))
      )
    })
  )

const teamsList = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const limit = readLimitFlag(parsed.flags, 50)
  return gateway.listTeams(limit).pipe(
    Effect.map((teams) => ({
      count: `${teams.length} teams shown`,
      teams,
      help:
        teams.length === 0
          ? ["No teams were returned for this Linear account."]
          : ["Run `linear-axi issues list --team <key-or-id>` to list issues for a team."]
    }))
  )
}

const issuesList = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const limit = readLimitFlag(parsed.flags, 20)
  const assignee = readStringFlag(parsed.flags, "assignee")
  const team = readStringFlag(parsed.flags, "team")

  if (assignee !== undefined && assignee !== "me") {
    return Effect.fail(
      new UsageError({
        message: "--assignee only supports `me`",
        help: "Usage: linear-axi issues list [--assignee me] [--team <key-or-id>] [--limit 20]"
      })
    )
  }

  return gateway.listIssues({ limit, assignee, team }).pipe(
    Effect.map((issues) => ({
      count: `${issues.length} issues shown`,
      issues,
      help:
        issues.length === 0
          ? ["No issues matched this query."]
          : ["Run `linear-axi issues view --id <issue-id-or-key>` for details."]
    }))
  )
}

const issuesView = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const id = readStringFlag(parsed.flags, "id")!
  const full = readBooleanFlag(parsed.flags, "full")

  return gateway.viewIssue(id).pipe(
    Effect.map((issue) => {
      const description = truncateText(issue.description, 1200, full)
      return {
        issue: {
          ...issue,
          description: description.text
        },
        ...(description.truncated
          ? {
              body: {
                truncated: true,
                total: description.total
              },
              help: [`Run \`linear-axi issues view --id ${issue.identifier} --full\` to see the complete description.`]
            }
          : {})
      }
    })
  )
}

const issuesCreate = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const team = readStringFlag(parsed.flags, "team")!
  const title = readStringFlag(parsed.flags, "title")!
  const description = readStringFlag(parsed.flags, "description")

  return gateway.createIssue({ team, title, description }).pipe(
    Effect.map((issue) => ({
      issue,
      help: [`Run \`linear-axi issues view --id ${issue.identifier}\` for details.`]
    }))
  )
}

const commentsCreate = (parsed: ParsedArgs, gateway: LinearGateway) => {
  const issue = readStringFlag(parsed.flags, "issue")!
  const body = readStringFlag(parsed.flags, "body")!

  return gateway.createComment({ issue, body }).pipe(
    Effect.map((comment) => ({
      comment
    }))
  )
}

const helpFor = (path: string): string => {
  switch (path) {
    case "home":
      return topLevelHelp
    case "auth status":
      return "Usage: linear-axi auth status\nExample: linear-axi auth status"
    case "teams list":
      return "Usage: linear-axi teams list [--limit 50]\nExample: linear-axi teams list --limit 25"
    case "issues list":
      return [
        "Usage: linear-axi issues list [--assignee me] [--team <key-or-id>] [--limit 20]",
        "Example: linear-axi issues list --assignee me",
        "Example: linear-axi issues list --team ENG --limit 10"
      ].join("\n")
    case "issues view":
      return "Usage: linear-axi issues view --id <issue-id-or-key> [--full]\nExample: linear-axi issues view --id ENG-123"
    case "issues create":
      return [
        "Usage: linear-axi issues create --team <key-or-id> --title \"...\" [--description \"...\"]",
        "Example: linear-axi issues create --team ENG --title \"Fix auth bug\""
      ].join("\n")
    case "comments create":
      return [
        "Usage: linear-axi comments create --issue <issue-id-or-key> --body \"...\"",
        "Example: linear-axi comments create --issue ENG-123 --body \"Implemented in PR.\""
      ].join("\n")
    default:
      return topLevelHelp
  }
}

const collapseHome = (path: string): string => {
  const home = process.env.HOME
  if (!home) {
    return path
  }
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}
