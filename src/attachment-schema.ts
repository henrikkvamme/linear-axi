import { Schema } from "effect"

const NonNegativeSafeInteger = Schema.Number.check(Schema.makeFilter(
  (value) => Number.isSafeInteger(value) && value >= 0,
  { expected: "a non-negative safe integer" }
))
const Sha256 = Schema.String.check(Schema.makeFilter(
  (value) => /^[a-f0-9]{64}$/i.test(value),
  { expected: "a hexadecimal SHA-256 digest" }
))
const MediaType = Schema.String.check(Schema.makeFilter(
  (value) => /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value),
  { expected: "an IANA media type" }
))
const HttpsUrl = Schema.String.check(Schema.makeFilter(
  (value) => {
    try {
      const url = new URL(value)
      return url.protocol === "https:" && !url.username && !url.password
    } catch { return false }
  },
  { expected: "an HTTPS URL without user information" }
))
const LinearPrivateAssetUrl = HttpsUrl.check(Schema.makeFilter(
  (value) => {
    const url = new URL(value)
    return url.hostname === "uploads.linear.app" && !url.search && !url.hash
  },
  { expected: "a private uploads.linear.app asset URL without query or fragment" }
))
const LinearDownloadUrl = HttpsUrl.check(Schema.makeFilter(
  (value) => new URL(value).origin === "https://uploads.linear.app",
  { expected: "an uploads.linear.app HTTPS URL on the default port" }
))
const LinearUploadUrl = HttpsUrl.check(Schema.makeFilter(
  (value) => {
    const url = new URL(value)
    return url.port === "" && (url.hostname === "storage.googleapis.com" || url.hostname.endsWith(".storage.googleapis.com"))
  },
  { expected: "a Google Cloud Storage HTTPS URL on the default port" }
))

const OptionalString = Schema.optionalKey(Schema.NullOr(Schema.String))
const OptionalNumber = Schema.optionalKey(Schema.NullOr(NonNegativeSafeInteger))
const OptionalSha256 = Schema.optionalKey(Schema.NullOr(Sha256))
const HeaderArraySchema = Schema.Array(Schema.Struct({ key: Schema.NonEmptyString, value: Schema.String }))
const HeadersSchema = Schema.Union([Schema.Record(Schema.String, Schema.String), HeaderArraySchema])
const ContentRequestSchema = Schema.Struct({ url: Schema.NonEmptyString, headers: Schema.optionalKey(HeadersSchema) })
const IssueIdentitySchema = Schema.Struct({ id: Schema.NonEmptyString, identifier: OptionalString })
const AttachmentWireSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  filename: OptionalString,
  name: OptionalString,
  title: OptionalString,
  subtitle: OptionalString,
  contentType: OptionalString,
  mediaType: OptionalString,
  mimeType: OptionalString,
  size: OptionalNumber,
  byteSize: OptionalNumber,
  createdAt: OptionalString,
  updatedAt: OptionalString,
  downloadUrl: OptionalString,
  contentUrl: OptionalString,
  assetUrl: OptionalString,
  url: OptionalString,
  sha256: OptionalSha256,
  checksum: OptionalSha256,
  issue: Schema.optionalKey(Schema.NullOr(IssueIdentitySchema)),
  downloadRequest: Schema.optionalKey(Schema.NullOr(ContentRequestSchema)),
  contentRequest: Schema.optionalKey(Schema.NullOr(ContentRequestSchema))
})
const IssueAttachmentsSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  identifier: OptionalString,
  attachments: Schema.Array(AttachmentWireSchema)
})
const PreparedUploadSchema = Schema.Struct({
  assetUrl: LinearPrivateAssetUrl,
  uploadRequest: Schema.Struct({ url: LinearUploadUrl, headers: Schema.optionalKey(HeadersSchema) })
})
const FinalizedUploadSchema = Schema.Union([
  Schema.Struct({ id: Schema.NonEmptyString }),
  Schema.Struct({ attachment: Schema.Struct({ id: Schema.NonEmptyString }) })
])
const UploadRecoverySchema = Schema.Struct({
  version: Schema.Literal(1),
  stage: Schema.Literals(["prepared", "transferred", "finalized"]),
  issueId: Schema.NonEmptyString,
  issueIdentifier: Schema.NonEmptyString,
  filename: Schema.NonEmptyString,
  size: NonNegativeSafeInteger,
  mediaType: MediaType,
  sha256: Sha256,
  title: Schema.NullOr(Schema.String),
  subtitle: Schema.NullOr(Schema.String),
  assetUrl: Schema.NullOr(LinearPrivateAssetUrl),
  attachmentId: Schema.NullOr(Schema.String)
})
const AttachmentCursorSchema = Schema.Struct({
  issue: Schema.NonEmptyString,
  offset: NonNegativeSafeInteger,
  snapshot: Sha256
})

export type AttachmentWire = Schema.Schema.Type<typeof AttachmentWireSchema>
export type IssueAttachments = Schema.Schema.Type<typeof IssueAttachmentsSchema>
export type HeadersWire = Schema.Schema.Type<typeof HeadersSchema>
export type PreparedUploadWire = Schema.Schema.Type<typeof PreparedUploadSchema>
export type FinalizedUploadWire = Schema.Schema.Type<typeof FinalizedUploadSchema>

export const decodeAttachmentWire = Schema.decodeUnknownSync(AttachmentWireSchema)
export const decodeIssueAttachments = Schema.decodeUnknownSync(IssueAttachmentsSchema)
export const decodeHeadersWire = Schema.decodeUnknownSync(HeadersSchema)
export const decodePreparedUploadWire = Schema.decodeUnknownSync(PreparedUploadSchema)
export const decodeFinalizedUpload = Schema.decodeUnknownSync(FinalizedUploadSchema)
export const decodeUploadRecovery = Schema.decodeUnknownSync(UploadRecoverySchema)
export const decodeAttachmentCursor = Schema.decodeUnknownSync(AttachmentCursorSchema)
export const decodeHttpsUrl = Schema.decodeUnknownSync(HttpsUrl)
export const decodeLinearDownloadUrl = Schema.decodeUnknownSync(LinearDownloadUrl)
export const decodeLinearUploadUrl = Schema.decodeUnknownSync(LinearUploadUrl)
