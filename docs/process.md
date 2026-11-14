# How the project is built

## Documents

Each document answers one question, and each is written before the next:

1. **Description** (`docs/description.md`, once): what the project is and why. Written by the author.
2. **Spec** (`docs/phase-N/spec.md`, per phase): what must be true when the phase is done. Numbered, testable requirements seen from outside; no internals.
3. **Architecture** (`docs/phase-N/architecture.md`, per phase): the components, the contracts between them, the lifecycle of one Session, and the layout of the Kubernetes manifests.
4. **Component docs** (`docs/phase-N/components/<name>.md`, per component): internals, configuration, failure behaviour, and how to run and test the component alone. Written just before the component's code.

Decisions are recorded project-wide in `docs/decisions.md`.

## Phase 1 commit order

1. Description, roadmap and README
2. Decision log
3. Spec
4. Architecture
5. Dev environment: kind config, a minimal Tiltfile, README setup steps
6. For each component: its doc, then its code
7. Tilt setup and README polish, including what the project demonstrates and how to try it, and why Kubernetes: control over the network between components, over resource use, and over how updates and restarts happen; desired state kept in git; self-healing; components finding each other by name; the same manifests locally and in the cloud; and, plainly, that an app this small doesn't need Kubernetes and it is here to learn and show it
8. Tag `phase-1`

Each commit has one clear purpose and is small enough to review in full.
