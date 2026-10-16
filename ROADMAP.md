# Roadmap

## Phase 1 — Runs on local Kubernetes

- [ ] Explorer and Pretender hold a Session; it ends when the Explorer sounds out the Secret, or at a turn limit
- [ ] 3 slots in a looping horizontal carousel; a Session starts when someone watches its slot
- [ ] Sessions are viewable live in the browser
- [ ] Runner, web and Redis run as separate Deployments on a local cluster
- [ ] `tilt up` builds and starts everything, with live updates while developing

## Phase 2 — Sessions as Kubernetes Jobs

- [ ] Each Session runs as a Kubernetes Job
- [ ] A session controller creates the Jobs, with least-privilege RBAC
- [ ] Traffic enters through the Gateway API
- [ ] A scripted stand-in model runs the exhibition without an API key

## Phase 3 — Public, in the cloud

- [ ] Infrastructure defined with OpenTofu
- [ ] Self-managed k3s on a cloud VM
- [ ] Public website with a domain and TLS
- [ ] Rebuildable from scratch with documented commands
- [ ] More kinds of Pretender alongside the terminal, each quite different from the others: one is an open world (a single one), others still to be found. Each Session gets a kind at random, independently per slot, so all three slots may show the same kind

## Ideas, not promises

- New spectators see each Session from its start, replayed quickly and easing into live speed. This would make the experience slightly more interactive, which would detract from the mood of the exhibition.
