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

export class LinearDomainError extends Error {
  readonly _tag = "LinearDomainError"
  readonly help?: string
  readonly code?: string
  readonly expected?: unknown
  readonly actual?: unknown
  readonly missing?: unknown
  readonly current?: unknown

  constructor(input: {
    message: string
    help?: string
    code?: string
    expected?: unknown
    actual?: unknown
    missing?: unknown
    current?: unknown
  }) {
    super(input.message)
    this.name = this._tag
    this.help = input.help
    this.code = input.code
    this.expected = input.expected
    this.actual = input.actual
    this.missing = input.missing
    this.current = input.current
  }
}

export type CliError = UsageError | AuthError | LinearApiError | LinearDomainError
