# docs(plan): preserve gitignore scope in build memoization

This draft proposes keeping each `.gitignore` rule relative to the directory that owns it. Today a root `/src/` rule is applied to a command's nested `cwd`, so a package's real source edits can reuse an old build. [Memo source](https://github.com/austinm911/alchemy/blob/6c7e69114c0bd9cea2de2eb04b004631b041bb08/packages/alchemy/src/Command/Memo.ts#L89), [Build consumer](https://github.com/austinm911/alchemy/blob/6c7e69114c0bd9cea2de2eb04b004631b041bb08/packages/alchemy/src/Command/Build.ts#L209)

Astra confirmed the P2 defect with a real Git repository, populated package files, `BuildProvider.reconcile`, and `CommandExecutorLive`. The first build copies `version one`; changing source to `version two` produces `noop` and leaves the old artifact. Changing `package.json` produces the expected `update` control.

### Proposed ownership

Replace Memo's flattened ignore-glob conversion with one internal scoped ignore evaluator. Use the `ignore` parser for ordered rule semantics, keep the rule directory with each matcher, and apply `.gitignore` rules without requiring Git to be installed. Remove the old converter once its only current consumer, Memo, is migrated.

```text
hashDirectory(options):
    if options.exclude is supplied, including []:
        files = existing explicit-glob include/exclude path
    else:
        includePlan = compile existing include glob semantics
        for each lexical include root:
            boundary = nearest ancestor .git directory or file
                       or filesystem root for source archives
            evaluate ancestor directories from boundary to include root
            walk only directories allowed by inherited rules:
                load this directory's .gitignore once
                evaluate candidates relative to each rule's directory
                preserve rule order and explicit negations
                never reinclude a child of an excluded directory
                retain files matching includePlan

    retain the existing runtime-directory exclusion and lockfile policy
    normalize to command-cwd-relative keys
    deduplicate, sort, and hash file contents
```

This deliberately includes nested `.gitignore` files and ordered negation, which the current implementation also mishandles. Explicit excludes retain their existing meaning. The contract covers `.gitignore` files, not tracked-file exceptions or global Git configuration. [Parser reference](https://github.com/kaelzhang/node-ignore)

## Implementation scope and validation

Own `packages/alchemy/src/Command/Memo.ts`, a new internal `Command/GitIgnore.ts`, package/catalog/lockfile entries for a pinned `ignore` dependency, and Command memoization regression tests. Remove `Util/gitignore-rules-to-globs.ts` when its now-single Memo import is removed. Do not export the new helper from the public Command barrel.

Keep typed filesystem errors at the Effect boundary. Missing .gitignore is normal; permission and I/O errors must remain errors. Public/non-trivial effectful helpers use Effect.fn. Each hash invocation owns its parser/file cache so later rule edits cannot be hidden by a process-global cache.

Matcher rules:

- Associate each parser instance with its ignore file's directory. Evaluate only paths inside that scope, with directory suffixes for directory candidates. Use parser case-sensitive mode to match the current case-sensitive glob behavior.
- An unmatched child matcher preserves the inherited decision. Only an explicit matching negation can reverse an inherited file exclusion, and a pruned parent directory cannot be reopened by an inaccessible child ignore file.
- Evaluate the ancestor chain before entering every explicit include root, including roots outside cwd. Includes do not override default ignore rules. A .git file is a repository boundary just like a .git directory.
- Use lexical paths for scope and hash keys. Follow symlinks as current tinyglobby does, but track real directory identities only along each active traversal branch to prevent cycles. Do not globally deduplicate distinct lexical aliases or rewrite hash keys with real paths. Broken symlinks retain the current glob behavior.
- Exclude .git directory internals. Preserve the existing treatment of a worktree's .git marker file in this change, rather than silently changing that separate behavior.
- Compile include patterns with the existing picomatch/glob options. Preserve braces, escaping, negated includes, relative/absolute patterns, outside-cwd patterns, dotfiles, duplicate elimination, and sorted portable keys. The new traversal can own pruning, but must not invent a different include grammar.
- Explicit `exclude`, including an empty array, bypasses GitIgnore rules completely. This is how Build hashes generated artifacts. Keep that path on the existing glob implementation.
- Preserve the nearest-lockfile default and opt-in behavior. Preserve the existing .alchemy exclusion, including its exception for explicitly hashing an artifact inside that directory.

Acceptance cases must include the actual build lifecycle and artifact contents, not only a hash helper. Exercise source-edit update, unchanged noop, ignored-file noop, package.json control update, root-anchored patterns, ancestor slash patterns, descendant rules, negation, excluded parent directories, outside-cwd includes, source archives, .git worktree files, symlink aliases/cycles, and explicit exclude overrides. Compare .gitignore decisions with Git in fixtures without introducing a Git runtime dependency.

Include an I/O-budget regression proving ignored dependency directories are pruned rather than fully enumerated and filtered afterward. Existing include/glob and runtime-directory tests must keep passing. Restoring nested/negated rules can change existing cache keys and cause one corrective rebuild. Document that behavior, but do not retain a parallel legacy evaluator or compatibility flag.
