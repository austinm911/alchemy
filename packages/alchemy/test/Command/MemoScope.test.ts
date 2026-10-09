import * as BunServices from "@effect/platform-bun/BunServices";
import { describe, expect, it } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { hashDirectory } from "@/Command/Memo.ts";

describe("memo ancestor rule precedence", { tags: ["unit", "local"] }, () => {
  it.effect("nearer negation hashes the re-included file while ignored edits stay noop", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped();
      const cwd = path.join(root, "app");
      yield* fs.makeDirectory(path.join(root, ".git"));
      yield* fs.makeDirectory(cwd);
      yield* fs.writeFileString(path.join(root, ".gitignore"), "*.txt\n");
      yield* fs.writeFileString(path.join(cwd, ".gitignore"), "!keep.txt\n");
      yield* fs.writeFileString(path.join(cwd, "keep.txt"), "one");
      yield* fs.writeFileString(path.join(cwd, "drop.txt"), "one");
      const props = { cwd, memo: { include: ["*.txt"] } };
      const before = yield* hashDirectory(props);
      yield* fs.writeFileString(path.join(cwd, "keep.txt"), "two");
      const after = yield* hashDirectory(props);
      expect(after).not.toBe(before);
      yield* fs.writeFileString(path.join(cwd, "drop.txt"), "two");
      expect(yield* hashDirectory(props)).toBe(after);
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );
});
