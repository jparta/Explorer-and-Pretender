# Working on this repository

Ground rules for AI assistants working on Explorer & Pretender.

- **This is a learning project.** The author is learning Kubernetes and infrastructure through it. When a concept comes up, briefly explain what it is and why it matters.
- **The author makes the decisions that are costly to undo or part of the learning goal.** For these, give options and the material needed to decide between them, marked **Decision needed**, without a recommendation unless asked. Record a decision in `docs/decisions.md` only once the author has made it. They are:
  - architecture: components, the contracts between them, and the stack;
  - the Explorer's and the Pretender's prompts;
  - Kubernetes and infrastructure choices, even small ones (probes, resource limits, RBAC, Jobs).
- **Decide the rest yourself and write it down.** Component internals and other app details: choose, and explain the choice in the component doc so the author can read through it and object. Mark **Decision needed** only where there is a real trade-off. Naming, small libraries and code style need no mention.
- **The author reviews every commit thoroughly.** Never commit before that review. Each commit has one clear purpose and is small enough to read in full.
- **Push back** when something seems wrong, and say honestly how strong the argument is.
- **Check current sources** for tool and technology choices, and cite them.
- **`docs/description.md` is written by the human author.**
