export class UsageError extends Error {
  readonly _tag = "UsageError"
  readonly help?: string

  constructor(input: { message: string; help?: string }) {
    super(input.message)
    this.name = this._tag
    this.help = input.help
  }
}

export class AuthError extends Error {
  readonly _tag = "AuthError"
  readonly help?: string

  constructor(input: { message: string; help?: string }) {
    super(input.message)
    this.name = this._tag
    this.help = input.help
  }
}

export class LinearApiError extends Error {
  readonly _tag = "LinearApiError"
  readonly help?: string

  constructor(input: { message: string; help?: string }) {
    super(input.message)
    this.name = this._tag
    this.help = input.help
  }
}

export type CliError = UsageError | AuthError | LinearApiError
