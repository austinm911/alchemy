# Selected-stack state synchronization

`syncState` treats the supplied stack selection as the complete mutation boundary. Omitting it selects the union of source and destination names. Supplying `[]` returns before any state operation. Names are deduplicated. A selected destination-only stack is removed. Excluded stacks and their outputs are untouched.

The exported utility has no first-party production caller in the reviewed tree. Its behavior is exercised directly against the real in-memory state service.

## Verification

Four sync tests passed, covering complete copy, overwrite/deletion, selected-stack boundaries, and an empty selection with state methods that fail if called. The subsequent output-sync PR repeats these checks alongside output cases. Astra accepted this implementation without blocking findings.

The standard pnpm entrypoint was blocked by its configured release-age policy. Tests used the existing runner with a temporary synchronous-import preload for a local test-collection issue. No tracked runner or package-manager policy changed.

## 2026-10-09 refresh

Merged current upstream main at 5ea356dcc25fab11bf3178e4ff1531a62708b51a. The original defect remains in upstream. 4 selected-stack tests passed. Tests used the documented local runner preload. Provider qualification remains unchanged.
