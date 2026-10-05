import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiError from "effect/http-api/HttpApiError";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import {
  BearerTokenValidator,
  StateApi,
  StateAuthLive,
  StackOutputPresence,
  STATE_STORE_CAPABILITIES,
} from "@/State/HttpStateApi.ts";
import type { StateService } from "@/State/State.ts";
import { encodeState } from "@/State/StateEncoding.ts";

/** Real HTTP routes and codec, with an in-process backend and a switchable deployed revision. */
export const httpStateServer = Effect.fn("StateTest.httpServer")(function* (
  state: StateService,
  revision = 8,
) {
  const control = {
    revision,
    protocolVersion: 6,
    capabilities: Array.from<string>(STATE_STORE_CAPABILITIES.capabilities),
  };
  const requests: Array<{ method: string; path: string }> = [];
  const routes = HttpApiBuilder.group(StateApi, "state", (handlers) =>
    handlers
      .handle("getCapabilities", () =>
        Effect.sync(() => ({
          protocolVersion: control.protocolVersion,
          capabilities: control.capabilities,
        })),
      )
      .handle("listStacks", () => state.listStacks().pipe(Effect.orDie))
      .handle("listStages", ({ params }) => state.listStages(params.stack).pipe(Effect.orDie))
      .handle("listResources", ({ params }) => state.list(params).pipe(Effect.orDie))
      .handle("getState", ({ params }) =>
        state
          .get({ ...params, fqn: decodeURIComponent(params.fqn) })
          .pipe(Effect.map(encodeState), Effect.orDie),
      )
      .handle("setState", () => Effect.die("Resource writes are outside this output fixture"))
      .handle("deleteState", ({ params }) =>
        state.delete({ ...params, fqn: decodeURIComponent(params.fqn) }).pipe(Effect.orDie),
      )
      .handle("deleteStack", ({ params, query }) =>
        state.deleteStack({ ...params, stage: query.stage }).pipe(Effect.orDie),
      )
      .handle("getReplacedResources", ({ params }) =>
        state.getReplacedResources(params).pipe(
          Effect.map((values) => values.map(encodeState)),
          Effect.orDie,
        ),
      )
      .handle("getStackOutput", ({ params }) =>
        state.getOutput(params).pipe(Effect.map(encodeState), Effect.orDie),
      )
      .handle("getStackOutputV2", ({ params }) =>
        state.getOutput(params).pipe(
          Effect.map((value) =>
            value === undefined
              ? StackOutputPresence.cases.Absent.make({})
              : StackOutputPresence.cases.Present.make({ value: encodeState(value) }),
          ),
          Effect.orDie,
        ),
      )
      .handle("setStackOutput", ({ params, payload }) =>
        state.setOutput({ ...params, value: payload }).pipe(Effect.orDie),
      )
      .handle("deleteStackOutput", ({ params }) => state.deleteOutput(params).pipe(Effect.orDie)),
  );
  const versions = HttpApiBuilder.group(StateApi, "version", (handlers) =>
    handlers.handle("getVersion", () => Effect.sync(() => ({ version: control.revision }))),
  );
  const validator = Layer.succeed(BearerTokenValidator, {
    validate: (token) =>
      token === "fixture-token" ? Effect.void : Effect.fail(new HttpApiError.Unauthorized()),
  });
  const auth = StateAuthLive.pipe(Layer.provide(validator));
  const web = yield* Effect.acquireRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        HttpApiBuilder.layer(StateApi).pipe(
          Layer.provide(routes),
          Layer.provide(versions),
          Layer.provide(auth),
          Layer.provide(validator),
          Layer.provide(BunHttpServer.layerHttpServices),
        ),
        { disableLogger: true },
      ),
    ),
    (web) => Effect.promise(web.dispose),
  );
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          const path = new URL(request.url).pathname;
          requests.push({ method: request.method, path });
          if (
            control.revision === 7 &&
            (path === "/state/capabilities" ||
              path.startsWith("/v2/") ||
              (request.method === "DELETE" && path.endsWith("/output")))
          )
            return new Response(null, { status: 404 });
          return web.handler(request);
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  );
  return { control, requests, credentials: { url: server.url.origin, authToken: "fixture-token" } };
});
