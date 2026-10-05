# docs(plan): bound state sync mutations to selected stacks

This draft proposes making `syncState` mutate only selected stacks. Today, selecting `['app']` can erase another stack's destination state even when that stack also exists in the source. The copy loop uses all source stacks while deletion uses a filtered set. [Source](https://github.com/austinm911/alchemy/blob/6c7e69114c0bd9cea2de2eb04b004631b041bb08/packages/alchemy/src/State/Sync.ts#L33)

Astra confirmed the deletion using the real in-memory backend. This is a P1 state-loss defect in an exported utility. No first-party production caller was found, so this does not establish a CLI deployment failure.

### Proposed behavior

An omitted selection retains full-mirror behavior. A supplied selection defines the complete mutation boundary. An empty selection does nothing, and a selected stack absent from source is removed from destination.

```text
syncState(source, destination, options):
    if options.stacks is explicitly empty:
        return

    sourceNames, destinationNames = list both stores
    selectedNames = options.stacks is absent
        ? union(sourceNames, destinationNames)
        : unique(options.stacks)

    for name in selectedNames:
        if sourceNames does not contain name:
            if destinationNames contains name:
                destination.deleteStack(name)
        else:
            synchronizeThisStack(source, destination, name)
```

Remove the later unscoped destination-deletion pass. Excluded resource rows and outputs must remain untouched. The separate output-mirror proposal addresses completeness within each selected stack.

## Implementation scope and validation

Own `packages/alchemy/src/State/Sync.ts` and `packages/alchemy/test/State/Sync.test.ts`. Document `stacks` selection semantics on the existing option. Do not change providers, protocols, state encoding, or cloud resources in this fix.

Use the existing Effect concurrency setting inside selected stacks. Stack traversal remains sequential. Return for an empty selection before enumeration or capability/version probes. Deduplicate selected names without sorting away the caller's intended order. Read failures propagate and cannot be interpreted as an empty source.

Regression cases:

- Source and destination both contain selected A and excluded B. B's resources and output remain identical.
- Destination also contains excluded C absent from source. C remains identical.
- Source contains excluded B absent from destination. B is not copied.
- Selected A is absent from source but present in destination. Only A is deleted.
- Selection is empty. A state service whose every method fails is never touched.
- Selection contains duplicates or an unknown absent name. Results are idempotent.
- No selection. Existing full-mirror resource copy/deletion tests retain their behavior.

Run `timeout 180 pnpm test test/State/Sync.test.ts` after the implementation, plus the local source reproduction. These are proposed checks, not passing implementation results. The prior review's runner limitations are recorded in the review manifest.

This change intentionally corrects the undocumented filter behavior. Callers relying on deletion outside their selection must use an unfiltered full mirror. There is no stored-data migration and no restoration of state already lost before this change.
