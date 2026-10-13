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
