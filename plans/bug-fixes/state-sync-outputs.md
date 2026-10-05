# docs(plan): synchronize stack outputs across state stores

This draft proposes a complete mirror of resource records and stack outputs. `syncState` currently copies resource rows but never copies or clears outputs. A fresh destination loses cross-stack outputs, while an existing destination retains stale values. [Sync source](https://github.com/austinm911/alchemy/blob/6c7e69114c0bd9cea2de2eb04b004631b041bb08/packages/alchemy/src/State/Sync.ts#L46), [cross-stack consumer](https://github.com/austinm911/alchemy/blob/6c7e69114c0bd9cea2de2eb04b004631b041bb08/packages/alchemy/src/Output.ts#L640)

Astra reproduced both cases with the real state backend. This is a P2 public-utility defect. The proposal also covers output-only stages, which current in-memory and Cloudflare stage enumeration omit.

### Proposed state contract

Add an idempotent output-only deletion operation. Preserve `undefined` as absence and preserve every stored value, including `null`, `0`, `false`, empty strings, arrays, and objects. Resource rows must survive output deletion.

```ts
// Proposed addition to StateService.
deleteOutput(request: {
  stack: string
  stage: string
}): Effect.Effect<void, StateStoreError>
```

```text
for each selected stack:
    discover stages from BOTH resource records and output records
    for each stage in union(sourceStages, destinationStages):
        if stage is absent from source:
            destination.deleteStack({ stack, stage })
            continue

        sourceOutput = source.getOutput({ stack, stage })
        decode/validate source data before changing this stage
        synchronize resource rows in this stage
        if sourceOutput is undefined:
            destination.deleteOutput({ stack, stage })
        else:
            destination.setOutput({ stack, stage, value: sourceOutput })
```

### HTTP compatibility

Use a new versioned output-read endpoint with an explicit presence envelope. Keep the existing raw-output endpoint unchanged during migration so old clients cannot mistake an envelope for application data.

```text
GET /state/capabilities
  -> { protocolVersion: 6,
       capabilities: ["output-presence-v1", "delete-output-v1",
                      "output-stage-enumeration-v1"] }

GET /v2/state/stacks/:stack/stages/:stage/output
  -> { _tag: "Absent" }
  or { _tag: "Present", value: encodedOutput }

DELETE /state/stacks/:stack/stages/:stage/output
  -> 204, including when already absent
```

Negotiate this contract before normal HTTP state use. Give managed-store upgrades a private legacy bootstrap transport for reading the existing store while replacing its worker. Keep the protocol capability version separate from the managed Cloudflare deployment version. This proposes a required custom-adapter method and an additive server API, with the rollout and retirement sequence in the attached plan. It does not claim transactional synchronization or change null handling in `Output.stackRef`.

## Implementation scope and validation

Own the following implementation changes:

- `packages/alchemy/src/State/State.ts`: required `deleteOutput` method and precise output/absence semantics.
- `State/Sync.ts`: per-stage output synchronization and deletion of destination-only stages, using the selected-stack mutation boundary from the selection fix.
- `State/InMemoryState.ts`: union resource/output stack and stage keys, and delete only the requested output.
- `State/LocalState.ts`: remove only the output file, tolerate NotFound, and keep resource files intact. Never serialize undefined as a deletion substitute.
- `State/PostgresState.ts`: delete only the stack-output row through the existing lease/guard path.
- `AWS/StateStore/State.ts`: delete only the output object key, using the existing credentials and error mapping.
- `State/HttpStateApi.ts` and `State/HttpStateStore.ts`: additive capabilities, versioned output presence read, output delete, and single boundary decode using a Schema.TaggedUnion.
- `Cloudflare/StateStore/Store.ts` and `Cloudflare/StateStore/Api.ts`: enumerate output keys as well as resource keys, keep output-only stacks registered, implement output deletion and the new endpoints.
- `Cloudflare/StateStore/State.ts`: preserve the old store while upgrading the worker through its existing state backend, using the narrowly scoped bootstrap transport described below.
- State-store adapters, mocks, and wrappers implementing StateService must gain the required method. Keep the contract required rather than silently emulating deletion with stage destruction and reconstruction.

The ordinary HTTP adapter memoizes a successful capability handshake per service instance before listing/reading/mutating state. Required capabilities include output-only enumeration, so sync cannot begin with incomplete listings. An older generic server produces a typed StateStoreError naming the unsupported contract before any mutation. Generic syncState never deploys a remote store.

Managed Cloudflare currently upgrades its worker with that same old HTTP store as the deployment state backend. A mandatory handshake would otherwise block the upgrade itself. Add a private makeLegacyBootstrapStateStore adapter used only by Cloudflare/StateStore/State.ts when upgrading a positively identified v7 worker to v8. It uses the old raw endpoints, cannot be selected through the public factory, and fails explicitly on the new deleteOutput operation. It is never supplied to user stacks or syncState. The upgrade reads and writes the existing store rather than destroying or recreating it. After successful deployment and capability readback, construct the normal checked adapter. If the upgrade or handshake fails, report failure and retain the prior state. Remove this adapter with the old raw endpoint after the stated migration window.

Compatibility sequence:

1. Add the new endpoints and complete listing behavior to servers. Keep the old raw GET output endpoint's response shape unchanged. Stored resource/output values remain in their existing format.
2. Update built-in HTTP clients to the new presence endpoint and capability check. Update custom StateService adapters in the same release to implement deleteOutput. The generic wire contract advances from 5 to 6, while the current managed Cloudflare deployment revision advances independently from 7 to 8. Never compare the two counters as if they had the same meaning.
3. Upgrade generic servers before their clients. Existing generic clients keep using the raw endpoint during the compatibility window. Managed Cloudflare clients are different: older clients require an exact deployment-version match and can redeploy an older worker. Before the first shared-worker v8 upgrade, update every managed-store operator and CI runner to the compatible client and stop older bootstrap processes. Use the private legacy bootstrap adapter for the one-time v7-to-v8 upgrade. Do not claim mixed managed-client versions are safe. A rolling mixed-version deployment instead requires a separate anti-downgrade compatibility release first.
4. Deprecate the old raw GET endpoint immediately. Remove it and makeLegacyBootstrapStateStore in the next major state-protocol release after supported clients have migrated and the removal is announced. No permanent legacy output path is intended.
5. Rollback retains the additive endpoints until all new clients have rolled back. No stored-data rewrite or destructive state migration is needed.

Validation must cover the public sync utility and each built-in adapter contract: source outputs copied, destination outputs overwritten, stale output removed when source is absent, output-only source stage discovered, destination-only stage fully deleted, excluded stacks untouched, and idempotent output deletion with surviving resources. Include null and all scalar falsy values, readonly collections, and encoded Date/Redacted values. Verify source decode/read failure before that stage mutates. Snapshot source output before writing destination records.

Exercise old generic client/new server compatibility, new client/old server rejection before mutation, capability mismatch, and new client/new server null versus absence roundtrips with a real local HTTP server. Run a real local upgrade fixture with a v7 server and existing state, including an injected failed upgrade, to show bootstrap can proceed without losing that state and switches to the checked adapter afterward. Test the older-managed-client downgrade hazard and enforce the rollout prerequisite; preserving the old raw endpoint alone does not prevent it. Do not claim that a release updates existing servers atomically. Source and destination must be quiescent or externally coordinated during synchronization. If a later output write fails, prior resource writes may have occurred and the error must remain visible. Empty directory/container identity is not portable across backends. The guarantee is equality of resource and output records.

The output change follows the selected-stack fix during implementation. The plan PRs themselves are independent documentation changes against the same review base.
