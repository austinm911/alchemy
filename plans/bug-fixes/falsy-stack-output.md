# docs(plan): preserve falsy scalar stack outputs

This draft proposes preserving stack outputs of `0`, `false`, and `""` during a full apply. The current truthiness guard returns `undefined` and leaves the previous stored value. [Source](https://github.com/austinm911/alchemy/blob/6c7e69114c0bd9cea2de2eb04b004631b041bb08/packages/alchemy/src/Apply.ts#L276)

Astra confirmed the P2 defect through the public `Stack(...)` factory followed by `Plan.make` and `apply`. Truthy controls persist correctly. Each falsy scalar leaves a prior `"previous"` value unchanged.

### Proposed change

Keep the filtered-plan behavior and existing null/undefined absence policy. Replace only the truthiness check, then use the existing evaluation and persistence path.

```diff
- if (plan.selectedFqns !== undefined || !plan.output) {
+ if (plan.selectedFqns !== undefined || plan.output == null) {
    return undefined;
  }
```

```text
full apply with output 0, false, or "":
    resolved = evaluate(plan.output, resolvedResourceOutputs)
    state.setOutput({ stack, stage, value: resolved })
    return resolved
```

Preserve generic output types, including readonly collections. This fix does not redefine undefined-output redeploys, add null cross-stack support, or change destroy cleanup.

## Implementation scope and validation

Own `packages/alchemy/src/Apply.ts` and the existing stack-output section of `packages/alchemy/test/apply.test.ts`. No state-store API or schema migration is needed.

Use the public Stack factory rather than a hand-constructed plan object in the regression cases. Cover a fresh deployment and a truthy-to-falsy redeployment for 0, false, and the empty string. Assert both the apply return value and persisted state. Keep truthy scalar and object controls. Add a readonly object/array type-use case in the established type-test location only if the implementation changes the signature, which this proposal does not require.

Retain tests proving filtered applies leave stack outputs untouched and full destroy removes them. Retain current null/undefined behavior. Output.stackRef currently treats null as absence independently, so an Apply-only patch cannot promise null cross-stack support.

Run the focused stack-output tests through alchemy-test and the real Stack-factory source reproduction. The review reproduced the current failure locally, not a fixed implementation. Source changes and passing regression results remain the next implementation step.
