# Decisions

Project-wide decision log. Newest last. Each entry records what was decided, what else was considered, and why.

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

**Decision:** The runner appends each Session's events to a Valkey Stream of its own. The web server reads them from there. The stream is deleted when the Session ends, and a length limit guards against a runaway Session.

**Alternatives:** Pub/sub, which delivers each message to whoever is subscribed at that moment and stores nothing. D3 originally named pub/sub; this replaces it.

**Why:** A stream keeps events until it is deleted, so nothing is lost while a web server pod restarts or a viewer's connection drops: the browser reconnects with the ID of the last event it saw (SSE's `Last-Event-ID`) and reading resumes from there, on whichever pod answers. Gaps like that would look glitchy, and rolling updates make restarts routine. A viewer who joins mid-message can be shown that message from its start instead of mid-sentence. And keeping finished streams would make replaying Sessions from the beginning possible later. One Session's stream is roughly 120 KB, so storage is not a concern.

**Cost:** More code and concepts than pub/sub: entry IDs, blocking reads, trimming and deleting. Streams make smooth reconnects possible, not automatic; the web server and client still have to pass IDs along correctly. They do not help when the runner restarts: the Session itself is then interrupted.

**Sources:** [Valkey Streams introduction](https://valkey.io/topics/streams-intro/), [Server-sent events and `Last-Event-ID` (HTML standard)](https://html.spec.whatwg.org/multipage/server-sent-events.html) (checked November 2026).

## D20 — The web server serves the front end

**Decision:** Hono, in the web server, serves the front end's built files (D16) alongside the API and SSE.

**Alternatives:** A separate static file server (nginx or Caddy) in its own pod; a CDN or object storage.

**Why:** This is a small app, and it is much simpler without another server. The components stay the three of D3, the browser talks to a single address, so no routing or CORS is needed in Phase 1, and it fits Bun's dev server, which is built around the server serving the page. Cost: every front-end change replaces the web pod, which D19 makes harmless to viewers, and the front end and server cannot be deployed separately.
