# Scoped ignores in build memoization

Memo uses one internal GitIgnore evaluator when excludes are omitted. Each ignore parser belongs to its file's directory. Ancestor rules load before an include root, including roots outside cwd. Descendant rules preserve order and negation. Pruned parent directories cannot be reopened by a child rule. A .git file or directory marks the ancestor boundary. Archives fall back to the filesystem root without running Git.

The pinned `ignore` parser is case-sensitive. Per-hash caches prevent stale rule reads. Lexical paths remain hash keys. Real directory identities are tracked only along the active traversal branch, preserving symlink aliases while stopping cycles. Positive include prefixes and ignore rules both prune traversal. Includes retain picomatch syntax and normalize parent-relative paths against cwd.

Explicit excludes, including `[]`, bypass GitIgnore and use the original tinyglobby implementation. Lockfile defaults and runtime-directory artifact exceptions remain. The obsolete gitignore-to-glob converter is removed. Corrected nested and negated semantics can cause one corrective rebuild.

## Verification

18 Memo/Build tests passed. They compare ignore decisions with Git, compare include grammar with tinyglobby, prove ignored and unrelated directory pruning, and cover symlinks, archives, worktree markers, outside-cwd includes, and explicit overrides. Actual BuildProvider application changes the built artifact from version one to version two after a nested package source edit, while unchanged and ignored inputs stay noop.

Astra identified parent-relative normalization and positive-include pruning regressions in the first implementation. Both have regression coverage and are corrected. Targeted Memo typechecking is clean. Git is used only by test fixtures.

The standard pnpm entrypoint was blocked by its configured release-age policy. Tests used the existing runner with a temporary synchronous-import preload for a local test-collection issue. No tracked runner or package-manager policy changed.

Astra accepted the corrected implementation with no remaining blocking findings.
