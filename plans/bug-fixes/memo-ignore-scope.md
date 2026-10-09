# Nearer gitignore negation

Upstream PR #2066 fixed the original ancestor anchoring defect and introduced the shared Util/Ignore.ts implementation. This PR now addresses only ordered negation across those ancestor scopes. It removes the old PR's separate Command/GitIgnore.ts evaluator, parser dependency, and broad grammar/traversal changes.

For a root `*.txt` rule and an app-local `!keep.txt`, edits to keep.txt must change the memo hash. An unmatched nearer scope retains the inherited decision. An excluded parent directory cannot be reopened by a child-file negation. Directory negation at the directory itself is supported. Docker rule composition keeps its existing semantics.

parseIgnoreRules exposes explicit matching/negation decisions through the existing IgnoreRules abstraction. combineIgnoreRules checks ancestor directories before each file and combines scopes from outermost to nearest. Memo continues to use the upstream parser and walker.

## Current verification

The original failing root /src/ fixture now passes on upstream. The narrower negation reproduction fails on upstream and passes with this change. 59 focused checks passed across shared ignore rules, Git oracle cases, the real Memo hash consumer, and existing Build lifecycle tests. Docker-backed oracle cases were excluded, while in-memory Docker semantics were exercised. Focused typecheck is clean.

Tests used the existing alchemy-test runner with the documented temporary synchronous-import preload. No tracked runner or package-manager policy changed. No cloud resources were written.
