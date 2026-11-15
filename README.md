# Explorer & Pretender

Two LLMs in a closed room: the Explorer searches for the Secret, the Pretender hides the Secret within. Visitors watch, live.

This is a learning project by Joonatan Partanen.

**Status:** Phase 1 in progress — see the [roadmap](ROADMAP.md).

- [Description](docs/description.md)
- [Glossary](docs/glossary.md)
- [Decisions](docs/decisions.md)
- [Phase 1 spec](docs/phase-1/spec.md) and [architecture](docs/phase-1/architecture.md)

## Running it locally

The exhibition runs on a local Kubernetes cluster (k3s, run inside Docker by k3d), with Tilt building and deploying it.

### Prerequisites

- [Docker Desktop](https://docs.docker.com/desktop/), the engine the cluster runs on
- [k3d](https://k3d.io/#installation) v5.9.0 or later, which runs the cluster's k3s node in Docker
- [ctlptl](https://github.com/tilt-dev/ctlptl#how-do-i-install-it), which creates the cluster and its image registry
- [Tilt](https://docs.tilt.dev/install.html)
- An [OpenRouter](https://openrouter.ai/) API key, created with a daily limit 10% above the exhibition's $2 daily cap

### Steps

1. Copy `.env.example` to `.env` and put your API key in it. `.env` is never committed.
2. Create the cluster and its registry:

   ```
   ctlptl apply -f cluster.yaml
   ```

3. Start everything:

   ```
   tilt up
   ```

   Tilt's dashboard opens in the browser and shows each component's status and logs.

To remove the cluster and the registry again: `ctlptl delete -f cluster.yaml`.
