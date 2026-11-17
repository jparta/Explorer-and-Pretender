# Working on this repository

Ground rules for AI assistants working on Explorer & Pretender.

- **This is a learning project.** The author is learning Kubernetes and infrastructure through it. When a concept comes up, briefly explain what it is and why it matters.
- **The author makes the decisions that are costly to undo or part of the learning goal.** These are:
  - architecture: components, the contracts between them, and the stack;
  - the Explorer's and the Pretender's prompts;
  - Kubernetes and infrastructure choices, even small ones (probes, resource limits, RBAC, Jobs).

  For these, give options and the material needed to decide between them, marked **Decision needed**. For architecture, the stack and the prompts, give no recommendation unless asked. For small Kubernetes and infrastructure choices, recommend a default the author can accept with "ok" or replace. Gather a component's decisions up front in one short table; give the deeper material only when the author asks for it. Record a decision in `docs/decisions.md` only once the author has made it and given their reasoning; ask for the reasoning if it's missing. The entry's **Why** is the author's reasoning, backed by facts from the material presented. Decision entries are committed and pushed without a separate review, since they only record what the author decided.
- **Decide the rest yourself and write it down.** Component internals and other app details: choose, and explain the choice in the component doc so the author can read through it and object. Mark **Decision needed** only where there is a real trade-off. Naming, small libraries and code style need no mention.
- **Test first.** Before changing behaviour, in code or in configuration, write down what it must do, add or change the tests to match and see them fail; then make the change that turns them green. A new test for behaviour that already works passes at once, so break that behaviour on purpose once to see that the test can fail.
- **The author reviews every change set thoroughly.** Never commit before that review, apart from decision entries (above). Each commit has one clear purpose and is small enough to read in full.
- **Review a component's doc and code together,** in one round, once both are written and tested.
- **Guide each review.** List what changed since the author last looked, newest first, by file and section, with a line on what changed and why. Once the author has read a change, stage it (`git add`). When the author asks for revisions, `git diff` then shows only the revisions, not everything again, and `git diff --cached` shows what they already read. Commit only when the author says the review is done.
- **Docs describe this project.** A component doc records our setup, choices and their consequences. Explain how a tool works inside only where a choice depends on it; answer the author's other questions in chat, briefly, with details only when asked.
- **Push back** when something seems wrong, and say honestly how strong the argument is. That includes the weak points of an option the author is about to choose: name them before the decision is recorded, not after.
- **Check current sources** for tool and technology choices, and cite them.
- **`docs/description.md` is written by the human author.**
