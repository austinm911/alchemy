import * as Effect from "effect/Effect";
import { StateStoreError, type StateService } from "./State.ts";

/**
 * Synchronize all state (every stack/stage/resource) from `source` into
 * `destination` so that `destination` becomes a mirror of `source`.
 *
 * For each `{ stack, stage, fqn }` present in `source`, the resource is
 * written into `destination`, overwriting any existing entry under the same
 * key. Any keys present in `destination` but absent from `source` are
 * deleted, ensuring the two stores end up structurally identical.
 *
 * Stacks are walked sequentially; stages within a stack and resources
 * within a stage are processed concurrently for throughput.
 */
export const syncState = Effect.fn("State.syncState")(function* (
  source: StateService,
  destination: StateService,
  options?: {
    /** Restrict all mutations to these stacks. An empty selection does nothing. */
    stacks?: string[];
    /**
     * Maximum number of resources to copy in parallel within a single stage.
     * @default "unbounded".
     */
    concurrency?: number | "unbounded";
  },
) {
  if (options?.stacks?.length === 0) return;

  const concurrency = options?.concurrency ?? "unbounded";
  const [sourceStacks, destStacks] = yield* Effect.all([
    source.listStacks(),
    destination.listStacks(),
  ]);
  const sourceStackSet = new Set(sourceStacks);
  const selectedStacks = [...new Set(options?.stacks ?? union(sourceStacks, destStacks))];

  yield* Effect.forEach(
    selectedStacks,
    Effect.fn("State.syncStack")(function* (stack) {
      if (!sourceStackSet.has(stack)) {
        if (destStacks.includes(stack)) yield* destination.deleteStack({ stack });
        return;
      }
      const [sourceStages, destStages] = yield* Effect.all([
        source.listStages(stack),
        destination.listStages(stack),
      ]);
      const stages = union(sourceStages, destStages);

      yield* Effect.forEach(
        stages,
        Effect.fn("State.syncStage")(function* (stage) {
          if (!sourceStages.includes(stage)) {
            yield* destination.deleteStack({ stack, stage });
            return;
          }
          const sourceFqns = yield* source.list({ stack, stage });
          const destFqns = yield* destination.list({ stack, stage });

          const sourceSet = new Set(sourceFqns);
          const toDelete = destFqns.filter((fqn) => !sourceSet.has(fqn));

          const snapshot = yield* Effect.all({
            output: source.getOutput({ stack, stage }),
            resources: Effect.forEach(
              sourceFqns,
              Effect.fn("State.snapshotResource")(function* (fqn) {
                const value = yield* source.get({ stack, stage, fqn }).pipe(
                  Effect.filterOrFail(
                    (value) => value !== undefined,
                    () =>
                      new StateStoreError({
                        message:
                          "A source resource disappeared during state synchronization. Coordinate writers before retrying.",
                      }),
                  ),
                );
                return { fqn, value };
              }),
              { concurrency },
            ),
          });
          yield* Effect.all(
            [
              Effect.forEach(
                snapshot.resources,
                ({ fqn, value }) => destination.set({ stack, stage, fqn, value }),
                { concurrency },
              ),
              Effect.forEach(toDelete, (fqn) => destination.delete({ stack, stage, fqn }), {
                concurrency,
              }),
            ],
            { concurrency: "unbounded" },
          );
          if (snapshot.output === undefined) {
            yield* destination.deleteOutput({ stack, stage });
          } else {
            yield* destination.setOutput({ stack, stage, value: snapshot.output });
          }
        }),
        { concurrency: "unbounded" },
      );
    }),
  );
});

const union = <T>(left: Iterable<T>, right: Iterable<T>) => [...new Set([...left, ...right])];
