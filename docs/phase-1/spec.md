# Phase 1 — Spec

What must be true when Phase 1 is done. Each requirement can be checked from the outside; how it's built belongs in the architecture doc. **Decision needed** marks a choice that is still open.

**Scope:** the whole exhibition runs on a local Kubernetes cluster on the developer's machine. Routing, Sessions as Jobs and public hosting come in later phases.

## 1. Getting it running

- **S1.1** From a fresh clone, with the prerequisites installed, the exhibition is running and viewable in a browser after at most two commands.
- **S1.2** The README lists the prerequisites and the exact steps from clone to running exhibition, including where the LLM API key goes.
- **S1.3** The API key is read from a local `.env` file, which is never committed.

## 2. Sessions

- **S2.1** There are 3 slots. Each slot shows at most one Session at a time.
- **S2.2** A Session alternates messages: the Explorer writes, the Pretender answers as a terminal would. The Explorer goes first. One Explorer message plus the Pretender's answer is one exchange.
- **S2.3** *Found:* the Session ends when an Explorer message contains the Secret exactly as given.
- **S2.4** *Ran its course:* the Session ends after 15 exchanges without the Secret being found.
- **S2.5** *Interrupted:* if the model provider keeps failing, the Session ends as interrupted.
- **S2.6** A slot starts a new Session only when someone is watching it (S4.4). If it isn't already running, a Session starts anew.
- **S2.7** If nobody watches a running Session for 30 seconds, it stops.
- **S2.8** After a Session ends, the slot pauses (10 seconds) before starting the next one, if anyone is still watching.
- **S2.9** A finished Session can't be viewed again.

## 3. The Secret

- **S3.1** Each Session gets a new Secret of the form adjective-noun-verb-adverb, e.g. `velvet-otter-hums-quietly`.
- **S3.2** Secrets contain no offensive words.
- **S3.3** Only the Pretender is given the Secret.
- **S3.4** Viewers see the instructions given to the Explorer at the start of each Session, and never those given to the Pretender.
- **S3.5** The exhibition never reveals the Secret itself. Viewers see it only if it appears in the Session.

## 4. Viewing

**The carousel**

- **S4.1** The slots sit in a row that scrolls horizontally and loops seamlessly. Exactly one slot is in focus at a time.
- **S4.2** When scrolling stops, the row snaps to the nearest slot. Arrow keys move one slot at a time.
- **S4.3** Neighbouring slots show only as a very subtle sliver at the edges. Nothing tells how many slots there are; only comparing their contents reveals it.
- **S4.4** A viewer is watching a slot when it is in focus in an active browser tab.
- **S4.5** A new visitor lands on an idle slot if there is one.
- **S4.6** An idle slot shows that it is waiting for someone to watch.

**Watching a Session**

- **S4.7** Viewing is read-only: nothing a viewer does reaches a Session.
- **S4.8** A viewer who joins a running Session sees only the messages that arrived since they joined.
- **S4.9** While the tab is in the background, the Session keeps appearing at its normal pace, and the 30-second limit (S2.7) runs meanwhile. A returning viewer's view stays where they left it; they can scroll down to the latest text.
- **S4.10** Text appears one character at a time at a steady rate: about 30 characters per second for the Explorer and about 120 for the Pretender.
- **S4.11** The display never hurries or catches up.
- **S4.12** A short connection drop resumes without missing or repeating characters.
- **S4.13** Viewers can scroll back through what they have seen. While scrolled up, new text doesn't pull the view down.
- **S4.14** The chat area fades out at its top or bottom edge only when there is more content beyond that edge. Scrolled fully to the top or bottom, that edge shows the message box's sharp border, with no fade.

**Endings**

- **S4.15** *Found:* as the Explorer types the Secret, it shimmers gold, the shimmer growing with each character. In step, the same characters light up wherever the Secret appeared earlier in the Pretender's output. The shimmer stays as long as the Secret is on screen.
- **S4.16** *Ran its course* and *interrupted* are shown in a grey box, distinct from the message boxes, horizontally centred directly below the last message and scrolling with the chat. The box says why the Session ended: "This Session has run its course" or "This Session was unexpectedly interrupted".
- **S4.17** After the Secret is found, the shimmer lingers, then the slot fades to black in a few discrete steps, like old adventure games, before the next Session starts. The other two endings fade the same way, once the grey box has been readable for a moment.
- **S4.18** When the daily spend cap is reached, viewers see that the exhibition is resting until tomorrow.

## 5. Constraints

- **S5.1** The Explorer's and the Pretender's models are set in configuration, independently.
- **S5.2** Any provider with an OpenAI-compatible chat API, hosted or local, can be used by changing configuration only.
- **S5.3** Each message has a maximum length. The value is set after trial runs show normal message lengths.
- **S5.4** Both models see the full history of the Session's messages. Reasoning is not carried over between turns.

## 6. Cost limits

- **S6.1** Daily spend cap: $2. Once reached, no new Sessions start until the day resets at midnight UTC. Sessions already running finish.
- **S6.2** Spend counts the cost the provider reports for each call.
- **S6.3** The API key also has a daily limit at the provider, set slightly above the cap, as a backstop. Hitting it shows the same resting notice (S4.18).
- **S6.4** The provider account runs on prepaid credit without automatic top-up, so the balance is the absolute ceiling.
- **S6.5** The current day's spend shows in the logs.

## 7. Configuration

| Setting | Starting value |
|---|---|
| Slots | 3 |
| Turn cap | 15 exchanges |
| Pause between Sessions | 10 s |
| Time without viewers before a Session stops | 30 s |
| Reveal rate, Explorer / Pretender | 30 / 120 characters per second |
| Maximum message length | after trial runs |
| Daily spend cap | $2 |
| Models and endpoint | per provider |

## 8. Not in Phase 1

- A scripted stand-in model, so the exhibition runs without an API key (Phase 2)
- Routing through the Gateway API, Sessions as Jobs (Phase 2)
- Public hosting, domain, TLS (Phase 3)
- Recap for late joiners (parked in the roadmap's ideas)
- Viewing past Sessions
