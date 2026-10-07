import { describe, expect, it } from "alchemy-test";
import {
  toPostgresClusterArch,
  toPostgresClusterSku,
} from "@/Planetscale/Postgres/PostgresClusterSize.ts";

describe("Postgres branch cluster SKU", () => {
  for (const [architecture, suffix] of [
    ["aarch64", "ARM"],
    ["x86_64", "X86"],
    [undefined, "X86"],
  ] as const) {
    it(`derives ${suffix} from ${architecture}`, () => {
      for (const size of ["PS_DEV", "PS_5"]) {
        expect(
          toPostgresClusterSku({
            size,
            arch: toPostgresClusterArch(architecture),
            region: "us-east",
          }),
        ).toBe(`${size}_AWS_${suffix}`);
      }
    });
  }
});
