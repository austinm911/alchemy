# Falsy scalar stack outputs

Apply skips output only when `plan.output == null`, retaining the existing null/undefined absence policy. Values `0`, `false`, and `""` are persisted just like truthy outputs. Selected-resource applies and destroy cleanup keep their existing behavior.

## Verification

17 stack-output tests passed, including the public Stack factory through planning and application for false, zero, empty string, truthy controls, and object outputs, both fresh and replacing existing state. Astra accepted the implementation without blocking findings.

The standard pnpm entrypoint was blocked by its configured release-age policy. Tests used the existing runner with a temporary synchronous-import preload for a local test-collection issue. No tracked runner or package-manager policy changed.

## 2026-10-09 refresh

Merged current upstream main at 5ea356dcc25fab11bf3178e4ff1531a62708b51a. The original defect remains in upstream. 22 focused stack-output and selection-barrier tests passed. Tests used the documented local runner preload. Provider qualification remains unchanged.
