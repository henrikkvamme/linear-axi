import { createHash, randomBytes } from "node:crypto"
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { dirname, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { Effect } from "effect"
import { UsageError, LinearApiError } from "./errors"
import { credentialsFilePath, parseDotEnv, type Env } from "./env"
import type { OutputValue } from "./output"

const authorizeEndpoint = "https://linear.app/oauth/authorize"
const tokenEndpoint = "https://api.linear.app/oauth/token"
const defaultRedirectUri = "http://127.0.0.1:14582/oauth/callback"
const registerEndpoint = "https://linear.app/settings/api/applications/new"
const defaultClientId = "ccca1dd4294ba5c02db81a5db629ba17"

export interface OAuthConnectInput {
  env: Env
  credentialPathEnv: Env
  cwd: string
  clientId?: string
  redirectUri?: string
  scope?: string
  actor?: string
  promptConsent: boolean
  notify: boolean
  openBrowser: boolean
  writeEnv: boolean
  envFile?: string
  timeoutSeconds?: number
}

export interface OAuthSetupInput {
  env: Env
  redirectUri?: string
  scope?: string
  actor?: string
  notify: boolean
}

export interface OAuthSession {
  state: string
  codeVerifier: string
  codeChallenge: string
  authorizeUrl: string
  redirectUri: string
  scope: string
  actor: "user" | "app"
}

export interface OAuthTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope: string | ReadonlyArray<string>
  refresh_token?: string
}

export interface BrowserOpenCommand {
  command: string
  args: ReadonlyArray<string>
}

export interface BrowserOpenOptions {
  platform?: NodeJS.Platform
  launch?: (command: string, args: ReadonlyArray<string>) => number | null
}

export const browserOpenCommand = (platform: NodeJS.Platform, url: string): BrowserOpenCommand | undefined => {
  switch (platform) {
    case "darwin":
      return { command: "open", args: [url] }
    case "linux":
      return { command: "xdg-open", args: [url] }
    case "win32":
      return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] }
    default:
      return undefined
  }
}

export const openOAuthUrl = (url: string, options: BrowserOpenOptions = {}): Effect.Effect<boolean> =>
  Effect.sync(() => {
    const opener = browserOpenCommand(options.platform ?? process.platform, url)
    if (!opener) {
      process.stderr.write("No supported browser opener was found. Open the OAuth URL above manually.\n")
      return false
    }

    const launch = options.launch ?? ((command: string, args: ReadonlyArray<string>) =>
      spawnSync(command, [...args], { stdio: "ignore" }).status)
    const opened = launch(opener.command, opener.args) === 0
    if (!opened) {
      process.stderr.write(`Could not open the browser with ${opener.command}. Open the OAuth URL above manually.\n`)
    }
    return opened
  })

export const setupOAuth = (input: OAuthSetupInput): Effect.Effect<OutputValue, UsageError | LinearApiError> =>
  Effect.gen(function*() {
    const redirectUri = input.redirectUri ?? input.env.LINEAR_OAUTH_REDIRECT_URI ?? defaultRedirectUri
    const scope = input.scope ?? input.env.LINEAR_OAUTH_SCOPE ?? "read,write"
    const actor = yield* normalizeActor(input.actor ?? input.env.LINEAR_OAUTH_ACTOR ?? "user")

    yield* validateLocalRedirectUri(redirectUri)

    if (input.notify) {
      yield* notifyBender(registerEndpoint, [
        "Create a Linear OAuth application for linear-axi.",
        `Use redirect URI: ${redirectUri}`,
        "Enable Public if this client should connect multiple Linear workspaces.",
        "Leave webhooks disabled for the CLI login flow.",
        "After Linear shows the Client ID, add LINEAR_OAUTH_CLIENT_ID to this repo's .env."
      ].join(" "))
    }

    return {
      oauthSetup: {
        phase: "register-client",
        registerUrl: registerEndpoint,
        redirectUri,
        scope,
        actor,
        installableByOtherWorkspaces: true,
        webhooks: false
      },
      help: [
        "This is OAuth app registration, not the user consent screen.",
        "Linear's hosted MCP flow is already backed by Linear's own OAuth client. This local CLI needs a Client ID first.",
        "Enable Public in Linear if this client should connect workspaces beyond the workspace where the app is created.",
        "Create an OAuth application with the redirect URI above, then add LINEAR_OAUTH_CLIENT_ID=<client-id> to .env.",
        "Then run `linear-axi auth oauth connect --write-env --prompt-consent --notify`."
      ]
    }
  })

export const connectOAuth = (input: OAuthConnectInput): Effect.Effect<OutputValue, UsageError | LinearApiError> =>
  Effect.gen(function*() {
    const clientId = input.clientId ?? input.env.LINEAR_OAUTH_CLIENT_ID ?? defaultClientId
    if (!clientId) {
      return yield* Effect.fail(new UsageError({
        message: "Linear OAuth client id is not configured",
        help: "Run `linear-axi auth oauth setup --notify` to register a Linear OAuth application, then set LINEAR_OAUTH_CLIENT_ID in .env."
      }))
    }

    const redirectUri = input.redirectUri ?? input.env.LINEAR_OAUTH_REDIRECT_URI ?? defaultRedirectUri
    const scope = input.scope ?? input.env.LINEAR_OAUTH_SCOPE ?? "read,write"
    const actor = yield* normalizeActor(input.actor ?? input.env.LINEAR_OAUTH_ACTOR ?? "user")
    const timeoutSeconds = input.timeoutSeconds ?? 300
    const defaultEnvFile = credentialsFilePath(input.credentialPathEnv)
    const envFile = resolve(input.cwd, input.envFile ?? defaultEnvFile)

    yield* validateLocalRedirectUri(redirectUri)

    if (input.writeEnv) {
      yield* ensureEnvFileCanStoreSecrets(envFile, input.cwd, defaultEnvFile)
    }

    const session = createOAuthSession({
      clientId,
      redirectUri,
      scope,
      actor,
      promptConsent: input.promptConsent
    })

    process.stderr.write(`Open this Linear OAuth URL:\n${session.authorizeUrl}\n`)
    process.stderr.write("If the browser cannot reach localhost after approval, paste the full callback URL here and press Enter.\n")

    if (input.notify) {
      yield* notifyBender(session.authorizeUrl, `Authorize Linear OAuth for linear-axi: ${session.authorizeUrl}`)
    } else if (input.openBrowser) {
      yield* openOAuthUrl(session.authorizeUrl)
    }

    const code = yield* waitForOAuthCode({
      redirectUri,
      state: session.state,
      timeoutSeconds
    })

    const token = yield* exchangeCodeForToken({
      clientId,
      code,
      codeVerifier: session.codeVerifier,
      redirectUri
    })

    if (input.writeEnv) {
      yield* writeOAuthEnv(envFile, {
        LINEAR_OAUTH_CLIENT_ID: clientId,
        LINEAR_OAUTH_REDIRECT_URI: redirectUri,
        LINEAR_OAUTH_SCOPE: scope,
        LINEAR_OAUTH_ACTOR: actor,
        LINEAR_ACCESS_TOKEN: token.access_token,
        LINEAR_OAUTH_REFRESH_TOKEN: token.refresh_token,
        LINEAR_OAUTH_EXPIRES_AT: new Date(Date.now() + token.expires_in * 1000).toISOString()
      })
    }

    return {
      auth: {
        connected: true,
        method: "oauth",
        actor,
        scope: normalizeScope(token.scope),
        tokenType: token.token_type,
        expiresIn: token.expires_in,
        refreshToken: token.refresh_token ? "stored" : "missing",
        envFile: input.writeEnv ? collapsePath(envFile, input.cwd, input.credentialPathEnv) : "not written"
      },
      help: input.writeEnv
        ? ["Run `linear-axi auth status` to verify the saved token.", "Run `linear-axi teams list --limit 50` to inspect the connected workspace."]
        : ["Rerun with `--write-env` to save tokens to .env.", "Do not paste OAuth tokens into chat or command logs."]
    }
  })

export const createOAuthSession = (input: {
  clientId: string
  redirectUri: string
  scope: string
  actor: "user" | "app"
  promptConsent: boolean
}): OAuthSession => {
  const state = base64Url(randomBytes(32))
  const codeVerifier = base64Url(randomBytes(64))
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest())
  const url = new URL(authorizeEndpoint)
  url.searchParams.set("client_id", input.clientId)
  url.searchParams.set("redirect_uri", input.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", input.scope)
  url.searchParams.set("state", state)
  url.searchParams.set("actor", input.actor)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  if (input.promptConsent) {
    url.searchParams.set("prompt", "consent")
  }

  return {
    state,
    codeVerifier,
    codeChallenge,
    authorizeUrl: url.toString(),
    redirectUri: input.redirectUri,
    scope: input.scope,
    actor: input.actor
  }
}

const waitForOAuthCode = (input: {
  redirectUri: string
  state: string
  timeoutSeconds: number
}): Effect.Effect<string, UsageError | LinearApiError> =>
  Effect.callback<string, UsageError | LinearApiError>((resume) => {
    const redirectUrl = new URL(input.redirectUri)
    const port = Number(redirectUrl.port)
    const host = redirectUrl.hostname
    const callbackPath = redirectUrl.pathname
    let settled = false
    let manualBuffer = ""
    const cleanup = () => {
      clearTimeout(timer)
      process.stdin.off("data", onManualCallback)
      process.stdin.pause()
      server.closeAllConnections()
      server.close()
    }
    const settle = (effect: Effect.Effect<string, LinearApiError>) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resume(effect)
    }
    const onManualCallback = (chunk: Buffer | string) => {
      manualBuffer += chunk.toString()
      let newlineIndex = manualBuffer.search(/\r?\n/)
      while (newlineIndex !== -1) {
        const line = manualBuffer.slice(0, newlineIndex).trim()
        manualBuffer = manualBuffer.slice(newlineIndex + (manualBuffer[newlineIndex] === "\r" && manualBuffer[newlineIndex + 1] === "\n" ? 2 : 1))
        if (line.length > 0) {
          const effect = readOAuthCodeFromCallbackUrl(line, {
            callbackPath,
            expectedState: input.state
          })
          settle(effect)
          return
        }
        newlineIndex = manualBuffer.search(/\r?\n/)
      }
    }
    const server = createServer((request, response) => {
      handleCallbackRequest(request, response, {
        callbackPath,
        expectedState: input.state,
        settle
      })
    })

    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resume(Effect.fail(new LinearApiError({
        message: "Timed out waiting for Linear OAuth callback",
        help: "Rerun `linear-axi auth oauth connect` and complete the browser authorization before the timeout."
      })))
    }, input.timeoutSeconds * 1000)

    server.on("error", (cause) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resume(Effect.fail(new LinearApiError({
        message: readableError(cause),
        help: "Check that the redirect URI port is available, then rerun auth."
      })))
    })

    process.stdin.on("data", onManualCallback)
    process.stdin.resume()
    server.listen(port, host)
    return Effect.sync(() => {
      cleanup()
    })
  })

const handleCallbackRequest = (
  request: IncomingMessage,
  response: ServerResponse,
  input: {
    callbackPath: string
    expectedState: string
    settle: (effect: Effect.Effect<string, LinearApiError>) => void
  }
): void => {
  const requestUrl = new URL(request.url ?? "/", "http://localhost")
  if (requestUrl.pathname !== input.callbackPath) {
    response.writeHead(404, { "content-type": "text/plain" })
    response.end("Not found")
    return
  }

  const state = requestUrl.searchParams.get("state") ?? ""
  if (state !== input.expectedState) {
    response.writeHead(400, { "content-type": "text/plain" })
    response.end("Invalid OAuth state. Keep the auth tab open and retry from Linear.")
    return
  }

  const error = requestUrl.searchParams.get("error")
  if (error) {
    response.writeHead(400, { "content-type": "text/plain" })
    response.end("Linear authorization failed. You can close this tab.")
    input.settle(Effect.fail(new LinearApiError({
      message: `Linear OAuth returned ${error}`,
      help: "Retry after approving the requested Linear access."
    })))
    return
  }

  const code = requestUrl.searchParams.get("code")
  if (!code) {
    response.writeHead(400, { "content-type": "text/plain" })
    response.end("Missing OAuth code. Keep the auth tab open and retry from Linear.")
    return
  }

  response.writeHead(200, { "content-type": "text/plain" })
  response.end("Linear authorization complete. You can close this tab.")
  input.settle(Effect.succeed(code))
}

export const readOAuthCodeFromCallbackUrl = (
  callbackUrl: string,
  input: {
    callbackPath: string
    expectedState: string
  }
): Effect.Effect<string, LinearApiError> => {
  let requestUrl: URL
  try {
    requestUrl = new URL(callbackUrl)
  } catch {
    return Effect.fail(new LinearApiError({
      message: "Pasted OAuth callback URL is not a valid URL",
      help: "Paste the full callback URL from the browser address bar."
    }))
  }

  if (requestUrl.pathname !== input.callbackPath) {
    return Effect.fail(new LinearApiError({
      message: "Pasted OAuth callback URL path did not match the configured redirect URI",
      help: "Paste the full callback URL that starts with the configured OAuth redirect URI."
    }))
  }

  const state = requestUrl.searchParams.get("state") ?? ""
  if (state !== input.expectedState) {
    return Effect.fail(new LinearApiError({
      message: "Pasted OAuth callback URL had an invalid state",
      help: "Restart `linear-axi auth login`; OAuth callback URLs are tied to one active login attempt."
    }))
  }

  const error = requestUrl.searchParams.get("error")
  if (error) {
    return Effect.fail(new LinearApiError({
      message: `Linear OAuth returned ${error}`,
      help: "Retry after approving the requested Linear access."
    }))
  }

  const code = requestUrl.searchParams.get("code")
  if (!code) {
    return Effect.fail(new LinearApiError({
      message: "Pasted OAuth callback URL did not include an authorization code",
      help: "Paste the full callback URL from the browser address bar after approving Linear access."
    }))
  }

  return Effect.succeed(code)
}

const exchangeCodeForToken = (input: {
  clientId: string
  code: string
  codeVerifier: string
  redirectUri: string
}): Effect.Effect<OAuthTokenResponse, LinearApiError> =>
  Effect.tryPromise({
    try: async () => {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: input.clientId,
        redirect_uri: input.redirectUri,
        code: input.code,
        code_verifier: input.codeVerifier
      })
      const response = await fetch(tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      })
      const json = await response.json() as Record<string, unknown>
      if (!response.ok) {
        throw new Error(readOAuthError(json, response.status))
      }
      return tokenResponse(json)
    },
    catch: (cause) =>
      new LinearApiError({
        message: readableError(cause),
        help: "Check the OAuth app redirect URI and rerun `linear-axi auth oauth connect`."
      })
  })

const notifyBender = (url: string, reason: string): Effect.Effect<void, LinearApiError> =>
  Effect.try({
    try: () => {
      const fullReason = reason.includes(url) ? reason : `${reason} Open: ${url}`
      const result = spawnSync("bender-browser", [
        "request",
        "--service",
        "Linear",
        "--domain",
        "linear.app",
        "--task-id",
        `linear-axi-oauth-${Date.now()}`,
        "--reason",
        fullReason
      ], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      })

      if (result.stdout.length > 0) {
        process.stderr.write(result.stdout)
      }
      if (result.stderr.length > 0) {
        process.stderr.write(result.stderr)
      }
      if (result.status !== 0) {
        throw new Error(`bender-browser exited ${result.status ?? "without a status"}`)
      }
    },
    catch: (cause) =>
      new LinearApiError({
        message: readableError(cause),
        help: "Run without --notify, or verify `bender-browser request` works."
      })
  })

const validateLocalRedirectUri = (redirectUri: string): Effect.Effect<void, UsageError> =>
  Effect.try({
    try: () => {
      const redirectUrl = new URL(redirectUri)
      const port = Number(redirectUrl.port)
      if (!redirectUrl.port || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("missing port")
      }
      if (!isLoopbackHost(redirectUrl.hostname)) {
        throw new Error("non-loopback host")
      }
    },
    catch: (cause) => {
      const message = cause instanceof Error && cause.message === "non-loopback host"
        ? "redirect URI host must be localhost or loopback"
        : "redirect URI must include an explicit local callback port"
      return new UsageError({
        message,
        help: "Use --redirect-uri http://127.0.0.1:14582/oauth/callback."
      })
    }
  })

const ensureEnvFileCanStoreSecrets = (
  envFile: string,
  cwd: string,
  defaultEnvFile: string
): Effect.Effect<void, UsageError> =>
  Effect.try({
    try: () => {
      if (resolve(envFile) === resolve(defaultEnvFile)) {
        ensureCredentialDirectory(dirname(envFile))
        ensureRegularCredentialFile(envFile)
        return
      }

      const relative = relativeToCwd(envFile, cwd)
      if (relative.startsWith("/")) {
        throw new Error("env file is outside the current repo")
      }
      ensureCredentialDirectory(dirname(envFile))
      ensureRegularCredentialFile(envFile)
      const result = spawnSync("git", ["check-ignore", "-q", "--", relative], {
        cwd,
        stdio: "ignore"
      })
      if (result.status !== 0) {
        throw new Error(`${relative} is not gitignored`)
      }
    },
    catch: (cause) =>
      new UsageError({
        message: cause instanceof Error && cause.message.includes("symbolic link")
          ? "refusing to write OAuth tokens through a credential-path symlink"
          : "refusing to write OAuth tokens to an unsafe env file",
        help: "Use the default credentials file, or choose a gitignored --env-file inside the current repo."
      })
  })

export const writeOAuthEnv = (
  envFile: string,
  values: Record<string, string | undefined>
): Effect.Effect<void, LinearApiError> =>
  Effect.try({
    try: () => {
      const directory = ensureCredentialDirectory(dirname(envFile))
      const directoryStat = lstatSync(directory)
      const existing = readCredentialEnv(envFile)
      const next = { ...existing, ...values }
      if (values.LINEAR_ACCESS_TOKEN) {
        delete next.LINEAR_API_KEY
      } else if (values.LINEAR_API_KEY) {
        delete next.LINEAR_ACCESS_TOKEN
      }
      const orderedKeys = [
        "LINEAR_OAUTH_CLIENT_ID",
        "LINEAR_OAUTH_REDIRECT_URI",
        "LINEAR_OAUTH_SCOPE",
        "LINEAR_OAUTH_ACTOR",
        "LINEAR_ACCESS_TOKEN",
        "LINEAR_OAUTH_REFRESH_TOKEN",
        "LINEAR_OAUTH_EXPIRES_AT"
      ]
      const seen = new Set<string>()
      const lines: Array<string> = []
      for (const key of orderedKeys) {
        const value = next[key]
        if (value !== undefined && value.length > 0) {
          lines.push(`${key}=${quoteDotEnv(value)}`)
          seen.add(key)
        }
      }
      for (const [key, value] of Object.entries(next).sort(([left], [right]) => left.localeCompare(right))) {
        if (!seen.has(key) && value !== undefined) {
          lines.push(`${key}=${quoteDotEnv(value)}`)
        }
      }

      const temporaryFile = `${envFile}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`
      let temporaryFileExists = false
      try {
        writeFileSync(temporaryFile, `${lines.join("\n")}\n`, { flag: "wx", mode: 0o600 })
        temporaryFileExists = true
        const currentDirectoryStat = lstatSync(directory)
        if (
          currentDirectoryStat.isSymbolicLink() ||
          currentDirectoryStat.dev !== directoryStat.dev ||
          currentDirectoryStat.ino !== directoryStat.ino
        ) {
          throw new Error("credential directory changed while writing")
        }
        renameSync(temporaryFile, envFile)
        temporaryFileExists = false
      } finally {
        if (temporaryFileExists) {
          rmSync(temporaryFile, { force: true })
        }
      }
    },
    catch: (cause) =>
      new LinearApiError({
        message: readableError(cause),
        help: "Check the credentials file permissions and rerun auth."
      })
  })

const ensureCredentialDirectory = (directory: string): string => {
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
  }

  const stat = lstatSync(directory)
  if (stat.isSymbolicLink()) {
    throw new Error("credential directory is a symbolic link")
  }
  if (!stat.isDirectory()) {
    throw new Error("credential directory is not a directory")
  }
  return directory
}

const ensureRegularCredentialFile = (envFile: string): void => {
  if (!existsSync(envFile)) {
    return
  }

  const stat = lstatSync(envFile)
  if (stat.isSymbolicLink()) {
    throw new Error("credential file is a symbolic link")
  }
  if (!stat.isFile()) {
    throw new Error("credential file is not a regular file")
  }
}

const readCredentialEnv = (envFile: string): Env => {
  if (!existsSync(envFile)) {
    return {}
  }

  const pathStat = lstatSync(envFile)
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
    throw new Error("credential file is not a regular file")
  }

  const descriptor = openSync(envFile, "r")
  try {
    const descriptorStat = fstatSync(descriptor)
    if (descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) {
      throw new Error("credential file changed while reading")
    }
    return parseDotEnv(readFileSync(descriptor, "utf8"))
  } finally {
    closeSync(descriptor)
  }
}

const normalizeActor = (actor: string): Effect.Effect<"user" | "app", UsageError> => {
  if (actor === "user" || actor === "app") {
    return Effect.succeed(actor)
  }
  return Effect.fail(new UsageError({
    message: "--actor must be `user` or `app`",
    help: "Usage: linear-axi auth oauth connect --client-id <id> [--actor user|app]"
  }))
}

const tokenResponse = (json: Record<string, unknown>): OAuthTokenResponse => {
  if (
    typeof json.access_token !== "string" ||
    typeof json.token_type !== "string" ||
    typeof json.expires_in !== "number" ||
    (typeof json.scope !== "string" && !Array.isArray(json.scope))
  ) {
    throw new Error("Linear OAuth token response was missing expected fields")
  }

  return {
    access_token: json.access_token,
    token_type: json.token_type,
    expires_in: json.expires_in,
    scope: json.scope as string | ReadonlyArray<string>,
    refresh_token: typeof json.refresh_token === "string" ? json.refresh_token : undefined
  }
}

const readOAuthError = (json: Record<string, unknown>, status: number): string => {
  const description = typeof json.error_description === "string" ? json.error_description : undefined
  const error = typeof json.error === "string" ? json.error : undefined
  return description ?? error ?? `Linear OAuth token exchange failed with HTTP ${status}`
}

const base64Url = (bytes: Buffer): string =>
  bytes.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")

const isLoopbackHost = (host: string): boolean =>
  host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]"

const normalizeScope = (scope: string | ReadonlyArray<string>): string =>
  typeof scope === "string" ? scope : scope.join(" ")

const quoteDotEnv = (value: string): string => {
  if (/^[A-Za-z0-9_./:@,+-]+$/.test(value)) {
    return value
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("\n", "\\n")}"`
}

const relativeToCwd = (file: string, cwd: string): string => {
  const cwdWithSlash = resolve(cwd)
  const absolute = resolve(file)
  return absolute.startsWith(`${cwdWithSlash}/`) ? absolute.slice(cwdWithSlash.length + 1) : absolute
}

const collapseCwd = (file: string, cwd: string): string => {
  const relative = relativeToCwd(file, cwd)
  return relative.startsWith("/") ? file : relative
}

const collapsePath = (file: string, cwd: string, env: Env): string => {
  const home = env.HOME
  if (home && (file === home || file.startsWith(`${home}/`))) {
    return `~${file.slice(home.length)}`
  }
  return collapseCwd(file, cwd)
}

const readableError = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message.replaceAll(/\s+/g, " ").trim()
  }

  return "Linear OAuth request failed"
}
