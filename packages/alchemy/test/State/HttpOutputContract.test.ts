import { describe, expect, it } from "alchemy-test";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Redacted from "effect/Redacted";
import { makeHttpStateStore } from "@/State/HttpStateStore.ts";
import { InMemoryService } from "@/State/InMemoryState.ts";
import { httpStateServer } from "./fixtures/http-state-server.ts";

describe("HTTP output protocol", { tags: ["unit", "local"] }, () => {
  it.live("round-trips presence and encoded values and deletes only the output", () =>
    Effect.gen(function* () {
      const backing = yield* InMemoryService();
      const server = yield* httpStateServer(backing);
      const store = yield* makeHttpStateStore({ ...server.credentials, id: "contract" });
      const request = { stack: "app", stage: "dev" };
      expect(yield* store.getOutput(request)).toBeUndefined();
      for (const value of [
        null,
        0,
        false,
        "",
        [],
        { nested: { date: new Date("2026-01-02"), secret: Redacted.make("fixture-secret") } },
      ]) {
        yield* store.setOutput({ ...request, value });
        const read = yield* store.getOutput(request);
        expect(read).toEqual(value);
        expect(yield* store.listStages("app")).toEqual(["dev"]);
      }
      yield* store.deleteOutput(request);
      yield* store.deleteOutput(request);
      expect(yield* store.getOutput(request)).toBeUndefined();
      expect(yield* store.listStacks()).toEqual([]);
      expect(
        server.requests.filter((request) => request.path === "/state/capabilities"),
      ).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );

  it.live("keeps the legacy raw endpoint unchanged", () =>
    Effect.gen(function* () {
      const state = yield* InMemoryService({}, { app: { dev: { value: "old-client" } } });
      const server = yield* httpStateServer(state);
      const http = yield* HttpClient.HttpClient;
      const response = yield* http.get(
        `${server.credentials.url}/state/stacks/app/stages/dev/output`,
        { headers: { authorization: "Bearer fixture-token" } },
      );
      expect(yield* response.json).toEqual({ value: "old-client" });
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );

  it.live("rejects an old server before any mutation", () =>
    Effect.gen(function* () {
      const backing = yield* InMemoryService({}, { app: { dev: "original" } });
      const server = yield* httpStateServer(backing, 7);
      const store = yield* makeHttpStateStore({ ...server.credentials, id: "contract" });
      const error = yield* store.deleteOutput({ stack: "app", stage: "dev" }).pipe(Effect.flip);
      expect(error.message).toContain("protocol 6");
      expect(server.requests.every((request) => request.path === "/state/capabilities")).toBe(true);
      expect(yield* backing.getOutput({ stack: "app", stage: "dev" })).toBe("original");
      server.control.revision = 8;
      yield* store.deleteOutput({ stack: "app", stage: "dev" });
      expect(yield* backing.getOutput({ stack: "app", stage: "dev" })).toBeUndefined();
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );

  it.live("rejects incomplete capabilities before reading resource listings", () =>
    Effect.gen(function* () {
      const server = yield* httpStateServer(yield* InMemoryService());
      server.control.capabilities = ["output-presence-v1", "delete-output-v1"];
      const store = yield* makeHttpStateStore({ ...server.credentials, id: "contract" });
      expect((yield* store.listStacks().pipe(Effect.flip)).message).toContain("enumeration");
      expect(server.requests.map((request) => request.path)).toEqual(["/state/capabilities"]);
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  );
});
