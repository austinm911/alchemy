import { Link, createFileRoute } from "@octanejs/tanstack-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() @{
  <main style={{ maxWidth: 720, margin: "0 auto", padding: "4rem 1.5rem" }}>
    <h1 style={{ margin: 0, fontSize: "2.5rem" }}>Octane + TanStack Start</h1>
    <p style={{ fontSize: "1.125rem", lineHeight: 1.6 }}>
      An OctaneJS app on TanStack Start, server-rendered by Octane and deployed
      by Alchemy to Cloudflare Workers.
    </p>
    <p style={{ lineHeight: 1.6 }}>
      The{" "}
      <Link to="/counter" style={{ color: "#2563eb" }}>
        counter
      </Link>{" "}
      page is a server function backed by a KV binding.
    </p>
  </main>
}
