import { describe, expect, it } from "alchemy-test";
import * as Effect from "effect/Effect";
import { InMemoryService, syncState, type ResourceState, type StateService } from "@/State";

describe("syncState", { tags: ["unit", "local"] }, () => {
  it.effect("copies source resources and overwrites matching destination resources", () =>
    Effect.gen(function* () {
      const sourceA = resource("resource-a", { value: "source-a" });
      const sourceB = resource("resource-b", { value: "source-b" });
      const destinationA = resource("resource-a", { value: "destination-a" });

      const source = yield* InMemoryService({
        app: { dev: { "resource-a": sourceA, "resource-b": sourceB } },
      });
      const destination = yield* InMemoryService({ app: { dev: { "resource-a": destinationA } } });

      yield* syncState(source, destination);

      yield* expectStage(destination, "app", "dev", {
        "resource-a": sourceA,
        "resource-b": sourceB,
      });
    }),
  );

  it.effect("deletes resources from destination when they are absent from source", () =>
    Effect.gen(function* () {
      const source = yield* InMemoryService({
        app: { dev: { "resource-a": resource("resource-a", { value: "source-a" }) } },
      });
      const destination = yield* InMemoryService({
        app: {
          dev: {
            "resource-a": resource("resource-a", { value: "destination-a" }),
            "resource-b": resource("resource-b", { value: "destination-b" }),
          },
          prod: { "resource-c": resource("resource-c", { value: "destination-c" }) },
        },
        oldApp: { dev: { "resource-d": resource("resource-d", { value: "destination-d" }) } },
      });

      yield* syncState(source, destination);

      yield* expectStage(destination, "app", "dev", {
        "resource-a": resource("resource-a", { value: "source-a" }),
      });
      yield* expectStage(destination, "app", "prod", {});
      yield* expectStage(destination, "oldApp", "dev", {});
      expect(yield* destination.listStacks()).toEqual(["app"]);
    }),
  );
  it.effect("selection bounds copies and deletions and preserves excluded outputs", () =>
    Effect.gen(function* () {
      const row = resource("row", { value: "source" });
      const old = resource("row", { value: "destination" });
      const source = yield* InMemoryService({
        app: { dev: { row } },
        excluded: { dev: { row } },
        newExcluded: { dev: { row } },
      });
      const destination = yield* InMemoryService(
        {
          app: { dev: { row: old } },
          excluded: { dev: { row: old } },
          destinationOnly: { dev: { row: old } },
          selectedMissing: { dev: { row: old } },
        },
        { excluded: { dev: "keep" }, destinationOnly: { dev: false } },
      );
      yield* syncState(source, destination, {
        stacks: ["app", "app", "selectedMissing", "unknown"],
      });
      yield* expectStage(destination, "app", "dev", { row });
      yield* expectStage(destination, "excluded", "dev", { row: old });
      yield* expectStage(destination, "destinationOnly", "dev", { row: old });
      expect(yield* destination.listStacks()).toEqual(["app", "excluded", "destinationOnly"]);
      expect(yield* destination.getOutput({ stack: "excluded", stage: "dev" })).toBe("keep");
      expect(yield* destination.getOutput({ stack: "destinationOnly", stage: "dev" })).toBe(false);
    }),
  );

  it.effect("empty selection never touches either service", () =>
    Effect.gen(function* () {
      const unreachable = new Proxy(yield* InMemoryService(), {
        get() {
          throw new Error("state service touched");
        },
      });
      yield* syncState(unreachable, unreachable, { stacks: [] });
    }),
  );
});

const resource = (fqn: string, attr: Record<string, unknown>): ResourceState => ({
  resourceType: "test:resource",
  namespace: undefined,
  fqn,
  logicalId: fqn,
  instanceId: `instance-${fqn}`,
  providerVersion: 1,
  status: "created",
  downstream: [],
  bindings: [],
  props: {},
  attr,
});

const listStage = Effect.fn(function* (state: StateService, stack: string, stage: string) {
  const fqns = yield* state.list({ stack, stage });
  const entries = yield* Effect.forEach(
    fqns,
    Effect.fn(function* (fqn) {
      return [fqn, yield* state.get({ stack, stage, fqn })] as const;
    }),
  );
  return Object.fromEntries(entries);
});

const expectStage = Effect.fn(function* (
  state: StateService,
  stack: string,
  stage: string,
  expected: Record<string, ResourceState>,
) {
  expect(yield* listStage(state, stack, stage)).toEqual(expected);
});
