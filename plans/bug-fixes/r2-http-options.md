# R2 HTTP option contract

The REST transport explicitly rejects native-binding options it cannot implement. GET rejects range, onlyIf, and SSE-C. PUT rejects customMetadata (including an empty object), onlyIf, checksums, SSE-C, contentType/Content-Type, and cacheExpiry/Expires. Unsupported options fail through Effect.die(R2Error) before scope/credential resolution, body reads, or network access, following the existing HTTP R2 unsupported-operation convention.

Known fields are checked by property access, including inherited getters and non-enumerable values. Explicit undefined is absent. Native Headers extraction ignores unrelated headers. The supported PUT fields are storageClass, contentLength, contentEncoding, contentDisposition, contentLanguage, and cacheControl. The materialized body byte size must equal supplied contentLength before a request is sent. This check necessarily consumes streams to determine their size.

The installed SDK overwrites supplied Content-Type with application/octet-stream and derives Content-Length from materialized bodies. Content-Type therefore joins the rejected fields rather than appearing supported. Content-Length is validated before serialization. Supporting arbitrary content type requires an SDK correction or a separately scoped S3 transport.

Write results decode acknowledged key, size, etag, uploaded, version, and storageClass, rejecting malformed or missing required values. They do not echo unpersisted caller metadata and do not issue a follow-up read. Token permissions and auth paths remain unchanged. Native/local behavior and list parity are outside this bounded fix. Full S3 feature parity remains a separate transport decision.

## Verification and limits

28 tests passed through the real SDK with a substituted HTTP transport. They cover every unsupported field, empty/falsy and undefined values, inherited/non-enumerable options, both stream types before consumption, supported headers, UTF-8 byte lengths, malformed acknowledgements, missing-key reads, and ordinary no-option reads. Astra identified the property-enumeration bypass and discarded-length behavior in the first implementation. Both are corrected with regression cases.

No hosted Cloudflare calls or resource mutations were made. These checks qualify request serialization and local client behavior, not hosted permissions or provider acceptance. Targeted typechecking reports existing cloudflare-runtime errors outside the changed files. API reference generation is run from the source JSDoc.

The standard pnpm entrypoint was blocked by its configured release-age policy. Tests used the existing runner with a temporary synchronous-import preload for a local test-collection issue. No tracked runner or package-manager policy changed.

Astra accepted the corrected implementation with no remaining blocking findings.

## 2026-10-09 refresh

Merged current upstream main at 5ea356dcc25fab11bf3178e4ff1531a62708b51a. The original defect remains in upstream. 28 R2 HTTP tests passed with the current SDK. Test credentials now use its Redacted token contract. Tests used the documented local runner preload. Provider qualification remains unchanged.
