import { useState } from "octane";
import { createFileRoute } from "@octanejs/tanstack-router";
import { getAndIncrementCount } from "../utils/counter.ts";

export const Route = createFileRoute("/counter")({
  loader: () => getAndIncrementCount(),
  component: Counter,
});

function Counter() @{
  const initial = Route.useLoaderData();
  const [count, setCount] = useState(initial.count);

  <main style={{ maxWidth: 720, margin: "0 auto", padding: "4rem 1.5rem" }}>
    <h1 style={{ margin: 0, fontSize: "2rem" }}>Server function + KV binding</h1>
    <p style={{ lineHeight: 1.6 }}>
      Each visit runs a TanStack Start server function in the deployed Worker
      that increments a counter persisted in a Cloudflare KV namespace.
    </p>
    <button
      type="button"
      onClick={async () => {
        const next = await getAndIncrementCount();
        setCount(next.count);
      }}
      style={{
        padding: "0.75rem 1rem",
        border: "none",
        borderRadius: 8,
        background: "#0f172a",
        color: "#fff",
        cursor: "pointer",
      }}
    >
      count is {count}
    </button>
  </main>
}
