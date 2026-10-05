import { fromApiToken } from "@distilled.cloud/cloudflare/Credentials";
import { describe, expect, it } from "alchemy-test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { R2Auth } from "@/Cloudflare/R2/BucketHttp.ts";
import type { GetOptions, PutOptions } from "@/Cloudflare/R2/BucketTypes.ts";
import { makeReadR2HttpClient } from "@/Cloudflare/R2/ReadBucketHttp.ts";
import { makeWriteR2HttpClient } from "@/Cloudflare/R2/WriteBucketHttp.ts";
import { RuntimeContext } from "@/RuntimeContext.ts";

const runtime = RuntimeContext.phantom;
const acknowledged = {
  key: "ack-key",
  size: "6",
  etag: '"server-etag"',
  uploaded: "2026-01-02T03:04:05.000Z",
  version: "server-version",
  storage_class: "Standard",
};
const clients = (response: () => Response) => {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  let scopes = 0;
  const transport = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push(request);
      return HttpClientResponse.fromWeb(request, response());
    }),
  );
  const auth: R2Auth = {
    accountId: Effect.sync(() => {
      scopes++;
      return "account";
    }),
    authorize: (effect) =>
      effect.pipe(
        Effect.provide(fromApiToken({ apiToken: "test-token" })),
        Effect.provideService(HttpClient.HttpClient, transport),
      ),
  };
  return {
    requests,
    scopes: () => scopes,
    read: makeReadR2HttpClient(auth, Effect.succeed("bucket"), Effect.succeed("default")),
    write: makeWriteR2HttpClient(auth, Effect.succeed("bucket"), Effect.succeed("default")),
  };
};
const response = () =>
  Response.json({ success: true, errors: [], messages: [], result: acknowledged });

describe("R2 HTTP options", { tags: ["unit", "local"] }, () => {
  const gets: GetOptions[] = [
    { range: { offset: 0 } },
    { range: new Headers() },
    { onlyIf: {} },
    { ssecKey: "" },
    { range: { suffix: 0 }, onlyIf: { etagMatches: "private-value" } },
  ];
  for (const [index, options] of gets.entries()) {
    it.effect(`rejects get option ${index} before scope or network`, () =>
      Effect.gen(function* () {
        const client = clients(response);
        const exit = yield* Effect.exit(client.read.get("key", options));
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          expect(Cause.pretty(exit.cause)).toContain("R2 HTTP does not support options");
          expect(Cause.pretty(exit.cause)).not.toContain("private-value");
        }
        expect(client.scopes()).toBe(0);
        expect(client.requests).toEqual([]);
      }).pipe(Effect.provide(runtime)),
    );
  }
  const puts: PutOptions[] = [
    { httpMetadata: { contentType: "" } },
    { httpMetadata: new Headers({ "Content-Type": "text/plain" }) },
    { customMetadata: {} },
    { customMetadata: { private: "private-value" } },
    { onlyIf: {} },
    { md5: "" },
    { sha1: "" },
    { sha256: "" },
    { sha384: "" },
    { sha512: "" },
    { ssecKey: "" },
    { httpMetadata: { cacheExpiry: new Date(0) } },
    { httpMetadata: new Headers({ Expires: "" }) },
    { customMetadata: {}, onlyIf: {}, sha256: "" },
  ];
  for (const [index, options] of puts.entries()) {
    it.effect(`rejects put option ${index} without consuming either stream type`, () =>
      Effect.gen(function* () {
        const client = clients(response);
        let reads = 0;
        const readable = new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              reads++;
              controller.close();
            },
          },
          { highWaterMark: 0 },
        );
        const stream = Stream.fromEffect(
          Effect.sync(() => {
            reads++;
            return new Uint8Array(0);
          }),
        );
        for (const body of [readable, stream]) {
          const exit = yield* Effect.exit(
            client.write.put("key", body, { ...options, contentLength: 0 }),
          );
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).not.toContain("private-value");
        }
        expect(reads).toBe(0);
        expect(client.scopes()).toBe(0);
        expect(client.requests).toEqual([]);
      }).pipe(Effect.provide(runtime)),
    );
  }
  it.effect("rejects inherited getters and nonenumerable unsupported options", () =>
    Effect.gen(function* () {
      class ReadOptions {
        get onlyIf() {
          return { etagMatches: "private-value" };
        }
      }
      class WriteOptions {
        get customMetadata() {
          return { private: "private-value" };
        }
      }
      class Metadata {
        get cacheExpiry() {
          return new Date(0);
        }
      }
      const hidden: PutOptions = {};
      Object.defineProperty(hidden, "onlyIf", { value: { etagMatches: "private-value" } });
      const client = clients(response);
      const effects = [
        client.read.get("key", new ReadOptions()),
        client.write.put("key", "body", new WriteOptions()),
        client.write.put("key", "body", hidden),
        client.write.put("key", "body", { httpMetadata: new Metadata() }),
      ];
      for (const effect of effects) {
        const exit = yield* Effect.exit(effect);
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("does not support");
      }
      expect(client.scopes()).toBe(0);
      expect(client.requests).toEqual([]);
    }).pipe(Effect.provide(runtime)),
  );
  it.effect("validates supplied length in bytes before upload", () =>
    Effect.gen(function* () {
      const client = clients(response);
      for (const body of [
        "é",
        new Uint8Array([1, 2]),
        new Blob(["é"]),
        Stream.make(new Uint8Array([1, 2])),
      ]) {
        const error = yield* client.write
          .put("key", body, { contentLength: 999 })
          .pipe(Effect.flip);
        expect(error.message).toContain("body byte length");
      }
      expect(client.requests).toEqual([]);
      yield* client.write.put("key", "é", { contentLength: 2 });
      expect(client.requests[0]?.headers["content-length"]).toBe("2");
    }).pipe(Effect.provide(runtime)),
  );
  it.effect("serializes supported headers and returns the acknowledgement", () =>
    Effect.gen(function* () {
      const client = clients(response);
      const result = yield* client.write.put("requested-key", "abcdef", {
        contentLength: 6,
        storageClass: "InfrequentAccess",
        httpMetadata: new Headers({
          "Content-Encoding": "identity",
          "Content-Disposition": "inline",
          "Content-Language": "en",
          "Cache-Control": "max-age=1",
          "X-Ignored": "ignored",
        }),
      });
      expect(client.requests).toHaveLength(1);
      const request = client.requests[0];
      expect(request?.method).toBe("PUT");
      for (const [key, value] of Object.entries({
        "content-length": "6",
        "cf-r2-storage-class": "InfrequentAccess",
        "content-encoding": "identity",
        "content-disposition": "inline",
        "content-language": "en",
        "cache-control": "max-age=1",
      }))
        expect(request?.headers[key]).toBe(value);
      expect(request?.headers["x-ignored"]).toBeUndefined();
      expect(result?.key).toBe("ack-key");
      expect(result?.size).toBe(6);
      expect(result?.etag).toBe("server-etag");
      expect(result?.httpEtag).toBe('"server-etag"');
      expect(result?.version).toBe("server-version");
      expect(result?.storageClass).toBe("Standard");
      expect(result?.uploaded).toEqual(new Date(acknowledged.uploaded));
      expect(result?.httpMetadata).toEqual({});
      expect(result?.customMetadata).toEqual({});
    }).pipe(Effect.provide(runtime)),
  );
  for (const result of [
    {},
    { ...acknowledged, size: "NaN" },
    { ...acknowledged, size: "-1" },
    { ...acknowledged, uploaded: "bad date" },
  ]) {
    it.effect(`rejects invalid acknowledgement ${JSON.stringify(result)}`, () =>
      Effect.gen(function* () {
        const client = clients(() =>
          Response.json({ success: true, errors: [], messages: [], result }),
        );
        expect(Exit.isFailure(yield* Effect.exit(client.write.put("key", "abcdef")))).toBe(true);
        expect(client.requests).toHaveLength(1);
      }).pipe(Effect.provide(runtime)),
    );
  }
  it.effect("missing-key reads still return null", () =>
    Effect.gen(function* () {
      const client = clients(() =>
        Response.json(
          {
            success: false,
            errors: [{ code: 10007, message: "The specified key does not exist" }],
          },
          { status: 404 },
        ),
      );
      expect(yield* client.read.get("missing")).toBeNull();
      expect(client.requests).toHaveLength(1);
    }).pipe(Effect.provide(runtime)),
  );

  it.effect("retains no-option reads and undefined options", () =>
    Effect.gen(function* () {
      const client = clients(
        () => new Response("abcdef", { headers: { "content-length": "6", etag: '"v1"' } }),
      );
      const result = yield* client.read.get("key", { range: undefined, onlyIf: undefined });
      expect(result).not.toBeNull();
      if (result) expect(yield* result.text()).toBe("abcdef");
      expect(client.requests).toHaveLength(1);
    }).pipe(Effect.provide(runtime)),
  );
});
