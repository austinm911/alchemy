import { adopt, OwnedBySomeoneElse } from "@/AdoptPolicy.ts";
import type { ScopedPlanStatusSession } from "@/Cli/Cli.ts";
import * as Docker from "@/Docker";
import * as Provider from "@/Provider";
import { inMemoryState } from "@/State";
import * as Test from "@/Test/Alchemy";
import { describe, expect } from "alchemy-test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { isDockerReady } from "./Runtime.ts";

const { test } = Test.make({
  providers: Docker.providers(),
  state: inMemoryState(),
});

const stubSession = {
  note: () => Effect.void,
} as unknown as ScopedPlanStatusSession;

/**
 * The engine passes no props for `Docker.Volume("id")` and no prior props on a
 * first create, while `Provider` declares both as present. The cast reproduces
 * what the engine actually hands the provider.
 */
const absent = undefined as unknown as Docker.VolumeProps;

/**
 * An unguarded property read on absent state raises a `TypeError` out of the
 * provider, which surfaces as a defect rather than a typed Docker failure.
 * Asserting on defects keeps the check meaningful without a daemon, where the
 * same call fails with a `PlatformError` instead.
 */
const defects = (exit: Exit.Exit<unknown, unknown>): Array<unknown> =>
  Exit.isSuccess(exit)
    ? []
    : exit.cause.reasons
        .filter(Cause.isDieReason)
        .map((reason) => reason.defect);

test.provider("read tolerates a volume with no prior props", () =>
  Effect.gen(function* () {
    const volumeProvider = yield* Provider.findProvider(Docker.Volume);
    const exit = yield* Effect.exit(
      volumeProvider.read!({
        id: "data",
        fqn: "data",
        instanceId: "instance",
        olds: absent,
        output: undefined,
      }),
    );
    expect(defects(exit)).toEqual([]);
  }),
);

test.provider("diff tolerates a volume with no prior props", () =>
  Effect.gen(function* () {
    const volumeProvider = yield* Provider.findProvider(Docker.Volume);
    const exit = yield* Effect.exit(
      volumeProvider.diff!({
        id: "data",
        fqn: "data",
        instanceId: "instance",
        olds: absent,
        news: {},
        oldBindings: [],
        newBindings: [],
        output: {
          id: "data",
          name: "data",
          driver: "local",
          driverOpts: {},
          labels: {},
          mountpoint: undefined,
          createdAt: 0,
        },
      }),
    );
    expect(defects(exit)).toEqual([]);
  }),
);

test.provider("reconcile tolerates a volume declared with no props", () =>
  Effect.gen(function* () {
    const docker = yield* Docker.Docker;
    const volumeProvider = yield* Provider.findProvider(Docker.Volume);
    const exit = yield* Effect.exit(
      volumeProvider.reconcile({
        id: "data",
        fqn: "data",
        instanceId: "no-props",
        news: absent,
        olds: undefined,
        output: undefined,
        session: stubSession,
        bindings: [],
      }),
    );
    if (Exit.isSuccess(exit)) {
      yield* docker.volume.remove(exit.value.name).pipe(Effect.ignore);
    }
    expect(defects(exit)).toEqual([]);
  }),
);

test.provider("diff replaces a volume when labels change", () =>
  Effect.gen(function* () {
    const volumeProvider = yield* Provider.findProvider(Docker.Volume);
    const volumeDiff = yield* volumeProvider.diff!({
      id: "data",
      fqn: "data",
      instanceId: "instance",
      olds: { name: "data", labels: { usage: "old" } },
      news: { name: "data", labels: { usage: "new" } },
      oldBindings: [],
      newBindings: [],
      output: {
        id: "data",
        name: "data",
        driver: "local",
        driverOpts: {},
        labels: { usage: "old" },
        mountpoint: undefined,
        createdAt: 0,
      },
    });
    expect(volumeDiff).toEqual({ action: "replace", deleteFirst: true });
  }),
);

test.provider("diff replaces a volume when its Docker context changes", () =>
  Effect.gen(function* () {
    const volumeProvider = yield* Provider.findProvider(Docker.Volume);
    const volumeDiff = yield* volumeProvider.diff!({
      id: "data",
      fqn: "data",
      instanceId: "instance",
      olds: {
        name: "data",
        context: "default",
      },
      news: {
        name: "data",
        context: "remote-build",
      },
      oldBindings: [],
      newBindings: [],
      output: {
        id: "data",
        name: "data",
        driver: "local",
        driverOpts: {},
        labels: {},
        mountpoint: undefined,
        createdAt: 0,
      },
    });
    expect(volumeDiff).toEqual({ action: "replace", deleteFirst: true });
  }),
);

describe("Docker.Volume", { concurrent: false }, () => {
  test.provider.skipIf(!isDockerReady)(
    "creates a volume with labels",
    (stack) =>
      Effect.gen(function* () {
        const docker = yield* Docker.Docker;
        const volumeName = "alchemy-test-volume-create";
        yield* Effect.addFinalizer(() =>
          docker.volume.remove(volumeName).pipe(Effect.ignore),
        );
        const volume = yield* stack.deploy(
          Docker.Volume("created-volume", {
            name: volumeName,
            labels: { "com.alchemy.test": "true" },
          }),
        );
        expect(volume.name).toBe(volumeName);
        expect(volume.id).toBe(volumeName);
        expect(volume.driver).toBe("local");
        expect(volume.labels["com.alchemy.test"]).toBe("true");
        expect(volume.mountpoint?.length).toBeGreaterThan(0);
      }),
  );

  test.provider.skipIf(!isDockerReady)(
    "creates a volume declared without props",
    (stack) =>
      Effect.gen(function* () {
        const docker = yield* Docker.Docker;
        // `examples/docker-postgres` declares its volume this way.
        const volume = yield* stack.deploy(Docker.Volume("no-props-volume"));
        yield* Effect.addFinalizer(() =>
          docker.volume.remove(volume.name).pipe(Effect.ignore),
        );
        expect(volume.name.length).toBeGreaterThan(0);
        expect(volume.driver).toBe("local");
        expect(volume.mountpoint?.length).toBeGreaterThan(0);
      }),
  );

  test.provider.skipIf(!isDockerReady)(
    "adopts an existing Docker volume",
    (stack) =>
      Effect.gen(function* () {
        const docker = yield* Docker.Docker;
        const volumeName = "alchemy-test-volume-adopt-existing";
        yield* Effect.addFinalizer(() =>
          docker.volume.remove(volumeName).pipe(Effect.ignore),
        );
        yield* docker.volume
          .remove(volumeName)
          .pipe(
            Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
          );
        yield* docker.volume.create({ name: volumeName });

        const error = yield* stack
          .deploy(Docker.Volume("existing-volume", { name: volumeName }))
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(OwnedBySomeoneElse);
        const volume = yield* stack.deploy(
          Docker.Volume("existing-volume", { name: volumeName }).pipe(
            adopt(true),
          ),
        );
        expect(volume.name).toBe(volumeName);
        expect(volume.id).toBe(volumeName);
        expect(volume.driver).toBe("local");
      }),
  );

  test.provider.skipIf(!isDockerReady)(
    "replaces a volume when its labels change",
    (stack) =>
      Effect.gen(function* () {
        const docker = yield* Docker.Docker;
        const volumeName = "alchemy-test-volume-replace";
        yield* docker.volume
          .remove(volumeName)
          .pipe(
            Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
          );
        const first = yield* stack.deploy(
          Docker.Volume("replaceable-volume", {
            labels: { generation: "1" },
          }),
        );
        const second = yield* stack.deploy(
          Docker.Volume("replaceable-volume", {
            labels: { generation: "2" },
          }),
        );
        expect(second.id).not.toBe(first.id);
        expect(second.labels.generation).toBe("2");
      }),
  );
});
