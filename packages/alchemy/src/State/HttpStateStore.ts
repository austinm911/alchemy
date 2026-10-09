import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { STATE_STORE_CAPABILITIES } from "./HttpStateApi.ts";
import {
  makeHttpStateTransport,
  mapStateStoreError,
  type HttpStateStoreProps,
} from "./HttpStateTransport.ts";
import { StateStoreError, type StateService } from "./State.ts";

export { checkHttpStateStoreAuth, describeStateStoreFailure } from "./HttpStateTransport.ts";
export type { HttpStateStoreCredentials, HttpStateStoreProps } from "./HttpStateTransport.ts";

/** Construct a state client that checks its server contract before accessing state. */
export const makeHttpStateStore = Effect.fn("State.makeHttpStateStore")(function* (
  props: HttpStateStoreProps,
) {
  const { service, apiClient } = yield* makeHttpStateTransport(props);
  const [handshake, invalidate] = yield* Effect.cachedInvalidateWithTTL(
    apiClient.state.getCapabilities().pipe(
      mapStateStoreError,
      Effect.mapError(
        (error) =>
          new StateStoreError({
            message:
              "State store does not provide the required protocol 6 output contract. Upgrade the server before using this client.",
            http: error.http,
          }),
      ),
      Effect.filterOrFail(
        (actual) =>
          actual.protocolVersion === STATE_STORE_CAPABILITIES.protocolVersion &&
          STATE_STORE_CAPABILITIES.capabilities.every((capability) =>
            actual.capabilities.includes(capability),
          ),
        () =>
          new StateStoreError({
            message:
              "State store requires protocol 6 with output presence, output deletion, and output-stage enumeration. Upgrade the server first.",
          }),
      ),
      Effect.asVoid,
    ),
    Duration.infinity,
  );
  const ready = handshake.pipe(Effect.tapError(() => invalidate));
  const checked = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
    ready.pipe(Effect.andThen(operation));
  const state: StateService = {
    id: service.id,
    getVersion: service.getVersion,
    listStacks: () => checked(service.listStacks()),
    listStages: (stack) => checked(service.listStages(stack)),
    list: (request) => checked(service.list(request)),
    get: (request) => checked(service.get(request)),
    getReplacedResources: (request) => checked(service.getReplacedResources(request)),
    set: (request) => checked(service.set(request)),
    delete: (request) => checked(service.delete(request)),
    deleteStack: (request) => checked(service.deleteStack(request)),
    getOutput: (request) => checked(service.getOutput(request)),
    setOutput: (request) => checked(service.setOutput(request)),
    deleteOutput: (request) => checked(service.deleteOutput(request)),
  };
  return state;
});
