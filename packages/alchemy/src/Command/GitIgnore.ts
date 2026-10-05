import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import ignore from "ignore";
import picomatch from "picomatch";

/** List memo inputs with each .gitignore scoped to the directory that owns it. */
export const gitIgnoreFiles = Effect.fn("Command.gitIgnoreFiles")(function* (options: {
  cwd: string;
  include: string[];
  excludeDirectory?: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const rules = new Map<string, ReturnType<typeof ignore>>();
  const files = new Set<string>();
  const positive: string[] = [];
  const negative: string[] = [];
  for (const pattern of options.include) {
    if (!pattern) continue;
    if (pattern.startsWith("!") && !pattern.startsWith("!(")) {
      if (!pattern.startsWith("!!") || pattern.startsWith("!!(")) negative.push(pattern.slice(1));
    } else positive.push(pattern);
  }
  const normalize = (pattern: string) => path.normalize(pattern.replace(/\/$/, ""));
  const patterns = positive.map(normalize);
  const globOptions = { dot: true, posix: true };
  const matches = picomatch(patterns, globOptions);
  const excluded = picomatch(negative.map(normalize), globOptions);
  const portable = (value: string) => value.split(path.sep).join("/");
  const within = (directory: string, file: string) => {
    const relative = path.relative(directory, file);
    return (
      relative === "" ||
      (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
    );
  };
  const readRules = Effect.fn("Command.readIgnoreRules")(function* (directory: string) {
    const cached = rules.get(directory);
    if (cached) return cached;
    const content = yield* fs.readFileString(path.join(directory, ".gitignore")).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(""),
      ),
    );
    const matcher = ignore({ ignorecase: false }).add(content);
    rules.set(directory, matcher);
    return matcher;
  });
  const isIgnored = (file: string, directory: boolean, scopes: string[]) => {
    let ignored = false;
    for (const scope of scopes) {
      if (!within(scope, file) || scope === file) continue;
      const result = rules
        .get(scope)
        ?.test(portable(path.relative(scope, file)) + (directory ? "/" : ""));
      if (result?.ignored || result?.unignored) ignored = result.ignored;
    }
    return ignored;
  };
  const pruned = (directory: string, scopes: string[]) =>
    path.basename(directory) === ".git" ||
    (options.excludeDirectory !== undefined && within(options.excludeDirectory, directory)) ||
    excluded(portable(path.relative(options.cwd, directory))) ||
    isIgnored(directory, true, scopes);

  const ancestors = Effect.fn("Command.ignoreAncestors")(function* (
    directory: string,
  ): Effect.fn.Return<string[], PlatformError> {
    const marker = yield* fs.stat(path.join(directory, ".git")).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(undefined),
      ),
    );
    const parent = path.dirname(directory);
    if (marker !== undefined || parent === directory) return [directory];
    return [...(yield* ancestors(parent)), directory];
  });
  const walk = Effect.fn("Command.walkMemoInputs")(function* (
    directory: string,
    scopes: string[],
    active: ReadonlySet<string>,
  ): Effect.fn.Return<void, PlatformError> {
    if (pruned(directory, scopes)) return;
    const real = yield* fs.realPath(directory);
    if (active.has(real)) return;
    const branch = new Set([...active, real]);
    yield* readRules(directory);
    const nestedScopes = [...scopes, directory];
    for (const name of yield* fs.readDirectory(directory)) {
      const file = path.join(directory, name);
      const info = yield* fs.stat(file).pipe(
        Effect.catchIf(
          (error) => error.reason._tag === "NotFound",
          () => Effect.succeed(undefined),
        ),
      );
      if (info?.type === "Directory") {
        yield* walk(file, nestedScopes, branch);
      } else if (info?.type === "File") {
        const key = portable(path.relative(options.cwd, file));
        if (matches(key) && !excluded(key) && !isIgnored(file, false, nestedScopes)) files.add(key);
      }
    }
  });
  const roots = new Set(
    patterns.map((pattern) => {
      const scan = picomatch.scan(pattern);
      const base = scan.base.replace(/\\(?=[()[\]{}!*+?@|])/g, "");
      return path.resolve(options.cwd, scan.isGlob ? base : path.dirname(base));
    }),
  );
  for (const root of roots) {
    const info = yield* fs.stat(root).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(undefined),
      ),
    );
    if (info?.type !== "Directory") continue;
    const chain = yield* ancestors(root);
    const scopes: string[] = [];
    let blocked = false;
    for (const directory of chain.slice(0, -1)) {
      if (pruned(directory, scopes)) {
        blocked = true;
        break;
      }
      yield* readRules(directory);
      scopes.push(directory);
    }
    if (!blocked) yield* walk(root, scopes, new Set());
  }
  return [...files].sort();
});
