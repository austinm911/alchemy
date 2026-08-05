import { Docker, dockerHealthCmd, DockerLive } from "@/Docker";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, layer, test } from "alchemy-test";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { fileURLToPath } from "node:url";

// `DOCKER_BIN` is the documented binary override. A stub that prints its own
// argv makes the command builders assertable without a Docker daemon. The
// override stays on this layer so the rest of the single-process run keeps the
// real binary.
const stubBin = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: {
      DOCKER_BIN: fileURLToPath(new URL("./fixtures/argv.sh", import.meta.url)),
    },
  }),
);

const withDocker = layer(
  Layer.provideMerge(
    Layer.provide(DockerLive, stubBin),
    Layer.merge(NodeServices.layer, stubBin),
  ),
);

const baseOptions = {
  volume: undefined,
  restart: "no" as const,
  rm: false,
  "health-cmd": undefined,
  "health-interval": undefined,
  "health-timeout": undefined,
  "health-retries": undefined,
  "health-start-period": undefined,
  "health-start-interval": undefined,
  "stop-timeout": undefined,
  p: undefined,
};

withDocker("Docker.container.create", (it) => {
  it.effect("serializes environment variables as KEY=value pairs", () =>
    Effect.gen(function* () {
      const docker = yield* Docker;
      const { stdout } = yield* docker.container.create({
        ...baseOptions,
        name: "env-args",
        image: "postgres:18-alpine",
        env: {
          POSTGRES_DB: "app",
          POSTGRES_USER: "alchemy",
          POSTGRES_PASSWORD: "s3cret",
        },
        command: undefined,
      });
      const args = stdout.split("\n");
      expect(args).toContain("POSTGRES_DB=app");
      expect(args).toContain("POSTGRES_USER=alchemy");
      expect(args).toContain("POSTGRES_PASSWORD=s3cret");
      // A bare `--env NAME` tells Docker to inherit `NAME` from the host
      // environment, which drops the configured value.
      expect(args).not.toContain("POSTGRES_DB");
      expect(args).not.toContain("POSTGRES_USER");
      expect(args).not.toContain("POSTGRES_PASSWORD");
    }),
  );

  it.effect("passes the command after the image reference", () =>
    Effect.gen(function* () {
      const docker = yield* Docker;
      const { stdout } = yield* docker.container.create({
        ...baseOptions,
        name: "command-args",
        image: "alpine:3.19",
        env: undefined,
        command: ["echo", "hello"],
      });
      const args = stdout.split("\n");
      expect(args.slice(-3)).toEqual(["alpine:3.19", "echo", "hello"]);
      expect(args).not.toContain("--env");
    }),
  );
});

describe("dockerHealthCmd", () => {
  // Docker re-wraps a `--health-cmd` value in CMD-SHELL, so keeping a
  // caller-supplied directive builds `["CMD-SHELL", "CMD-SHELL <cmd>"]` and
  // every probe exits 127 with `CMD-SHELL: not found`.
  test("drops a leading CMD-SHELL directive", () => {
    expect(dockerHealthCmd(["CMD-SHELL", "pg_isready -U alchemy -d app"])).toBe(
      "pg_isready -U alchemy -d app",
    );
  });

  test("drops a leading CMD directive", () => {
    expect(dockerHealthCmd(["CMD", "pg_isready", "-U", "alchemy"])).toBe(
      "pg_isready -U alchemy",
    );
  });

  test("joins a bare argv array", () => {
    expect(dockerHealthCmd(["pg_isready", "-U", "alchemy"])).toBe(
      "pg_isready -U alchemy",
    );
  });

  test("passes a string through and keeps undefined absent", () => {
    expect(dockerHealthCmd("true")).toBe("true");
    expect(dockerHealthCmd(undefined)).toBeUndefined();
  });
});
