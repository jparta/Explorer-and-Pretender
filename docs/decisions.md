# Decisions

Project-wide decision log. Newest last. Each entry records what was decided, what else was considered, and why.

Entries are numbered D1, D2, … in the order they were made, and other documents refer to them by that number. A number is never reused, and entries aren't deleted. An entry that a later decision replaces entirely says *Superseded by D…* under its heading. An entry that a later decision changes only in part gets a short note there instead, saying what changed and where. Likewise, S-numbers such as S2.4 refer to requirements in a phase's spec.

Decisions are made by the project author. AI assistants helped research options and draft entries; each entry records the author's choice.

## D1 — Kubernetes from the start, no Docker Compose

**Decision:** Develop and run locally on Kubernetes from Phase 1. No Compose file.

**Alternatives:** Compose in Phase 1, Kubernetes from Phase 2; or keep both permanently.

**Why:** Compose would be written, kept in sync and then retired — extra work and one more thing to think about. Learning Kubernetes is the point of the project and would happen in Phase 2 anyway; doing it first moves that work rather than adding it. Dropping Compose doesn't drop the quick start: after cloning, the project should still be running within a couple of commands. The difference is the prerequisites: Docker, kind and Tilt instead of Docker alone. Cost: the first working demo arrives later.

## D2 — Tilt for the local development loop

**Decision:** Use Tilt to build images, deploy to the local cluster and live-update code.

**Alternatives:** Skaffold, DevSpace, plain `kubectl` and scripts.

**Why:** Tilt is actively maintained (monthly releases as of October 2026) and its dashboard shows every component's status and logs side by side. Skaffold's repository will be archived on 29 January 2027 with no named successor. DevSpace's last stable release was April 2026. Plain scripts would mean rebuilding Tilt's watch-build-deploy loop by hand.

**Watch out:** Tilt only rewrites image references in manifests it deploys. Jobs created at runtime (Phase 2) need the image reference passed another way, e.g. through an environment variable.

## D3 — Runner, web and Redis as separate components

*The store is now Valkey instead of Redis (D18), and Sessions travel through Streams instead of pub/sub (D19); the split into three components stays as decided here.*

**Decision:** Split the system from the start into a runner (runs Sessions), a web tier (serves viewers) and Redis pub/sub between them.

**Alternatives:** One process doing everything, split later.

**Why:** Redeploying the website restarts the web pods; if Sessions ran there, every live Session would die with each deploy. Even with a single web replica, a rolling update briefly runs the old and new pod side by side, and both must see the same Sessions. Pods don't share memory, so Sessions have to be published somewhere every web pod can read. Phase 2 moves Sessions into their own Jobs, which need that channel anyway, so splitting from the start avoids a refactor.

## D4 — Server-Sent Events for live viewing

**Decision:** Stream Sessions to browsers with Server-Sent Events.

**Alternatives:** WebSockets, long polling.

**Why:** Data only flows from server to viewer. SSE is plain HTTP, reconnects automatically and resumes with `Last-Event-ID`. WebSockets add a client-to-server channel we don't need, plus manual reconnects and keepalives.

## D5 — Gateway API for incoming traffic

**Decision:** Route incoming traffic with the Gateway API, locally and in production. Routing arrives in Phase 2; in Phase 1 the web tier is reached through Tilt's port forwarding.

**Alternatives:** The Ingress API.

**Why:** The Kubernetes project recommends the Gateway API for new work. Ingress is frozen — not removed, but no longer developed — and its most common controller, ingress-nginx, was retired in March 2026 with no further security fixes. k3s ships Traefik, which supports the Gateway API once enabled.

## D6 — Self-managed k3s in the cloud

**Decision:** Phase 3 runs k3s on a cloud VM provisioned with OpenTofu.

**Alternatives:** A managed cluster (EKS, GKE, AKS, DigitalOcean, Linode).

**Why:** Running the cluster ourselves is a learning goal and part of what the project demonstrates: provisioning the VM with OpenTofu and operating Kubernetes on it. k3s is certified Kubernetes in a single small binary, so one small VM is enough and the manifests are unchanged. It is also somewhat cheaper, but only by a few euros a month against providers with a free control plane, so cost is not the main reason. Cost: OS updates, Kubernetes upgrades, backups and security are ours to handle.

## D7 — kind for the local cluster

*Superseded by D36.*

**Decision:** Run the local development cluster with kind.

**Alternatives:** Docker Desktop's built-in cluster, minikube.

**Why:** The cluster is defined in a config file in the repo, which is good developer experience and shows reviewers exactly what runs. kind is the standard choice for Kubernetes in CI/CD (e.g. GitHub Actions). Docker Desktop's cluster mainly saves image loading, which Tilt does automatically for kind. minikube has handy add-ons, but they won't be available on k3s in the prod deployment anyway. We'll install what we need ourselves, portably.

**Note:** Docker Desktop is still needed as the engine kind runs on.

## D8 — OpenRouter as the LLM provider

**Decision:** Call the models through OpenRouter.

**Alternatives:** Each model's own provider directly (Anthropic, OpenAI, DeepSeek, …).

**Why:** One key and one OpenAI-compatible API reach every candidate model, which suits trial runs across several. Each response reports its own cost, and a key can carry a daily spending limit that resets at midnight UTC. The spec's OpenAI-compatible constraint keeps switching away possible.

**Sources:** [key limits and resets](https://openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key.md), [cost in every response](https://openrouter.ai/docs/use-cases/usage-accounting) (checked November 2026).

## D9 — One repository with workspaces

**Decision:** Keep the front end, web server, runner and shared code in one repository as separate workspaces.

**Alternatives:** Separate folders without shared packages; separate repositories.

**Why:** Shared code, above all the Session event types, lives in one package that every part imports, so a change to an event is checked everywhere at once.

## D10 — Kustomize for Kubernetes manifests

**Decision:** Write the manifests as a Kustomize base plus overlays.

**Alternatives:** Plain YAML, Helm.

**Why:** Kustomize is built into `kubectl` and keeps the manifests plain YAML. A shared base with small overlays for the local cluster and, in Phase 3, the cloud avoids duplicating them. Helm's templating and packaging are more than one app needs.

## D11 — The exhibition counts spend, the provider limit backs it up

**Decision:** The exhibition counts each call's reported cost against the daily $2 cap. The API key's daily limit at the provider, 10% above the cap, is a backstop. The margin lets running Sessions finish after the cap is reached.

**Alternatives:** The provider's key limit alone, with no count of our own.

**Why:** Safer. The key limit lives in the provider's dashboard, outside the repo, so a key created without one would leave only the prepaid balance as a cap. With both, either one holds if the other fails, and the prepaid balance remains the absolute ceiling. Cost: a counter to store, reset at midnight UTC and keep correct across restarts.

## D12 — TypeScript for the whole stack

**Decision:** Write the front end, web server and runner in TypeScript.

**Alternatives:** A different language for the back end (for example Go or Python), with TypeScript only in the front end.

**Why:** TypeScript is mature for front-end work, and one language across the stack lets the front end and back end share types, above all the Session event payload (see D9).

## D13 — The `openai` package as the LLM client

**Decision:** The runner calls OpenRouter through the official `openai` npm package, with its base URL set to OpenRouter.

**Alternatives:** OpenRouter's own SDK (`@openrouter/sdk`); the Vercel AI SDK with its OpenRouter provider.

**Why:** It is the most mature of the three, and it keeps the code on the OpenAI-compatible API the spec requires, so moving away from OpenRouter means changing only the address. OpenRouter's SDK is still in beta, and the Vercel AI SDK brings far more than the runner needs. Cost: OpenRouter's extra response fields, such as each call's cost, are missing from the package's types, so we add a small type for them.

**Sources:** [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting.md), [OpenRouter TypeScript SDK (beta)](https://openrouter.ai/docs/client-sdks/typescript/overview.md) (checked November 2026).

## D14 — Hono for the API and SSE

**Decision:** The web server's API and SSE endpoints use Hono.

**Alternatives:** The runtime's own server alone (for example `Bun.serve`), Express 5, Fastify 5.

**Why:** Hono is lightweight but brings the essentials: an SSE helper that handles formatting, disconnects and keep-alive pings, ready-made middleware, and route tests without a running server. It is built on web standards, so the same code runs on Node, Bun and other runtimes, and the runtime can be changed by swapping an adapter.

**Sources:** [Hono streaming helpers](https://hono.dev/docs/helpers/streaming), [the story of Hono, from its creator](https://www.plushcap.com/content/cloudflare/blog/cloudflare-the-story-of-web-framework-hono-from-the-creator-of-hono) (checked November 2026).

## D15 — Bun as the runtime

**Decision:** Run the web server and runner on Bun.

**Alternatives:** Node.js 26 LTS; Deno.

**Why:** One tool covers installing, running and testing, so the setup is simpler. Bun also brings new ideas worth having experience with. This is not a project that must avoid downtime, so Bun's support model is acceptable: only the newest 1.x release gets fixes, and upgrades inside 1.x have occasionally changed behaviour. Leaving Bun later would take about a day, since Hono (D14) runs on Node by swapping its adapter. Deno was ruled out because its team joined Cloudflare in October 2026 and independent runtime development is set to end about a year later. Bun is owned by Anthropic, whose model helped research this choice.

**Sources:** [Bun security policy](https://www.GitHub.com/oven-sh/bun/security), [Bun v1.1.27 release notes](https://bun.com/blog/bun-v1.1.27), [Node.js release schedule](https://nodejs.org/fr/blog/announcements/evolving-the-nodejs-release-schedule), [Deno team joins Cloudflare](https://alternativeto.net/news/2026/10/deno-team-joins-cloudflare-as-runtime-development-winds-down/) (checked November 2026).

## D16 — Bun builds the front end

**Decision:** Develop and build the React front end with Bun's own tools: its dev server with hot reloading during development, and its bundler (`bun build`) for production.

**Alternatives:** Vite, run by Bun.

**Why:** One less moving part: Bun already runs, tests and installs everything else. Vite is more mature and has more plugins, but a single React page doesn't need them. Cost: Bun's front-end tooling is younger, and its dev server is built around the server code importing the page. Switching to Vite later is possible since the React code itself doesn't change.

**Sources:** [Bun full-stack dev server](https://bun.com/docs/bundler/fullstack), [Bun hot reloading](https://bun.com/docs/bundler/hmr), [Bun vs Vite (Vercel)](https://vercel.com/i/bun-vs-vite) (checked November 2026).

## D17 — `bun install` as the package manager

**Decision:** Manage packages and workspaces with `bun install`.

**Alternatives:** pnpm.

**Why:** It comes with Bun, so there is nothing extra to install in images or on a developer's machine, and it covers most of what pnpm does: workspaces, isolated installs (the default for new workspaces) and blocking dependencies' install scripts unless they are trusted.

**Sources:** [bun install](https://bun.com/docs/pm/cli/install), [isolated installs](https://bun.com/docs/install/isolated), [Bun v1.3.2 release notes](https://bun.com/blog/bun-v1.3.2) (checked November 2026).

## D18 — Valkey as the data store

**Decision:** Use Valkey, the Linux Foundation's fork of Redis, for the store shared by the runner and the web server (D3), in place of Redis.

**Alternatives:** Redis 8.

**Why:** Open-source development of the Redis code base is now concentrated in Valkey, and the Linux Foundation, which owns the project, is a neutral home whose stewardship we trust: no single company can change the licence, as Redis Ltd. did in 2024. For the commands this project uses the two are the same, so switching later is an image change.

**Sources:** [Redis vs Valkey: understanding the fork](https://oneuptime.com/blog/post/2026-03-31-redis-redis-vs-valkey-understanding-the-fork/view), [Redis lost most of its external contributors](https://devclass.com/2025/04/01/one-year-ago-redis-changed-its-license-and-lost-most-of-its-external-contributors/), [Valkey vs Redis in 2026](https://betterstack.com/community/comparisons/redis-vs-valkey/) (checked November 2026).

## D19 — Valkey Streams for Session events, one stream per Session

**Decision:** The runner appends each Session's events to a Valkey Stream of its own. The web server reads them from there. The stream expires one minute after the Session ends, so a viewer who reconnects just then still gets the ending, and a length limit guards against a runaway Session.

**Alternatives:** Pub/sub, which delivers each message to whoever is subscribed at that moment and stores nothing. D3 originally named pub/sub; this replaces it.

**Why:** A stream keeps events until it is deleted, so nothing is lost while a web server pod restarts or a viewer's connection drops: the browser reconnects with the ID of the last event it saw (SSE's `Last-Event-ID`) and reading resumes from there, on whichever pod answers. Gaps like that would look glitchy, and rolling updates make restarts routine. A viewer who joins mid-message can be shown that message from its start instead of mid-sentence. And keeping finished streams would make replaying Sessions from the beginning possible later. One Session's stream is roughly 120 KB, so storage is not a concern.

**Cost:** More code and concepts than pub/sub: entry IDs, blocking reads, trimming and expiry. Streams make smooth reconnects possible, not automatic; the web server and client still have to pass IDs along correctly. They do not help when the runner restarts: the Session itself is then interrupted.

**Sources:** [Valkey Streams introduction](https://valkey.io/topics/streams-intro/), [Server-sent events and `Last-Event-ID` (HTML standard)](https://html.spec.whatwg.org/multipage/server-sent-events.html) (checked November 2026).

## D20 — The web server serves the front end

**Decision:** Hono, in the web server, serves the front end's built files (D16) alongside the API and SSE.

**Alternatives:** A separate static file server (nginx or Caddy) in its own pod; a CDN or object storage.

**Why:** This is a small app, and it is much simpler without another server. The components stay the three of D3, the browser talks to a single address, so no routing or CORS is needed in Phase 1, and it fits Bun's dev server, which is built around the server serving the page. Cost: every front-end change replaces the web pod, which D19 makes harmless to viewers, and the front end and server cannot be deployed separately.

## D21 — Presence reported by a heartbeat request, kept as expiring keys

**Decision:** Each open page holds one SSE connection that carries all slots' events and their status. Separately, while its tab is active, the page sends `POST /presence` with the slot in focus whenever focus or visibility changes and every few seconds otherwise. The web server records presence and watching as Valkey keys that expire unless refreshed. The runner reads them: it starts a Session when a watched slot is idle, and stops running Sessions when nobody is present. The key names and expiry times live in the shared package (D9), so the web server and runner use the same definitions.

**Alternatives:** Treating an open SSE connection as presence; putting the focused slot in the SSE address; counting viewers with a counter that goes up and down.

**Why:** A background tab keeps its connection open so its Session keeps appearing (spec S4.9) but is not present, so the connection cannot be the signal. Putting the focus in the address would mean reconnecting on every focus change. Expiring keys repair themselves: a web pod that crashes never gets to decrease a counter, which would stay wrong, while a key it stops refreshing simply expires. One endpoint covers both keeping Sessions alive and starting them, and slot status reaches the page over the SSE connection it already has.

## D22 — A runner restart interrupts Sessions in Phase 1; resuming them waits for Phase 2

**Decision:** In Phase 1, when the runner restarts, its running Sessions end as interrupted. Resuming them after a restart is Phase 2 work.

**Alternatives:** Resume Sessions already in Phase 1, rebuilding their history from their streams in Valkey.

**Why:** Phase 2 moves each Session into its own Kubernetes Job, which changes what a restart is: Kubernetes retries a failed Job pod, and resuming is what such a retry needs. Designing it once, together with Jobs, avoids building it twice. Valkey's persistence (D23) keeps the streams that resuming will rebuild from.

## D23 — Valkey keeps an append-only file on a volume

**Decision:** Valkey writes every change to an append-only file (AOF) on a persistent volume, flushed to disk every second.

**Alternatives:** No persistence; periodic snapshots (RDB).

**Why:** Correctness: a Valkey restart loses at most about a second of writes, so the day's spend count survives restarts as D11 requires, and so do Session streams, which resuming in Phase 2 (D22) rebuilds from. Snapshots could lose minutes.

**Sources:** [Valkey persistence](https://valkey.io/topics/persistence/) (checked November 2026).

## D24 — One runner, replaced with the Recreate strategy

**Decision:** The runner runs as a single replica, and its Deployment uses the Recreate strategy: the old pod stops before the new one starts.

**Alternatives:** The default RollingUpdate strategy, which starts the new pod before stopping the old one, with a lock in Valkey so two runners don't drive the same slot.

**Why:** The runner's slot loops assume they are the only ones deciding when a slot starts a Session. Recreate guarantees one runner at a time without any locking. Cost: a few seconds without a runner during each update, and running Sessions are interrupted (D22).

**Sources:** [Deployment strategies](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#strategy) (checked November 2026).

## D25 — Two web replicas

**Decision:** The web Deployment runs two replicas.

**Alternatives:** One replica.

**Why:** It shows that the web pods are stateless: either pod can serve any viewer, and a viewer who reconnects to the other pod continues where they were. Cost: a little more memory.

## D26 — Memory sizes

**Decision:** Each container's memory request equals its limit: 128 MiB for web and runner, 64 MiB for Valkey.

**Alternatives:** No requests or limits; limits above requests.

**Why:** Bun idles at roughly 30–50 MB, and Valkey's data here is a few megabytes, so these leave room while keeping the whole app small enough for a small cloud VM in Phase 3. A request equal to the limit means the scheduler reserves exactly what the container may use, so a node never promises more memory than it has. To be checked against measured usage.

**Sources:** [Resource management for pods and containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) (checked November 2026).

## D27 — Tilt creates the API key's Secret from `.env`

**Decision:** In development, the Tiltfile creates the Kubernetes Secret holding the API key from the `.env` file at the repository root.

**Alternatives:** Kustomize's secretGenerator with `.env` moved into the local overlay's folder; secretGenerator reading the root `.env` with Kustomize's file-loading restriction turned off.

**Why:** `.env` stays at the repository root, which keeps the README's setup steps simple, and nothing about the key ends up in the manifests. Tilt is only used in development, so Phase 3 needs its own way to provide the key.

**Sources:** [Kustomize secretGenerator](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/secretgenerator/) (checked November 2026).

## D28 — Valkey runs as a StatefulSet

**Decision:** Valkey runs as a StatefulSet with one replica. Its volume comes from the StatefulSet's volume claim template, and a headless Service gives it a stable name.

**Alternatives:** A Deployment with a separately written PersistentVolumeClaim and the Recreate strategy.

**Why:** A StatefulSet is made for this case: it creates the volume claim itself, gives the pod a stable identity (`valkey-0`) that keeps the same volume across restarts, and never runs two pods with the same identity at once, so two Valkey processes can't write the same file. It is also the standard pattern for databases on Kubernetes, which is worth learning.

**Sources:** [StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/), [headless Services](https://kubernetes.io/docs/concepts/services-networking/service/#headless-services) (checked November 2026).

## D29 — Health checks

**Decision:**
- **web:** a readiness probe on `/readyz`, which checks that Valkey answers, and a liveness probe on `/livez`, which checks only the process.
- **valkey:** `valkey-cli ping` for both readiness and liveness.
- **runner:** a liveness probe on a small `/livez` endpoint of its own, which fails when a slot loop has stopped ticking. It has no readiness probe, since nothing sends it traffic.

**Alternatives:** For the runner, no probe (Kubernetes then only notices if the process exits), or a command probe checking a file the loops touch.

**Why:** Readiness and liveness answer different questions. Readiness keeps traffic away from a web pod that can't reach Valkey; liveness restarts a container that is stuck. Liveness checks only the container itself, so an outage elsewhere doesn't restart healthy pods. The runner's endpoint catches a hung loop, which no probe would, more simply than a file-based command probe.

**Sources:** [Liveness, readiness and startup probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) (checked November 2026).

## D30 — CPU requests without limits

**Decision:** Each container requests 50m of CPU (a twentieth of a core) and has no CPU limit.

**Alternatives:** Requests and limits, for example 50m requested and at most 500m.

**Why:** The containers mostly wait on the network, so they are very unlikely to use up the node's CPU. The request makes sure the scheduler can place every pod and, should the node ever run short of CPU, gives each container the same share. Without a limit, a container can use spare CPU freely and is never throttled while the node is idle.

**Sources:** [Resource management for pods and containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) (checked November 2026).

## D31 — The runner writes whole messages

**Decision:** The runner waits until a model has finished its message, then writes the whole message to the Session's stream as one event. It asks the model for the next message as soon as the previous one is written, so generating overlaps with the browser revealing it.

**Alternatives:** Fragments: forwarding the model's output in pieces of about five tokens while it is being generated. This was the earlier plan, agreed in October 2026 but not recorded as a decision. Its reason was that text starts appearing about a second after the model starts, with no wait for the whole message.

**Why:** A message is either in the stream in full or not at all, since one write can't be half done. That keeps resuming after a crash (Phase 2, D22) simple: with fragments, a message cut off midway could only be left unfinished or withdrawn and regenerated, because continuing a partial answer (prefill) is supported by fewer and fewer models. Whole messages also need no streaming from the provider, make the events simpler, let the runner check a message for the Secret before anyone sees it, and give a viewer who joins mid-message the whole message at once. Cost: before each message, the model's full generation time instead of its time to the first word. Mostly that is hidden behind revealing the previous message, but after a short message it shows as a pause; how the pacing evens this out is to be tuned in trial runs.

**Sources:** [OpenRouter API reference (assistant prefill)](https://openrouter.ai/docs/api-reference/overview.md), [Anthropic migration guide (prefill not supported on newer models)](https://platform.claude.com/docs/en/about-claude/models/migration-guide.md) (checked November 2026).

## D32 — A local image registry, set up with ctlptl

*The cluster is now k3d instead of kind (D36); the registry stays as decided here.*

**Decision:** The local kind cluster is created with ctlptl together with a local image registry. Tilt pushes built images to the registry, and the cluster pulls them from there.

**Alternatives:** Plain kind, with Tilt copying each built image into the cluster (`kind load`).

**Why:** Pushing to a registry moves only the image layers that changed, so rebuilds reach the cluster faster; Tilt's own docs recommend it for kind. It also matches production, where the cluster pulls its images from a registry. Cost: ctlptl, a small tool from the Tilt team, is one more prerequisite.

**Sources:** [Tilt: choosing a local dev cluster](https://docs.tilt.dev/choosing_clusters.html), [ctlptl](https://github.com/tilt-dev/ctlptl) (checked November 2026).

## D33 — The local cluster runs the same Kubernetes minor version as k3s

*Superseded by D36.*

**Decision:** The kind node image is pinned to the Kubernetes minor version of k3s's stable channel, currently 1.36, and updated together with it.

**Alternatives:** Leave the version to kind's default, which changes with each kind release, so two developers with different kind versions get different clusters.

**Why:** Development and production stay alike: a manifest that works locally works on the k3s cluster of Phase 3. Pinning also means everyone who clones the repo gets the same cluster. The patch versions may differ slightly, since kind and k3s publish builds separately.

**Sources:** [kind releases](https://github.com/kubernetes-sigs/kind/releases), [k3s v1.37.X release notes (stable channel at v1.36.3)](https://docs.k3s.io/release-notes/v1.37.X) (checked November 2026).

## D34 — One node locally

**Decision:** The local cluster has a single node.

**Alternatives:** A control-plane node plus worker nodes, to show pods being spread across machines.

**Why:** Phase 3 runs on a single VM, so one node matches production, and it is the simplest and lightest setup. Showing multi-node scheduling is not a goal of the project.

## D35 — A dedicated namespace

**Decision:** All of the exhibition's objects live in their own namespace, `exhibition`.

**Alternatives:** The `default` namespace.

**Why:** Control: everything the exhibition runs is listed and can be removed together, apart from anything else in the cluster. Phase 2's permissions for the session controller will also be granted per namespace.

## D36 — k3d for the local cluster, running the same k3s release as production

**Decision:** The local cluster runs k3s inside Docker with k3d, created by ctlptl together with the local registry (D32). The k3s image is pinned to the release on k3s's stable channel, currently `v1.37.2+k3s1`, and updated together with it. This replaces D7 (kind) and D33 (kind's node image matched to k3s's minor version).

**Alternatives:** Keep kind with its node image pinned to k3s's minor version (D7, D33).

**Why:** Development runs the same software as production (k3s, D6), not only the same Kubernetes version. k3s's built-in parts, such as its load balancer, its storage class and Traefik, behave the same locally as on the Phase 3 VM. Cost: k3d is a community project with sparse releases (v5.8.3 in February 2025, then v5.9.0 in June 2026), while kind is run by Kubernetes' own testing group.

**Sources:** [k3d releases](https://github.com/k3d-io/k3d/releases), [k3s release channels](https://update.k3s.io/v1-release/channels), [ctlptl's k3d support](https://github.com/tilt-dev/ctlptl/blob/main/pkg/cluster/admin_k3d.go) (checked November 2026).

## D37 — The API key reaches the runner as a mounted file

**Decision:** The runner gets the API key from the `llm-api` Secret mounted as a file, read once at startup, not as an environment variable.

**Alternatives:** An environment variable filled from the Secret (`secretKeyRef`).

**Why:** Environment variables leak easily: code that logs or reports the whole environment includes them, and child processes inherit them. A file is read only by code that asks for it by path, and can be made readable by its owner only. Cost: a volume and a mount in the manifest, and a couple of lines to read the file. Neither way picks up a changed key without a restart, since the runner reads the file only at startup.

**Sources:** [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html), which notes that environment variables "may be included in logs or system dumps" (checked November 2026).

## D38 — k3s's built-in Traefik stays on in Phase 1

**Decision:** The local cluster keeps k3s's default add-ons, including Traefik, although nothing routes through it until Phase 2 (D5).

**Alternatives:** Turn Traefik off with a k3s option in `cluster.yaml` until Phase 2.

**Why:** The local cluster stays a default k3s install, like production (D36), and Phase 2 needs no change to `cluster.yaml`. The cost is small: Traefik used about 24 MiB of memory in the fresh cluster.

## D39 — Images are pinned by version tag only, for now

**Decision:** Every image is referenced by an exact version tag, such as `valkey/valkey:9.1.3-alpine` or `rancher/k3s:v1.37.2-k3s1`, without a digest (`@sha256:…`). Later, digests are added and kept up to date by a bot that opens pull requests (roadmap, Phase 4).

**Alternatives:** A tag plus a digest, updated by a bot such as Renovate or Dependabot; a tag with `imagePullPolicy: Always`, so every pod start checks the registry.

**Why:** It keeps the initial setup simple. Tags alone give neither exact images nor automatic updates: a tag can point at different bytes after a maintainer rebuilds it, and a node never pulls a tag it already has again, so rebuilds only arrive on a fresh node or cluster. Digests with a bot fix both, with every update arriving as a reviewable commit, but need the bot set up first. `Always` would make each pod start depend on reaching the registry.

## D40 — Valkey refuses writes before reaching its memory limit

**Decision:** Valkey runs with `maxmemory 48mb` and `maxmemory-policy noeviction`, below the container's 64 MiB limit (D26).

**Alternatives:** No `maxmemory`, so the kernel kills Valkey at the container limit; `maxmemory` with an eviction policy, which deletes keys to make room.

**Why:** If data ever grows that far, which needs a bug since the expected data is about 1 MB, Valkey stays up and answers writes with an error that shows in the runner's and web server's logs. That's easy to notice and diagnose. Being killed would instead restart Valkey into the same full state, and evicting could delete keys the app relies on, such as the day's spend count (D11). The 16 MiB between the two limits leaves room for what `maxmemory` doesn't count, such as connection buffers and the copy of the process that rewrites the append-only file.

**Sources:** [Valkey: key eviction](https://valkey.io/topics/lru-cache/) (checked November 2026).

## D41 — Valkey's volume is 256 MiB

**Decision:** Valkey's volume claim asks for 256 MiB.

**Alternatives:** 1 GiB.

**Why:** It fits what Valkey writes: the append-only file grows to about 64 MB before its first rewrite, plus room for the rewrite's new file. It keeps the footprint small. k3s's `local-path` storage doesn't enforce the size, so it records what we expect rather than limiting anything.

## D42 — A NetworkPolicy lets only web and runner reach Valkey

**Decision:** A NetworkPolicy allows connections to Valkey's pod only from the web and runner pods, on port 6379. All other incoming traffic to Valkey is refused.

**Alternatives:** No restriction, so any pod in the cluster can connect.

**Why:** Valkey holds the Session streams, Secrets included, and the spend count. The NetworkPolicy keeps other pods in the cluster, such as Traefik from Phase 2, away from it. It's also one of the things this project means to show: control over the network between components. k3s enforces NetworkPolicies with its built-in controller, both locally and in Phase 3.

**Sources:** [Kubernetes: NetworkPolicies](https://kubernetes.io/docs/concepts/services-networking/network-policies/), [k3s: network options](https://docs.k3s.io/networking/basic-network-options) (checked November 2026).

## D43 — Valkey's image is the Alpine variant

**Decision:** Valkey runs from `valkey/valkey:9.1.3-alpine`.

**Alternatives:** The Debian-based `valkey/valkey:9.1.3`.

**Why:** It is light (45 MB against Debian's 118 MB) and has the essential tools, such as `ps`, `top`, `vi` and `nc`. For anything more, `kubectl debug` can attach a temporary container with other tools to the running pod.

**Sources:** [the official image's Dockerfiles](https://github.com/valkey-io/valkey-container/tree/mainline/9.1), [Kubernetes: debugging with ephemeral containers](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/#ephemeral-container) (checked November 2026).

## D44 — Valkey's probe timing

**Decision:** Valkey's readiness probe runs every 2 seconds. Its liveness probe uses Kubernetes' defaults: every 10 seconds, a 1-second timeout, and a restart after 3 failures in a row.

**Alternatives:** Kubernetes' defaults for both; Bitnami's Valkey chart values (every 5 seconds, 5 failures, a 20-second wait before the first probe).

**Why:** After a restart, Valkey counts as ready again within about 2 seconds, so the web pods get back up fast. Liveness stays tolerant, so a short hiccup doesn't restart Valkey.

**Sources:** [Kubernetes: probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/), [Bitnami's Valkey chart defaults](https://github.com/bitnami/charts/blob/main/bitnami/valkey/values.yaml) (checked November 2026).

## D45 — ConfigMaps come from Kustomize's configMapGenerator

**Decision:** Every ConfigMap in our manifests is generated with Kustomize's `configMapGenerator`, from a plain file or from literal values in the `kustomization.yaml`. Valkey's settings are the first: a `valkey.conf` file next to its manifests.

**Alternatives:** For Valkey, its settings as command-line arguments in the StatefulSet. In general, ConfigMaps written by hand.

**Why:** Kustomize adds a hash of the contents to the generated ConfigMap's name. A change gives a new name, which changes the pod template of whatever uses it, so those pods restart with the new settings without anyone remembering to do it. Using it for every ConfigMap keeps them all consistent.

**Watch out:** The hash only reaches objects Kustomize builds. Anything created at runtime, such as Phase 2's Jobs, can't know the hashed name, and needs another way.

**Sources:** [Kustomize: configMapGenerator](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/configmapgenerator/) (checked November 2026).

## D46 — Each component has its own Valkey user

**Decision:** Valkey's anonymous default user is turned off. The runner and the web server each log in as their own Valkey user, allowed only the commands and keys that component needs. A third user, allowed only `PING`, serves the health checks. This adds to the NetworkPolicy (D42).

**Alternatives:** The NetworkPolicy alone; one shared password for both components.

**Why:** Each component that acts on Valkey has only its own permissions, so it can't do just anything. A taken-over web pod, for example, could read Session streams but not write fake Session events or change the spend count. A shared password wouldn't give that, since both components would hold it. The cost is keeping each user's permissions in step with what its component's code does; tests that run the components against a real Valkey with the same user list catch any mismatch.

**Sources:** [Valkey ACLs](https://valkey.io/topics/acl/) (checked November 2026).

## D47 — Structured logs to stdout in Phase 1, metrics later

**Decision:** In Phase 1, every component writes its logs as JSON lines to stdout, one object per line with fields such as `time`, `level`, `component`, `slot`, `sessionId` and `msg`. Metrics and dashboards come in a later phase.

**Alternatives:** Plain text logs; a metrics and dashboard stack already in Phase 1.

**Why:** Observability grows step by step with the phases, so the project ends up close to how production systems are run without delaying Phase 1. stdout is where Kubernetes collects container logs: `kubectl logs` and Tilt show them, and any log collector added later reads them from there. JSON lines can be searched and filtered by field.

**Sources:** [Kubernetes: logging architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/) (checked November 2026).

## D48 — The API key's Secret keeps a fixed name

**Decision:** The API key's Secret stays as D27 makes it, with the fixed name `llm-api`; it is not generated with Kustomize's `secretGenerator`. After changing the key in `.env`, the runner is restarted by hand, as the README says.

**Alternatives:** `secretGenerator`, which adds a hash of the contents to the Secret's name, so a changed key restarts the runner by itself, consistent with D45 for ConfigMaps.

**Why:** It keeps things simple, and the key changes rarely. `secretGenerator` would need `.env` moved into the local overlay's folder or Kustomize's file-loading restriction turned off (D27), and each key change would leave the previous Secret, with the old key in it, in the cluster until cleaned up.

## D49 — Fixed Valkey passwords for development, in the repo

**Decision:** The Valkey users' passwords for the local cluster are fixed values committed in `deploy/overlays/local/`. Production provides its own (Phase 3).

**Alternatives:** Passwords typed into `.env`; passwords generated by the Tiltfile into a git-ignored file.

**Why:** Simplicity: no code and no setup, and production needs a different mechanism anyway. The passwords are public, which is harmless for a cluster reachable only from the developer's machine. They can't leak into production: the base has no passwords, the production overlay doesn't include the local one, so a missing production Secret stops the pods instead of falling back, and the Tiltfile only deploys to `k3d-exhibition`. A comment next to them says they're for development only, since passwords in git can look careless to a reader.

## D50 — Valkey's user list is assembled from permissions and passwords at start-up

**Decision:** The Valkey users' permissions are a committed template, `deploy/base/valkey/users.acl`, turned into a ConfigMap (D45), with a placeholder for each password. The passwords are a separate Secret, `valkey-passwords`. When Valkey's container starts, a short shell script fills the passwords into the template, writes the complete user list to a file only Valkey can read, and starts Valkey with it.

**Alternatives:** The whole user list, passwords included, in one Secret, which would put the permissions outside the normal manifests; the list in the ConfigMap with SHA-256 hashes of the passwords, which something would have to compute.

**Why:** The permissions are visible in git and identical in development and production. Nothing has to compute hashes. Development and production differ only in where the `valkey-passwords` Secret comes from (D49 locally, Phase 3's mechanism in production). The runner and web pods each mount only their own password from that Secret.

**Sources:** [Valkey ACLs](https://valkey.io/topics/acl/) (checked November 2026).

## D51 — The local Valkey passwords are a plain Secret manifest

**Decision:** The local `valkey-passwords` Secret (D49) is a plain Secret manifest in `deploy/overlays/local/`, with a fixed name. After changing a password, Valkey, the runner and the web server are restarted by hand.

**Alternatives:** Kustomize's `secretGenerator` from a committed file, which adds a hash of the contents to the name, so a change restarts them by themselves (as D45 does for ConfigMaps).

**Why:** Consistent with the API key's Secret (D48), and simpler in this case: easier to read and less setup. The passwords will most likely never change.

## D52 — Containers run as their images set them up, not hardened

**Decision:** Containers run with their images' own user setup and Kubernetes' default security settings. Valkey's container, for example, starts as root and switches to the `valkey` user itself.

**Alternatives:** Kubernetes' "restricted" Pod Security Standard: every container runs as a non-root user from the start and can never become root, gets no extra Linux privileges (capabilities), has a read-only file system apart from its mounts, and gets no Kubernetes API credentials unless it needs them.

**Why:** Simplicity. The hardened settings exist and would leave much less to work with for anyone who takes over a container, at about ten lines per component; we acknowledge them and leave them out for now.

**Sources:** [Kubernetes: Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) (checked November 2026).

## D53 — Bun is installed on the developer's machine

**Decision:** Bun is a local prerequisite, listed in the README. Installing packages, running tests and type checking happen on the developer's machine; Tilt still builds the images for the cluster.

**Alternatives:** Bun only inside Docker containers, with every command run through `docker run`.

**Why:** Although it needs installing, it is faster and simpler, with fewer moving parts: running Bun in Docker would put every command behind `docker run`, slow down file access through a folder shared into the container (on Windows especially, with the thousands of small files in `node_modules`), and make tests that start their own containers pass Docker into the container.

**Sources:** [Installing Bun](https://bun.com/docs/installation) (checked November 2026).

## D54 — Bun is pinned to an exact version

**Decision:** Bun is pinned to exactly `1.4.4`, the latest release (22 October 2026), in `package.json` and in the images' tags, and both are updated together.

**Alternatives:** Allowing any `1.x` release.

**Why:** Automatic updates can break things unexpectedly: Bun fixes only its newest release, and upgrades inside 1.x have occasionally changed behaviour (D15). With an exact pin, an update happens only on purpose, and the dependency bot planned for Phase 4 (D39) can propose updates as pull requests.

**Sources:** [Bun releases](https://github.com/oven-sh/bun/releases) (checked November 2026).

## D55 — Events sent to the browser are `SseEvent`s, and keep the slot of `session-start`

**Decision:** The type of what the browser receives over SSE (architecture §4.3) is named `SseEvent`. It tags each Session event with its slot, so a `session-start` carries the same slot twice: its own and the tag.

**Alternatives:** Removing `slot` from `session-start`, since `slot:{n}` already says which Session runs in which slot. For the name: `PageEvent` (the earlier name), `BrowserEvent`, `ViewerEvent`.

**Why:** Keeping the slot in `session-start` means the stream itself says where its Session ran, without looking up the slot–Session correspondence in Valkey. The name says where the type is used: on the SSE channel.

## D56 — The runner's image is the Alpine variant

**Decision:** The runner runs from `oven/bun:1.4.4-alpine`.

**Alternatives:** `oven/bun:1.4.4-slim` (Debian without extras), `-distroless` (no shell).

**Why:** The smaller image, the main reason for Valkey's Alpine image too (D43): 58 MB compressed against slim's 85 MB, so less to download on every update. No real downside showed for this component. Alpine uses musl instead of glibc as its C library, which matters for npm packages with prebuilt native binaries, for musl's older DNS resolver (no TCP fallback before musl 1.2.4, 2023) and for musl's slower memory allocator. None applies here: the runner is plain TypeScript without native add-ons, Bun publishes its own musl build, and it brings its own allocator. If something odd shows up anyway, switching to slim is one line.

**Sources:** [oven/bun tags on Docker Hub](https://hub.docker.com/r/oven/bun/tags), [musl 1.2.4 release notes](https://musl.libc.org/releases.html) (checked November 2026).

## D57 — A NetworkPolicy limits the runner's traffic

**Decision:** The runner's pod accepts no incoming connections from other pods, and may connect out only to the cluster's DNS, to Valkey on port 6379, and to port 443 on any address outside the reserved ranges: the private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`, where cloud metadata services live) and carrier-grade NAT (`100.64.0.0/10`). The cluster's pods (`10.42.0.0/16`) and Services (`10.43.0.0/16`) fall inside `10.0.0.0/8`.

The kubelet's probes still get in: Kubernetes lets traffic from a pod's own node through, whatever the policy says. That depends on the network plugin; tested on k3s.

**Alternatives:** No NetworkPolicy for the runner in Phase 1, leaving D42's policy on Valkey as the only one. Later: a network plugin with name-based policies, such as Cilium, which could allow only `openrouter.ai`. Not for Phase 1, since it means replacing k3s's network plugin.

**Why:** It's a cheap way to limit traffic to what is actually required: one manifest, checked once in the cluster. The reserved ranges are where harm could be done by a wrong `LLM_BASE_URL` or a compromised dependency: the Kubernetes API, other pods, the home network and a cloud metadata service. The public internet has to be open anyway, since a NetworkPolicy matches addresses, not names, and the provider's addresses change.

**Watch out:** S5.2 allows a local provider, but a model server on the local network has a private address and would need a rule of its own.

**Sources:** [Kubernetes: NetworkPolicies](https://kubernetes.io/docs/concepts/services-networking/network-policies/), [IANA special-purpose address registry](https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml) (checked November 2026).

## D58 — The runner owns the slot count

**Decision:** The number of slots is a runner setting only. At start-up the runner writes it to Valkey, in the key `slot-count`; the web server reads it there and passes it to the page. The page ignores slots it doesn't know and shows missing ones as offline.

**Alternatives:** `SLOTS` as a shared setting, read by the runner and the web server separately (the earlier design); the web server showing whatever slots exist in Valkey.

**Why:** With a shared setting, the two sides can disagree: a change restarts both, but not at the same moment, and open pages keep the old number until they're reloaded. One writer makes Valkey the only source, and a page that tolerates unknown and missing slots makes the brief overlap during restarts harmless. Showing whatever slots exist doesn't work, because `slot:{n}` hashes are permanent, so slots removed from the count would still show.

## D59 — Running out of prepaid credit puts the machine to sleep

**Decision:** When the provider refuses a call because the account's prepaid credit is spent (OpenRouter's `limit_source` `openrouter_credits`), the runner does what it does for the key's daily limit (S6.2): the Session ends as sleeping, and every slot sleeps until midnight UTC.

**Alternatives:** Treating it as an ordinary failure, retried and then ended as interrupted.

**Why:** Retrying can't succeed until someone tops up the credit, so it's the same situation as the key limit.

## D60 — The game's phrase is the Codeword

**Decision:** The phrase the Pretender hides and the Explorer looks for is called the **Codeword**, everywhere: code, docs, the glossary and the prompts' placeholder. "Secret" is kept only for its technical meanings, such as Kubernetes Secrets and the API key.

**Alternatives:** Keeping "Secret".

**Why:** "Secret" clashes with Kubernetes Secrets and `.env` secrets, which the runner's doc discusses alongside it.
