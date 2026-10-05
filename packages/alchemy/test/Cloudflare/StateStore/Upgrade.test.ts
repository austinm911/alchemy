import { describe, expect, it } from "alchemy-test";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { Access } from "@/Cloudflare/Access.ts";
import { redeployCloudflareStateStore } from "@/Cloudflare/StateStore/State.ts";
import { InMemoryService } from "@/State/InMemoryState.ts";
import { StateStoreError } from "@/State/State.ts";
import { httpStateServer } from "../../State/fixtures/http-state-server.ts";

const access = Layer.succeed(Access, { getAccessHeaders: () => Effect.succeed({}) });
const ready = ConfigProvider.layer(
  ConfigProvider.fromUnknown({ ALCHEMY_STATE_STORE_V8_UPGRADE_READY: "true" }),
);
const notReady = ConfigProvider.layer(ConfigProvider.fromUnknown({}));

describe("managed state-store upgrade", { tags: ["unit", "local"] }, () => {
  it.live("uses the v7 transport only for bootstrap then returns the checked v8 client", () =>
    Effect.gen(function* () {
      const backing = yield* InMemoryService(
        {},
        {
          user: { prod: "keep" },
          CloudflareStateStore: { "alchemy-state-store": "bootstrap output" },
        },
      );
      const server = yield* httpStateServer(backing, 7);
      const upgraded = yield* redeployCloudflareStateStore(server.credentials, 7, (legacy) =>
        Effect.gen(function* () {
          expect(
            yield* legacy.getOutput({
              stack: "CloudflareStateStore",
              stage: "alchemy-state-store",
            }),
          ).toBe("bootstrap output");
          expect(
            (yield* legacy
              .deleteOutput({ stack: "CloudflareStateStore", stage: "alchemy-state-store" })
              .pipe(Effect.flip)).message,
          ).toContain("unavailable");
          yield* legacy.setOutput({
            stack: "CloudflareStateStore",
            stage: "alchemy-state-store",
            value: "updated bootstrap output",
          });
          expect(server.requests.some((request) => request.path === "/state/capabilities")).toBe(
            false,
          );
          server.control.revision = 8;
          return server.credentials;
        }),
      );
      expect(yield* upgraded.getVersion()).toBe(8);
      expect(yield* upgraded.getOutput({ stack: "user", stage: "prod" })).toBe("keep");
      expect(server.requests.some((request) => request.path === "/state/capabilities")).toBe(true);
      expect(
        yield* backing.getOutput({ stack: "CloudflareStateStore", stage: "alchemy-state-store" }),
      ).toBe("updated bootstrap output");
    }).pipe(Effect.scoped, Effect.provide([access, ready, FetchHttpClient.layer])),
  );

  it.live("failed deployment keeps prior state and does not return an unchecked user client", () =>
    Effect.gen(function* () {
      const backing = yield* InMemoryService({}, { user: { prod: "keep" } });
      const server = yield* httpStateServer(backing, 7);
      const error = yield* redeployCloudflareStateStore(server.credentials, 7, () =>
        Effect.fail(new StateStoreError({ message: "injected deployment failure" })),
      ).pipe(Effect.flip);
      expect(error.message).toBe("injected deployment failure");
      expect(server.control.revision).toBe(7);
      expect(yield* backing.getOutput({ stack: "user", stage: "prod" })).toBe("keep");
      expect(server.requests.map((request) => request.path)).toEqual(["/version"]);
    }).pipe(Effect.scoped, Effect.provide([access, ready, FetchHttpClient.layer])),
  );

  it.live("requires all managed clients to be updated before allowing the upgrade", () =>
    Effect.gen(function* () {
      const server = yield* httpStateServer(yield* InMemoryService(), 7);
      let deployments = 0;
      const error = yield* redeployCloudflareStateStore(server.credentials, 7, () =>
        Effect.sync(() => {
          deployments++;
          return server.credentials;
        }),
      ).pipe(Effect.flip);
      expect(error.message).toContain("Older clients can downgrade");
      expect(deployments).toBe(0);
      expect(server.requests).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide([access, notReady, FetchHttpClient.layer])),
  );

  it.live("rejects a misidentified v7 worker and refuses to downgrade a newer worker", () =>
    Effect.gen(function* () {
      const server = yield* httpStateServer(yield* InMemoryService(), 9);
      let deployments = 0;
      const redeploy = () =>
        Effect.sync(() => {
          deployments++;
          return server.credentials;
        });
      expect(
        (yield* redeployCloudflareStateStore(server.credentials, 7, redeploy).pipe(Effect.flip))
          .message,
      ).toContain("positively identified");
      expect(
        (yield* redeployCloudflareStateStore(server.credentials, 9, redeploy).pipe(Effect.flip))
          .message,
      ).toContain("downgrade");
      expect(deployments).toBe(0);
    }).pipe(Effect.scoped, Effect.provide([access, ready, FetchHttpClient.layer])),
  );
});
