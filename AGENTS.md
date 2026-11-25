# Working on this repository

Ground rules for AI assistants working on Explorer & Pretender.

## Always

- **Push back** when something seems wrong, and say honestly how strong the argument is. That includes the weak points of an option the author is about to choose: name them before the decision is recorded, not after.
- **This is a learning project.** The author is learning Kubernetes and infrastructure through it. When a concept comes up, briefly explain what it is and why it matters. Answer the author's questions in chat, briefly, with details only when asked.
- **State things explicitly** instead of implying them, in chat, code and docs.
- **Check current sources** for tool and technology choices, and cite them.

## Decisions

- **The author makes the decisions that are costly to undo or part of the learning goal.** These are:
  - architecture: components, the contracts between them, and the stack;
  - the Explorer's and the Pretender's prompts;
  - Kubernetes and infrastructure choices, even small ones (probes, resource limits, RBAC, Jobs).

  For these, give options and the material needed to decide between them, marked **Decision needed**. For architecture, the stack and the prompts, give no recommendation unless asked. For small Kubernetes and infrastructure choices, recommend a default the author can accept with "ok" or replace. Gather a component's decisions up front in one short table; give the deeper material only when the author asks for it.
- **Record a decision** in `docs/decisions.md` only once the author has made it and given their reasoning; ask for the reasoning if it's missing. The entry's **Why** is the author's reasoning, backed by facts from the material presented. Decision entries are committed without a separate review, since they only record what the author decided, and go out with the next push.
- **Decide the rest yourself and write it down.** Component internals and other app details: choose, and explain the choice in the component doc so the author can read through it and object. Mark **Decision needed** only where there is a real trade-off.
- **Follow `docs/decisions.md`.** If the implementation needs to deviate from a decision, stop and raise it; never deviate silently.

## Making a change

- **Test first.** Before changing behaviour, in code or in configuration, write down what it must do, add or change the tests to match and see them fail; then make the change that turns them green. A new test for behaviour that already works passes at once, so break that behaviour on purpose once to see that the test can fail.
- **Tests check behaviour at the boundaries, not the implementation.** No change detectors: a refactor that keeps the behaviour keeps the tests green.
- **Names make sense where they're read,** without looking up their definition:
  - every number carries its unit, in code, environment variables and config alike (`costDollars`, `INTERMISSION_SECONDS`); keep a value in its unit until the point of use, and convert there;
  - a function says what it does, side effects included (`stopIfNobodyPresent`, not `checkPresence`); a yes/no value reads as a question (`wasCutOff`);
  - how explicit a name must be depends on its scope: the bigger the scope, and the more similar things in it, the more the name must say which one (`valkeyClient` where there's also a model client), while a short helper such as `ValkeyStore.addSpend`, four lines long, can call its result `totalDollars` rather than `totalSpendForTodayDollars`;
  - generic words can take a local meaning, but the project's own terms (Session, Codeword, slot, intermission) keep theirs;
  - don't repeat what the context already says: a method on a runner is `runner.isAlive()`, not `runner.isRunnerAlive()`;
  - prefer common, explicit words over coined ones (`fake`, not `stand-in`).
- **Log errors with their stack at top-level catches,** so a failure can be traced from the logs alone.

## Review

- **Commit locally, push after review.** Each review round is committed locally, in one or more commits, and revisions go on top as new commits, so the author can see any round's or revision's changes on their own in VS Code or GitLens. Never push before the author has reviewed what's pushed. Before pushing, tidy the commits so each has one clear purpose and is small enough to read in full, and show the author the final list. Review a component's doc and code together, in one round, once both are written and tested.
- **One concern per round where it makes sense,** small enough to review in one session: keep renames apart from behaviour changes, so a behaviour change doesn't drown in a large diff, and hand each part over once it has settled. Use judgement: a small fix that belongs with the round's concern can come along.
- **Check before handing over.** Settle what the rules and tools can settle, so a review holds only judgement calls. Fix what the checks find before handing over.
  - **Every round:** run `bun run check:all` (tests, type check, Biome, link check), then two reviews: a correctness review (`/code-review`) and a docs-against-code pass (a subagent reads the docs, the code and config, and this file, and reports mismatches and broken rules).
  - **At the end of a component or another bigger whole:** first `/simplify`, committed on its own so its edits can be reviewed apart; then `/code-review`, the docs-against-code pass and `/security-review`.
- **Guide each review in a file,** `.review/round-<n>.md` (kept out of git). Each item has a checkbox and room for the author's notes. Say what the author prescribed and what you chose yourself. For each item, give the right amount of context: what it is, where it is (a link to the file and line), and what's proposed and why, in one to three sentences, more only for a real judgement call. Read the author's notes back before the next round: they say what to change and what's unclear. On trial: give the main items with links in the chat too, until it's clear which works better.

## Docs

- **Docs describe this project.** A component doc records our setup, choices and their consequences, and why. Explain how a tool works inside only where a choice depends on it.
- **Don't restate values** that can be read in code or config: copies go stale.
- **Define a term in a doc before using it,** unless it's common or in the [glossary](docs/glossary.md); link to the glossary.
- **Keep cross-references up to date.** A reference to a section of another file is a Markdown link, and the link check validates heading anchors, so a renamed section fails the check instead of silently breaking a link.
- **Don't edit files the human author wrote,** such as `docs/description.md`. Their frontmatter says so: `written-by: the human author`.
