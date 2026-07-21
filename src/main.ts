#!/usr/bin/env bun
import { Cause, Effect, Exit, Result } from "effect"
import { commandSpecs, parseArgs } from "./args"
import { AuthError, type CliError, LinearApiError, LinearDomainError, UsageError } from "./errors"
import { loadEnv } from "./env"
import { makeLinearGateway } from "./linear"
import { errorOutput, writeToon } from "./output"
import { runCommand } from "./commands"

const parseProgramArgs = Effect.try({
  try: () => parseArgs(Bun.argv.slice(2), commandSpecs),
  catch: (cause) =>
    cause instanceof UsageError
      ? cause
      : new UsageError({
          message: "Failed to parse command arguments",
          help: "Run `linear-axi --help` for supported commands."
        })
})

const main: Effect.Effect<Record<string, unknown>, CliError> = Effect.gen(function*() {
  const parsed = yield* parseProgramArgs
  const env = loadEnv(process.cwd(), process.env)
  const gateway = makeLinearGateway(env)
  return yield* runCommand(parsed, gateway, process.execPath, env, process.env).pipe(
    Effect.ensuring(gateway.close())
  )
})

const exitCodeFor = (error: unknown): number => {
  if (error instanceof UsageError) {
    return 2
  }

  if (error instanceof AuthError || error instanceof LinearApiError || error instanceof LinearDomainError) {
    return 1
  }

  return 1
}

Effect.runPromiseExit(main).then((exit) => {
  if (Exit.isSuccess(exit)) {
    writeToon(exit.value)
    return
  }

  const error = firstTypedError(exit.cause)
  if (error) {
    writeToon(errorOutput(error.message, error.help))
    process.exitCode = exitCodeFor(error)
    return
  }

  const defect = Cause.squash(exit.cause)
  const message = defect instanceof Error && defect.message.length > 0 ? defect.message : "Unexpected CLI failure"
  writeToon(errorOutput(message, "Run `linear-axi --help` for supported commands."))
  process.exitCode = 1
})

const firstTypedError = (cause: Cause.Cause<CliError>): CliError | undefined => {
  const result = Cause.findError(cause)
  if (Result.isFailure(result)) {
    return undefined
  }
  return result.success
}
