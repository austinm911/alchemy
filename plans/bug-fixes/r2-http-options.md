# docs(plan): reject unsupported R2 HTTP options before requests

This draft proposes eliminating silent option loss in R2's HTTP clients. Reads currently discard range and conditional options. Writes discard custom metadata, then return it as if it were stored. Astra confirmed both P2 defects using the real Alchemy client and SDK serializer with a substituted HTTP transport. [Read source](https://github.com/austinm911/alchemy/blob/6c7e69114c0bd9cea2de2eb04b004631b041bb08/packages/alchemy/src/Cloudflare/R2/ReadBucketHttp.ts#L79), [write source](https://github.com/austinm911/alchemy/blob/6c7e69114c0bd9cea2de2eb04b004631b041bb08/packages/alchemy/src/Cloudflare/R2/WriteBucketHttp.ts#L66)

The same review found that conditional writes are ignored too. Guarding only custom metadata would leave that failure intact.

### Proposed support boundary

Validate all accepted get/put options before credentials, requests, or upload-body consumption. Implemented options proceed. Unsupported options fail explicitly using the existing typed R2Error defect convention for HTTP-unsupported operations.

```text
get(key, options):
    reject supplied range, onlyIf, or ssecKey
    return existing unconditioned HTTP read(key)

put(key, value, options):
    reject supplied customMetadata, onlyIf, checksums, or ssecKey
    normalize httpMetadata and reject cacheExpiry/Expires
    allow only metadata headers actually encoded by this transport,
        contentLength, and storageClass
    response = upload(key, consume(value), supportedOptions)
    return decodeAcknowledgedObject(response)

reject unsupported options:
    treat undefined as absent, but not {}, "", 0, or false
    die with R2Error naming unsupported fields, without their values
```

Do not fabricate stored metadata from caller input, emulate conditional PUT with HEAD followed by PUT, add a metadata read to a write-only client, or broaden token permissions. Keep native and local-emulator bindings unchanged. Remote `*Local` clients share the HTTP validation and retain their existing credentials.

### Stronger transport proposal

Full range, conditional, and custom-metadata support belongs in an S3-backed object adapter with shared response normalization and explicit credential capabilities. That would need correct condition-result handling, object size/range metadata, jurisdiction endpoints, and an opt-in S3 credential path for local OAuth/API-key callers. It must not silently mint tokens or widen permissions. This broader proposal is separate from the bounded correction above.

The management API and SDK do not document/model all these options. That is not proof the server cannot support undocumented headers. This plan makes the supported contract explicit without claiming native parity. [Workers contract](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [management GET](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/get/), [management upload](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/upload/), [S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)

## Implementation scope and validation

Own `Cloudflare/R2/ReadBucketHttp.ts`, `WriteBucketHttp.ts`, internal validation in `BucketHttp.ts` or a single internal `HttpOptions.ts`, and focused serializer/behavior tests. Update the HTTP and remote-Local JSDoc to list restrictions. Native option types remain the public contract. Do not hand-edit generated provider documentation.

Infer the validation key sets from GetOptions and PutOptions and make coverage exhaustive so newly added native fields require an explicit support decision. Current GetOptions fields are range, onlyIf, and ssecKey. Current supported PUT values are contentLength, storageClass, and the encoded httpMetadata fields contentType, contentEncoding, contentDisposition, contentLanguage, and cacheControl. Every checksum option, conditional option, SSE-C key, customMetadata, and cacheExpiry requires rejection until deliberately supported. Validate before reading a ReadableStream or Effect Stream, resolving account/token effects, or issuing a request.

A supplied customMetadata object is unsupported even when empty. Metadata Headers need native-style extraction: recognize Content-Type, Content-Encoding, Content-Disposition, Content-Language, Cache-Control, and Expires. Reject Expires because the adapter currently cannot preserve it. Unrelated arbitrary headers do not become metadata and should follow native extraction behavior rather than all being rejected.

Use existing R2Error with Effect.die to match AGENTS.md's current HTTP-unsupported-operation convention. This remains a defect, not a new catchTag-recoverable failure promise. A policy change to Effect.fail would be a separate explicit contract change. Errors must name fields without disclosing option or credential values.

Build successful PUT result metadata from the acknowledged SDK response, which models key, size, ETag, uploaded timestamp, version, and storage class. Validate numeric/date conversions and normalize quoted ETags. Do not silently substitute request data for missing storage acknowledgements. Do not add a follow-up GET or HEAD for a write-only binding. Base-object defaults and response-required fields must be reconciled without fabricating an acknowledgement. The exact decoding uses the pinned SDK schema.

Validation includes request capture through the real SDK, each unsupported option alone, combined options, empty/falsy supplied values, zero requests and zero stream reads on rejection, supported PUT headers, SDK response normalization, missing-key handling, and unchanged no-option behavior. Exercise read-only/write-only authorization separately. Explicitly exclude list-option parity from this proposal; list is not validated by a successful get/put correction.

The broader S3 proposal would replace data-plane get/put handling, not add a racy HEAD-before-PUT workaround. It must preserve native failed-get semantics (metadata without body), failed-put semantics (null), full object size versus returned range, and supported custom metadata. Existing Worker S3Credentials derives credentials from a scoped token, but current HttpToken lacks token ID and remote Local accepts credentials that are not directly usable for S3. Any later migration needs an explicit auth-capability contract and deprecation/removal of superseded object transport paths. Do not claim this draft delivers that parity.

Compatibility: previously ignored options will now fail before a side effect. Document that intentional correction and direct callers needing those options to the native binding or an explicitly configured S3 client. Ordinary no-option HTTP reads/writes retain their auth and permission behavior. No cloud resources or token grants change in this bounded fix.
