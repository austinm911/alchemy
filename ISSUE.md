# Docker provider: `examples/docker-postgres` cannot deploy on a clean state store

Five defects in `packages/alchemy/src/Docker/` — dropped container environment
values, a doubled healthcheck directive, two unguarded reads of absent
`Docker.Volume` state, and a volume-replacement ordering gap.

## The repository's own example cannot work

`examples/docker-postgres/alchemy.run.ts` on `main` hits four of the five
defects. Run it against an empty state store and it fails during planning:

```
TypeError: undefined is not an object (evaluating 'olds.context')
    at packages/alchemy/src/Docker/Volume.ts:118:45
    at plan.diff.resource (packages/alchemy/src/Plan.ts:834:18)
    at plan.make (packages/alchemy/src/Plan.ts:1614:12)
```

Guard that one line and it fails during apply:

```
TypeError: undefined is not an object (evaluating 'news.context')
    at packages/alchemy/src/Docker/Volume.ts:161:45
    at provider.create (packages/alchemy/src/Apply.ts:130:14)
```

Guard that one too and the stack deploys, but Postgres crash-loops:

```
Error: Database is uninitialized and superuser password is not specified.
       You must specify POSTGRES_PASSWORD to a non-empty value for the
       superuser.
```

And once the container does start, its healthcheck can never pass, because
every probe runs `CMD-SHELL pg_isready ...` inside a shell.

All four are independent of the example. Any `Docker.Container` with an
`environment` loses every value, any `Docker.Container` or `Docker.Service`
with a Docker-native `healthcheck.cmd` is permanently unhealthy, and any
`Docker.Volume` declared without props cannot be planned.

## 1. Container `environment` values are silently dropped

`packages/alchemy/src/Docker/Docker.ts:591`

```ts
env: env ? Object.keys(env) : undefined,
```

`env` is a `Record<string, string>`, already normalized from `Redacted` by
`normalizeEnvironment` in `Container.ts:479`. `Object.keys(env)` builds
`docker container create --env KEY` with no `=value`. Docker reads a bare
`--env NAME` as "inherit `NAME` from the host environment", so when the host
has no such variable the value is empty. Every `Docker.Container` environment
value is lost.

`formatArgs` (`Docker.ts:907`) already renders a `Record<string, string>` as
`--flag key=value` — that is how `label` reaches Docker correctly. Only `env`
is special-cased, and the special case is what breaks it. The `command` array
is passed correctly, so the defect is specific to env serialization.

Observed on the container the example creates:

```
$ docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' alchemy-example-postgres
POSTGRES_DB
POSTGRES_USER
POSTGRES_PASSWORD
...
```

**Why this has survived undetected:** the defect is only visible on a first
initialization. A long-running project on `alchemy@2.0.0-beta.66` has a
container whose config shows `POSTGRES_DB=`, `POSTGRES_USER=` and
`POSTGRES_PASSWORD=` all empty. It runs anyway, because its data directory was
already initialized and Postgres only requires `POSTGRES_PASSWORD` when it has
to run `initdb`. The named volume outlives every container recreate, so nobody
notices. A fresh volume fails immediately.

**Fix:** stop destructuring `env` out of the options, and let `formatArgs`
render the record.

There is no existing test for container environment variables.

## 2. `Volume.read` dereferences absent prior state

`packages/alchemy/src/Docker/Volume.ts:118`

```ts
read: Effect.fn(function* ({ id, instanceId, olds, output }) {
  const context = dockerContextName(olds.context);
```

`olds` is `undefined` on a first create, so this raises
`TypeError: undefined is not an object (evaluating 'olds.context')` through
`Plan.ts` → `plan.diff.resource` → `plan.make`.

The same unguarded pattern is at `Volume.ts:140` (`diff`) and `Volume.ts:179`
(`delete`).

`dockerContextName` already accepts `Docker.ContextRef | undefined`
(`Docker.ts:849`), so only the property read is wrong.

**Fix:** `olds?.context` at all three sites.

## 3. `Volume.reconcile` dereferences absent props

`packages/alchemy/src/Docker/Volume.ts:161`

```ts
reconcile: Effect.fn(function* ({ id, instanceId, news, output }) {
  const context = dockerContextName(news.context);
  const args = yield* makeVolumeArgs(id, news, instanceId);
  const name = news?.name ?? output?.name ?? args.name;
```

When a volume is declared with no props object at all — `Docker.Volume("id")`,
which is both the documented form (`Volume.ts:80`) and what the example uses —
`news` is `undefined` and `news.context` raises
`TypeError: undefined is not an object (evaluating 'news.context')` through
`Apply.ts` → `provider.create`. Line 165 immediately below already writes
`news?.name`, so the optional case was known.

`news?.context` alone is not sufficient: `makeVolumeArgs`
(`Volume.ts:192`) declares `props: VolumeProps` and reads `props.driver`,
`props.driverOpts` and `props.labels` unguarded, so it raises the next
`TypeError`.

Passing any props object — `Docker.Volume("id", { name: "x" })` — avoids this
defect, which is why defects 1 and 2 surface first, and why a long-running
project that always passes props has never hit it.

**Fix:** `news?.context`, and widen `makeVolumeArgs` to
`props: VolumeProps | undefined` with optional reads. `makeNetworkArgs`
(`Network.ts:181`) is already written this way and is the exact template.

### Note on defects 2 and 3

`Docker.Network` (`Network.ts:97`, `119`, `141`, `168`), `Docker.Service`
(`Service.ts:627`) and `Docker.Swarm` (`Swarm.ts:150`, `163`, `173`) already
guard `olds?.context` / `news?.context`, which suggests the rest of the
provider shares an oversight rather than a deliberate contract.

The `Provider` interface itself is part of the cause: `read`, `diff` and
`delete` declare `olds: Props<Res>` (`Provider.ts:232`, `248`, `313`) and
`reconcile` declares `news: Props<Res>` (`Provider.ts:299`), with no
`| undefined`, while the engine passes `undefined` for both. `reconcile`'s own doc comment
documents `olds === undefined` as a valid input, but the type does not admit
it. `Docker.Container` (`Container.ts:237`, `281`, `318`, `335`, `386`),
`Docker.Image` (`Image.ts:205`, `233`, `243`, `275`) and `Docker.RemoteImage`
(`RemoteImage.ts:139`, `160`, `170`) all read these unguarded as well; they
were left alone here because their props are mandatory (`image` / `name`), so
the engine never passes them absent. Tightening the interface would be a
better long-term fix than guarding each provider.

## 4. `healthcheck.cmd` produces a doubled `CMD-SHELL`

`packages/alchemy/src/Docker/Container.ts:430`

```ts
"health-cmd": Array.isArray(news.healthcheck.cmd)
  ? news.healthcheck.cmd.join(" ")
  : news.healthcheck.cmd,
```

Docker's CLI wraps a `--health-cmd` value in `CMD-SHELL` itself. A caller who
also writes the Docker-native `["CMD-SHELL", "..."]` form therefore gets the
directive twice:

```
$ docker create --health-cmd "CMD-SHELL pg_isready -U alchemy -d app" ...
$ docker inspect --format '{{json .Config.Healthcheck}}' <container>
{"Test":["CMD-SHELL","CMD-SHELL pg_isready -U alchemy -d app"], ...}
```

Every probe then exits 127 with `/bin/sh: CMD-SHELL: not found`, and the
container reports `unhealthy` forever while the service inside it is fine.

The `["CMD-SHELL", "..."]` form is what the repository itself documents and
uses:

- `examples/docker-postgres/alchemy.run.ts:51`
- `website/src/content/docs/docker/index.mdx:56`
- `website/src/content/docs/docker/local-services.mdx:105`

So all documented usage of `healthcheck` is broken. The only test coverage
(`test/Docker/Container.test.ts`, "applies a healthcheck with unit-suffixed
durations") passes `cmd: "true"` with no directive, which is why it passes.

`Docker.Service` has the identical defect at `Service.ts:740` and
`Service.ts:812`.

**Fix:** accept the Docker-native form and drop a leading `CMD-SHELL` or `CMD`
directive, in one shared helper used by `Container` and `Service`. Rejecting
the prefix with an error is the other coherent option, but it would break every
documented example, and `cmd: string[] | string` reads as Docker's own
`Test`-array spelling. The example and both doc pages must change either way,
since they currently produce a permanently unhealthy container.

## 5. Volume replacement deletes a volume the dependent container still mounts

When a `Docker.Volume` diff returns `{ action: "replace", deleteFirst: true }`,
`Apply.ts:1025` tears down the old generation at the volume's own apply step.
A `Docker.Container` in the same stack that mounts the volume has not been
torn down yet, so `docker volume rm` fails:

```
PlatformError: Unknown: Docker.volume.rm (volume rm dockerpostgresexample-postgres-data-dev-am-t6dmzfnkwimhe65h):
  Command exited with code 1: remove dockerpostgresexample-postgres-data-dev-am-t6dmzfnkwimhe65h:
  volume is in use - [a2ed3b61950cc53e00e3559ad21348e102a8cfb5a86ba7c9f0a10e5781fd5e88]
```

Raised from `systemError` (`Docker.ts:889`) through `Apply.ts` →
`provider.delete`.

Reproduce by deploying the example, then changing the volume's `labels` or
`name` and redeploying.

**This is a replacement-ordering gap, not a missing dependency edge.** The
container declares the dependency (`volumes: [{ hostPath: data.name, ... }]`)
and the edge is oriented correctly — the volume applies before the container.
`deleteFirst` is what ignores it: `deleteOldGenerations` (`Apply.ts:984`) runs
as soon as the replaced node applies, with no reverse-topological teardown of
the dependents that still hold the old physical resource.

Fixing this correctly means changing when the engine runs a `deleteFirst`
teardown relative to dependents, which affects every provider that returns
`deleteFirst`. **Reported only — no fix attempted here.** Guidance on the
intended design would be welcome.

## Also: the example and docs mount the Postgres volume at the wrong path

`examples/docker-postgres/alchemy.run.ts:46`,
`website/src/content/docs/docker/index.mdx:52` and
`website/src/content/docs/docker/local-services.mdx:101` all mount the volume
on `/var/lib/postgresql/data`. Postgres 18 images store data in a
major-version subdirectory, so a mount at that path is ignored and the
container refuses to start:

```
Error: in 18+, these Docker images are configured to store database data in a
       format which is compatible with "pg_ctlcluster" ...
       Counter to that, there appears to be PostgreSQL data in:
         /var/lib/postgresql/data (unused mount/volume)
```

The mount belongs on `/var/lib/postgresql`. The same path appears in the
`Container` and `Service` doc comments (`Container.ts:171`,
`Service.ts:487`).

## Reproduction

Defects 1–4 all reproduce with `examples/docker-postgres` unmodified, on a
clean state store:

```sh
git clone https://github.com/alchemy-run/alchemy.git
cd alchemy
git submodule update --init distilled cloudflare-tools
bun install
cd examples/docker-postgres
bun run deploy --yes
```

The run stops at defect 2 during planning. Guard `Volume.ts:118`, rerun, and
it stops at defect 3 during apply. Guard `Volume.ts:161` and
`makeVolumeArgs`, rerun, and it deploys but Postgres crash-loops on defect 1.
Fix defect 1 and the container stays permanently `unhealthy` on defect 4.

Defect 5 needs an already-deployed stack:

```sh
# after a successful deploy, change the volume's labels or name
bun run deploy --yes   # fails: volume is in use
```

Individual checks:

```sh
# defect 1
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' alchemy-example-postgres

# defect 4
docker inspect --format '{{json .Config.Healthcheck}}' alchemy-example-postgres
```

## Environment

| | |
|---|---|
| alchemy | `2.0.0-beta.67` (`main` @ `016c3750`) |
| Bun | 1.3.14 |
| OS | macOS 26.5.1, darwin 25.5.0, arm64 |
| Docker | 29.4.0 |

`alchemy@2.0.0-beta.66`'s `src/Docker/` is byte-identical to beta.67 for all of
this, so none of these defects is a recent regression.

### Unrelated note on the test harness

`packages/alchemy-test` relies on the module loader propagating
`AsyncLocalStorage` into a dynamically imported module's top-level evaluation
(`alchemy-test/src/Registry.ts:8`, `Runner.ts:249`). Bun 1.3.14 does not do
this, so on Bun 1.3.14 every test file fails to collect with
`alchemy-test: describe/test/hook called outside of a test file collection`.
Bun 1.3.13 (the version in `devEngines`) works. Minimal reproduction:

```ts
// als.ts
import { AsyncLocalStorage } from "node:async_hooks";
export const als = new AsyncLocalStorage();

// mod.ts
import { als } from "./als.ts";
console.log("mod body store:", als.getStore());

// main.ts
import { als } from "./als.ts";
await als.run({ a: 1 }, async () => { await import("./mod.ts"); });
```

Bun 1.3.13 and Node print `{ a: 1 }`. Bun 1.3.14 prints `undefined`. CI uses
`bun-version: latest`, so this will break the suite as runners pick up 1.3.14.
