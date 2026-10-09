# Stack-output synchronization and state protocol migration

State synchronization now mirrors resource records and outputs together. It snapshots all source resource records and the source output before mutating each stage, removes destination-only resources/stages, writes present outputs, and deletes absent outputs. Errors propagate even if earlier destination writes succeeded. Source and destination must be quiescent or externally coordinated. This is not a transactional snapshot across stages.

`StateService.deleteOutput({ stack, stage })` is required, idempotent, and must preserve resources. All built-in adapters implement it. In-memory and Cloudflare enumeration now includes output-only stages. `undefined` means absent. Stored null, falsy scalars, arrays, and objects are preserved. This does not change `Output.stackRef`'s separate null policy. Empty container/directory identity is not portable across backends.

## HTTP contract

- `GET /state/capabilities` returns protocol version 6 and `output-presence-v1`, `delete-output-v1`, and `output-stage-enumeration-v1`.
- `GET /v2/state/stacks/:stack/stages/:stage/output` returns `{ _tag: "Absent" }` or `{ _tag: "Present", value: encodedOutput }`.
- `DELETE /state/stacks/:stack/stages/:stage/output` returns 204, including repeated deletion.
- The original raw GET endpoint remains unchanged during the migration window.

The ordinary HTTP client checks all capabilities before listing, reading, or changing state. A successful check is cached per instance. Failed checks can be retried. `getVersion` remains available for bootstrap discovery. The generic wire protocol (6) and managed Cloudflare deployment revision (8) are distinct counters.

## Rollout and removal

1. Upgrade generic servers before generic clients. Existing clients keep their raw read endpoint during the compatibility window. Update custom StateService implementations to add output-only deletion in the same release.
2. Before upgrading a shared managed Cloudflare worker, update every operator and CI runner and stop older bootstrap processes. Older managed clients can redeploy older worker versions. Mixed managed versions are unsafe even though the raw endpoint remains. A rolling mixed-version release requires a separate anti-downgrade release first.
3. Set `ALCHEMY_STATE_STORE_V8_UPGRADE_READY=true` only after that rollout prerequisite is satisfied. The private bridge accepts only a positively identified v7 worker, is supplied only to its deployment, and explicitly rejects deleteOutput. It reads/writes the prior backend during the upgrade. Ordinary user stacks and sync never receive it.
4. After deployment, capability readback constructs the normal client. Failed deployment or readback remains an error. No stored-data rewrite or delete/recreate migration is performed. The upgrade does not promise automatic worker rollback.
5. Remove the deprecated raw read and private legacy bridge together in the next major state-protocol release after client migration and announced retirement. Keep additive endpoints through any client rollback.

## Verification and limits

78 focused tests passed across sync, filesystem, PostgreSQL contracts, HTTP errors and output codecs, managed upgrade orchestration, and transient errors. Five additional tests passed against an isolated PostgreSQL 15 instance, including output-only deletion with surviving resources. The temporary database was stopped after the run.

The HTTP tests use a real local server, production API schemas/client codecs, and fixture handlers. The managed-upgrade tests run the production orchestration with a callback that changes the fixture revision. They cover the rollout flag, failed deployment, state preservation, capability readback, and refusal to downgrade. They do not execute the Cloudflare Worker or Durable Object in a hosted account. Live Cloudflare upgrade and AWS S3 deletion remain unverified. Astra accepted the implementation with those evidence limits.

The standard pnpm entrypoint is blocked by its configured package-manager release-age policy. Tests ran through the existing alchemy-test runner using a temporary preload that changes dynamic test import to synchronous require to preserve local collection context. No tracked runner or package-manager policy was changed. Targeted typechecking found no changed-file errors, but dependency and existing unrelated-source diagnostics prevent a clean project typecheck.

This PR depends on the selected-stack synchronization fix.

## 2026-10-09 refresh

Merged current upstream main at 5ea356dcc25fab11bf3178e4ff1531a62708b51a. The original defect remains in upstream. 78 state/HTTP/upgrade tests passed. The transport retains upstream Schema.is authorization checks. Tests used the documented local runner preload. Provider qualification remains unchanged.
