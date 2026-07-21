import { Schema } from "effect"

const OptionalString = Schema.optionalKey(Schema.NullOr(Schema.String))
const OptionalNumber = Schema.optionalKey(Schema.NullOr(Schema.Number))
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
  sha256: OptionalString,
  checksum: OptionalString,
  issue: Schema.optionalKey(Schema.NullOr(IssueIdentitySchema)),
  downloadRequest: Schema.optionalKey(Schema.NullOr(ContentRequestSchema)),
  contentRequest: Schema.optionalKey(Schema.NullOr(ContentRequestSchema))
})
const IssueAttachmentsSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  identifier: OptionalString,
  attachments: Schema.Array(AttachmentWireSchema)
})
const PreparedUploadSchema = Schema.Struct({ assetUrl: Schema.NonEmptyString, uploadRequest: ContentRequestSchema })
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
  size: Schema.Number,
  mediaType: Schema.NonEmptyString,
  sha256: Schema.NonEmptyString,
  title: Schema.NullOr(Schema.String),
  subtitle: Schema.NullOr(Schema.String),
  assetUrl: Schema.NullOr(Schema.String),
  attachmentId: Schema.NullOr(Schema.String)
})
const AttachmentCursorSchema = Schema.Struct({ issue: Schema.NonEmptyString, offset: Schema.Number })

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
