import * as Effect from "effect/Effect";
import { R2Error, type GetOptions, type PutOptions } from "./BucketTypes.ts";

const getSupport = {
  range: false,
  onlyIf: false,
  ssecKey: false,
} satisfies Record<keyof GetOptions, boolean>;

const putSupport = {
  httpMetadata: true,
  contentLength: true,
  storageClass: true,
  customMetadata: false,
  onlyIf: false,
  md5: false,
  sha1: false,
  sha256: false,
  sha384: false,
  sha512: false,
  ssecKey: false,
} satisfies Record<keyof PutOptions, boolean>;

const metadataSupport = {
  contentType: false,
  contentEncoding: true,
  contentDisposition: true,
  contentLanguage: true,
  cacheControl: true,
  cacheExpiry: false,
} satisfies Record<keyof Exclude<NonNullable<PutOptions["httpMetadata"]>, Headers>, boolean>;

const unsupported = (options: object | undefined, support: Record<string, boolean>) => {
  const supported = new Map(Object.entries(support));
  if (options === undefined) return [];
  const keys = new Set([...Object.keys(support), ...Object.keys(options)]);
  return [...keys].filter((key) => {
    const value: unknown = Reflect.get(options, key);
    return value !== undefined && supported.get(key) !== true;
  });
};

const reject = (fields: string[]) =>
  Effect.die(
    new R2Error({
      message: `R2 HTTP does not support options: ${fields.join(", ")}. Use a native R2 binding or an S3 client.`,
      cause: new Error("unsupported"),
    }),
  ).pipe(Effect.when(Effect.succeed(fields.length > 0)), Effect.asVoid);

export const validateHttpGetOptions = Effect.fn("R2.validateHttpGetOptions")(
  (options?: GetOptions) => reject(unsupported(options, getSupport)),
);

export const validateHttpPutOptions = Effect.fn("R2.validateHttpPutOptions")((
  options?: PutOptions,
) => {
  const fields = unsupported(options, putSupport);
  const metadata = options?.httpMetadata;
  if (metadata instanceof Headers) {
    if (metadata.has("expires")) fields.push("httpMetadata.Expires");
    if (metadata.has("content-type")) fields.push("httpMetadata.Content-Type");
  } else {
    fields.push(...unsupported(metadata, metadataSupport).map((key) => `httpMetadata.${key}`));
  }
  return reject(fields);
});
