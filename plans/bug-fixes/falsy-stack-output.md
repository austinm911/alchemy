# Falsy scalar stack outputs

Apply skips output only when `plan.output == null`, retaining the existing null/undefined absence policy. Values `0`, `false`, and `""` are persisted just like truthy outputs. Selected-resource applies and destroy cleanup keep their existing behavior.

## Verification

17 stack-output tests passed, including the public Stack factory through planning and application for false, zero, empty string, truthy controls, and object outputs, both fresh and replacing existing state. Astra accepted the implementation without blocking findings.

The standard pnpm entrypoint was blocked by its configured release-age policy. Tests used the existing runner with a temporary synchronous-import preload for a local test-collection issue. No tracked runner or package-manager policy changed.
