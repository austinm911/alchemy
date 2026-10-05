import * as BunServices from "@effect/platform-bun/BunServices";
import { describe, expect, it } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/process/ChildProcess";
import { glob } from "tinyglobby";
import { gitIgnoreFiles } from "@/Command/GitIgnore.ts";
import { hashDirectory } from "@/Command/Memo.ts";
const fixture = Effect.fn("MemoTest.fixture")(function* (
  files: Record<string, string>,
  git = true,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped();
  if (git) expect(yield* (yield* ChildProcess.make("git", ["init", "-q", root])).exitCode).toBe(0);
  for (const [name, value] of Object.entries(files)) {
    yield* fs.makeDirectory(path.dirname(path.join(root, name)), { recursive: true });
    yield* fs.writeFileString(path.join(root, name), value);
  }
  return { fs, path, root };
});
const cases = [
  {
    name: "root anchored rules",
    rules: "/src/\n",
    nested: "",
    cwd: "packages/app",
    files: ["src/a.txt", "packages/app/src/b.txt"],
    expected: ["src/b.txt"],
  },
  {
    name: "ancestor slash rules",
    rules: "packages/app/src/\n",
    nested: "",
    cwd: "packages/app",
    files: ["packages/app/src/b.txt", "packages/app/keep.txt"],
    expected: ["keep.txt"],
  },
  {
    name: "ordered negation",
    rules: "*.txt\n!keep.txt\n",
    nested: "",
    cwd: ".",
    files: ["drop.txt", "keep.txt"],
    expected: ["keep.txt"],
  },
  {
    name: "descendant ignores",
    rules: "",
    nested: "src/ignored/\n",
    cwd: ".",
    files: ["packages/app/src/ignored/a.txt", "packages/app/src/b.txt"],
    expected: ["packages/app/src/b.txt"],
  },
  {
    name: "descendant negation",
    rules: "*.txt\n",
    nested: "!keep.txt\n",
    cwd: ".",
    files: ["packages/app/drop.txt", "packages/app/keep.txt"],
    expected: ["packages/app/keep.txt"],
  },
  {
    name: "excluded parent stays excluded",
    rules: "packages/\n!packages/app/keep.txt\n",
    nested: "!keep.txt\n",
    cwd: "packages/app",
    files: ["packages/app/keep.txt"],
    expected: [],
  },
  {
    name: "case sensitive rules",
    rules: "UPPER.txt\n",
    nested: "",
    cwd: ".",
    files: ["upper.txt", "UPPER.txt"],
    expected: ["upper.txt"],
  },
];
describe("scoped memo ignores", { tags: ["unit", "local"] }, () => {
  for (const row of cases)
    it.effect(row.name, () =>
      Effect.gen(function* () {
        const { fs, path, root } = yield* fixture({
          ...Object.fromEntries(row.files.map((name) => [name, "one"])),
          ".gitignore": row.rules,
          "packages/app/.gitignore": row.nested,
        });
        const cwd = path.join(root, row.cwd);
        const actual = yield* gitIgnoreFiles({ cwd, include: ["**/*.txt"] });
        expect(actual).toEqual(row.expected);
        for (const name of row.files) {
          const process = yield* ChildProcess.make("git", [
            "-c",
            "core.ignorecase=false",
            "-C",
            root,
            "check-ignore",
            "--quiet",
            name,
          ]);
          const ignored = (yield* process.exitCode) === 0;
          const relative = path.relative(cwd, path.join(root, name));
          if (!relative.startsWith("..")) expect(actual.includes(relative)).toBe(!ignored);
        }
        const before = yield* hashDirectory({ cwd, memo: { include: ["**/*.txt"] } });
        for (const file of actual) yield* fs.writeFileString(path.join(cwd, file), "two");
        expect(before !== (yield* hashDirectory({ cwd, memo: { include: ["**/*.txt"] } }))).toBe(
          actual.length > 0,
        );
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
    );

  it.effect("outside cwd roots obey ancestor ignores", () =>
    Effect.gen(function* () {
      const { path, root } = yield* fixture({
        ".gitignore": "src/\n",
        "src/drop.txt": "x",
        "shared/keep.txt": "x",
        "packages/app/input.txt": "x",
      });
      expect(
        yield* gitIgnoreFiles({
          cwd: path.join(root, "packages/app"),
          include: ["../../src/**", "../../shared/**"],
        }),
      ).toEqual(["../../shared/keep.txt"]);
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );
  it.effect("archives and worktree marker files", () =>
    Effect.gen(function* () {
      const { fs, path, root } = yield* fixture(
        { ".gitignore": "/src/\n", "src/drop.txt": "x", "packages/app/src/keep.txt": "x" },
        false,
      );
      const options = { cwd: path.join(root, "packages/app"), include: ["**/*.txt"] };
      expect(yield* gitIgnoreFiles(options)).toEqual(["src/keep.txt"]);
      yield* fs.writeFileString(path.join(root, ".git"), "gitdir: /fixture\n");
      expect(yield* gitIgnoreFiles(options)).toEqual(["src/keep.txt"]);
      expect(yield* gitIgnoreFiles({ cwd: root, include: [".git"] })).toEqual([".git"]);
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );
  it.effect("include grammar, lexical symlink aliases, and cycles", () =>
    Effect.gen(function* () {
      const { fs, path, root } = yield* fixture({
        "src/a.txt": "a",
        "src/b.md": "b",
        "src/.dot.txt": "c",
        "src/[literal].txt": "d",
        "other/c.txt": "e",
      });
      for (const include of [
        ["{src,other}/**/*", "!**/*.md"],
        ["src/\\[literal\\].txt"],
        ["src/**", "src/**"],
        [`../${path.basename(root)}/src/**`],
        ["src/**", `!../${path.basename(root)}/src/a.txt`],
        ["src/*.txt"],
        ["{src,other}/*.txt"],
        ["src/@(a|b).*"],
        [path.join(root, "src/*.txt")],
      ]) {
        const normalized = include.map((p) => (path.isAbsolute(p) ? path.relative(root, p) : p));
        expect(yield* gitIgnoreFiles({ cwd: root, include: normalized })).toEqual(
          (yield* Effect.promise(() =>
            glob(normalized, { cwd: root, dot: true, expandDirectories: false }),
          )).sort(),
        );
      }
      yield* fs.symlink(path.join(root, "src"), path.join(root, "alias"));
      yield* fs.symlink(root, path.join(root, "src/cycle"));
      const files = yield* gitIgnoreFiles({ cwd: root, include: ["**/*.txt"] });
      expect(files).toContain("alias/a.txt");
      expect(files).toContain("src/a.txt");
      expect(files.some((file) => file.includes("cycle/"))).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );
  it.effect("prunes ignored dependency directories before enumeration", () =>
    Effect.gen(function* () {
      const { fs, root } = yield* fixture({
        ".gitignore": "node_modules/\n",
        "node_modules/huge/dependency.txt": "x",
        "src/input.txt": "x",
      });
      const visited: string[] = [];
      const boundedFs: FileSystem.FileSystem = {
        ...fs,
        readDirectory: (directory, options) => {
          visited.push(directory);
          if (directory.includes("node_modules")) return Effect.die("ignored directory enumerated");
          return fs.readDirectory(directory, options);
        },
      };
      expect(
        yield* gitIgnoreFiles({ cwd: root, include: ["**/*.txt"] }).pipe(
          Effect.provideService(FileSystem.FileSystem, boundedFs),
        ),
      ).toEqual(["src/input.txt"]);
      expect(visited).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );
  it.effect("narrow includes prune unrelated directories before reading their ignores", () =>
    Effect.gen(function* () {
      const { fs, path, root } = yield* fixture({
        "package.json": "{}",
        "unrelated/deep/input.txt": "x",
      });
      yield* fs.makeDirectory(path.join(root, "unrelated/.gitignore"));
      const visited: string[] = [];
      const boundedFs: FileSystem.FileSystem = {
        ...fs,
        readDirectory: (directory, options) => {
          visited.push(directory);
          return fs.readDirectory(directory, options);
        },
      };
      expect(
        yield* gitIgnoreFiles({ cwd: root, include: ["package.json"] }).pipe(
          Effect.provideService(FileSystem.FileSystem, boundedFs),
        ),
      ).toEqual(["package.json"]);
      expect(visited).toEqual([root]);
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );
  it.effect("explicit exclude [] bypasses gitignore", () =>
    Effect.gen(function* () {
      const { fs, path, root } = yield* fixture({ ".gitignore": "*.txt\n", "source.txt": "one" });
      const beforeDefault = yield* hashDirectory({ cwd: root });
      const beforeExplicit = yield* hashDirectory({
        cwd: root,
        memo: { include: ["*.txt"], exclude: [] },
      });
      yield* fs.writeFileString(path.join(root, "source.txt"), "two");
      expect(yield* hashDirectory({ cwd: root })).toBe(beforeDefault);
      expect(
        yield* hashDirectory({ cwd: root, memo: { include: ["*.txt"], exclude: [] } }),
      ).not.toBe(beforeExplicit);
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );
});
