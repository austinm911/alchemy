import {
  Body,
  Head,
  HeadContent,
  Html,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
} from "@octanejs/tanstack-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Octane + TanStack Start" },
    ],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
});

function RootDocument(props: { children?: unknown }) @{
  <Html lang="en">
    <Head>
      <HeadContent />
    </Head>
    <Body>
      {props.children}
      <Scripts />
    </Body>
  </Html>
}

function RootLayout() @{
  <>
    <nav
      style={{
        display: "flex",
        gap: "1rem",
        padding: "1rem 1.5rem",
        background: "#0f172a",
        color: "#fff",
      }}
    >
      <Link
        to="/"
        activeOptions={{ exact: true }}
        activeProps={{ style: { fontWeight: 700 } }}
        style={{ color: "#fff", textDecoration: "none" }}
      >
        Home
      </Link>
      <Link
        to="/counter"
        activeProps={{ style: { fontWeight: 700 } }}
        style={{ color: "#fff", textDecoration: "none" }}
      >
        Counter
      </Link>
    </nav>
    <Outlet />
  </>
}
