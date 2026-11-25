# Shared package

`packages/shared` holds what the runner, the web server and the front end must agree on (D9): the event types, the Valkey key names and lifetimes, and the settings that more than one component reads. It is a TypeScript library, not a running component: nothing in the cluster runs it on its own, and it has no manifests.

The other workspaces import it as `@exhibition/shared`. Bun runs TypeScript directly, so the package has no build step: its `package.json` points straight at `src/index.ts`.

## 1. What's in it

| File | Holds | Used by |
|---|---|---|
| `src/events.ts` | The event types of architecture §4, as schemas, and the functions that turn an event into a stream entry and back | runner (writes), web (reads), front end (reads the SSE data) |
| `src/keys.ts` | The key names, expiry times and stream lengths of architecture §3, and the UTC date used in `spend:{date}` and `sleeping:{date}` | runner, web |
| `src/testing.ts` | For tests only: a throwaway Valkey container with the cluster's image and user list (§5). Needs Docker | the runner's and web server's tests, and `keys.test.ts` |
| `src/settings.ts` | The settings of spec §7 that more than one component reads, loaded from environment variables | runner, web |

## 2. Events

### 2.1 Checked when read, not trusted

Each event type is written once, as a [Zod](https://zod.dev/) schema. Zod derives the TypeScript type from the schema, so the type the compiler checks and the shape checked at runtime can't drift apart.

Whoever reads an event checks it against the schema before using it:

- **Why check at all:** only the runner can write events (D46), but the runner can still have a bug, and during a rolling update an old runner can briefly write events in a shape the new web server no longer expects. A check turns those into a clear log line instead of a broken page.
- **What happens to an event that fails:** the reader gets an error result, not an exception. The web server logs it, with the stream and entry ID, and skips the entry. A viewer then misses that one event but keeps the connection and everything after it.
- **Cost:** measured on a 2,000-character message, reading it back takes about 3 µs, of which the check is about half and parsing the JSON the other half. Sessions write a message every few seconds, so it doesn't matter.

### 2.2 How an event is stored in a stream

A Valkey stream entry is a list of field-value pairs. Each entry here has a single field, `event`, holding the whole event as JSON:

```
XADD session:9f2c * event {"type":"message","role":"explorer","text":"ls -la"}
```

One JSON field keeps nested and optional fields simple, such as `codeword` on a message, and the same text can go to the browser as the SSE `data:` unchanged. `toStreamFields` and `fromStreamFields` do the conversion, so the field name lives in one place.

### 2.3 Slot numbers

Slots are numbered from 0 (architecture §3). The schemas accept any whole number from 0 up; that a slot number is below the number of slots is checked where that setting is known.

## 3. Keys

Each key of architecture §3 has a constant or a small function that builds its name, such as `sessionKey(id)` → `session:9f2c`. Its lifetime or length limit sits next to it:

| Key | Lifetime or limit |
|---|---|
| `session:{id}` | Expires 60 s after the Session ends, or a day after it starts if its ending is never written (D68); at most 10,000 entries |
| `slots` | At most 1,000 entries |
| `presence` | Expires after the time without viewers setting (§4), 30 s to start with |
| `watching:{n}` | Expires 10 s after the last heartbeat |
| `spend:{date}`, `sleeping:{date}` | Expire after 2 days |

`presence` takes its lifetime from a setting; the others are constants. §4.1 says why.

**Checked against Valkey's user list.** Valkey's user list (`deploy/base/valkey/users.acl`, D46) must refuse what no component should do with these keys. A test starts a throwaway Valkey container from the cluster's image, loads the user list into it as the start-up script does, and asks Valkey itself with `ACL DRYRUN <user> <command> <key>`, which answers whether that command would be allowed without running it. Key patterns, command lists and rule order then count exactly as they do in the cluster.

The test checks only refusals, the security properties that should rarely change:

- neither component writes what belongs to the other;
- the web server can't read the spend;
- nobody touches keys outside the contract, or empties the store with `FLUSHALL`;
- the probe user can only ping.

It doesn't list what each component *may* do: that list would only repeat the user list, and fail on every change to it whether or not anything broke (a *change-detector test*). Instead, the runner's and web server's own tests run their real code against a real Valkey with their real users, so a missing permission shows as a feature that fails.

`utcDate()` gives today's date in UTC as `YYYY-MM-DD`, the `{date}` in `spend:{date}` and `sleeping:{date}` (architecture §8).

## 4. Settings

Only the settings that more than one component reads are here. The rest are settings of the component that uses them: the exchange cap and the daily spend cap, for example, are the runner's, set in its ConfigMap. (The day's spend so far is counted in Valkey, in `spend:{date}`; the cap it's compared against is the runner's setting.)

| Setting | Environment variable | Default | Read by |
|---|---|---|---|
| Time without viewers before a Session stops | `PRESENCE_TIMEOUT_SECONDS` | 30 | web (the `presence` key's expiry), and the runner: how long a presence check that fails with an error still counts as present |
| Reveal rate, Explorer | `REVEAL_RATE_EXPLORER_CHARS_PER_SECOND` | 30 characters per second | runner (pacing), front end (typing, through web) |
| Reveal rate, Pretender | `REVEAL_RATE_PRETENDER_CHARS_PER_SECOND` | 120 characters per second | the same |

The defaults are the spec's starting values. One ConfigMap, `settings`, generated in `deploy/base/kustomization.yaml` (D45), sets them as environment variables, and both components load it, so the values can't differ between them. The schema, `SharedEnvironment`, is exported too: a component extends it with its own settings and checks everything at once, so one error names every invalid variable, its own and the shared ones.

**The slot count isn't here,** though both sides need it: it's the runner's setting, and the web server learns it as the length of the slot states list in the `slots` stream (D65). Two components reading the same setting could disagree for a moment, since a change restarts them one after the other.

**An invalid value stops the component at start-up.** Each value must be a positive whole number. If one isn't, `loadSharedSettings` throws an error naming every invalid variable, the process exits, and the pod's restarts show in `kubectl get pods` with the error in its logs. Running with a wrong value instead, such as a reveal rate of 0, would fail later and less clearly.

### 4.1 Setting or constant

**A value is a setting** when it shapes what viewers experience and the author may want to tune it without touching code: after trial runs, or differently in another environment. These are the values the spec lists in its §7.

**Everything else is a constant,** written next to the code it belongs with, for one of three reasons:

- **It's tied to other code.** `watching:{n}` expires after 10 s because the page refreshes it every 5 s (`HEARTBEAT_INTERVAL_SECONDS`); the expiry must stay longer than the interval, with room for a late heartbeat. As two constants side by side, they can't be changed apart from each other by a ConfigMap edit.
- **It's a safety net, not behaviour.** The stream length limits only stop a runaway stream; nobody tunes them.
- **A decision fixed it.** The Session stream's 60 s expiry (D19), the daily keys' two days (architecture §8).

Each setting is one more value to check, document and keep in a ConfigMap, so a value becomes a setting only when tuning it is likely.

## 5. Running the checks

From the repository root:

```bash
bun install
```

```bash
bun test
```

```bash
bun run check:all
```

- **`bun run check:all`** runs every check in turn, stopping at the first that fails: the tests, the type check, Biome (D61) and the link check. Each can also be run on its own, as `bun test`, `bun run check`, `bun run lint` and `bun run check:links`.
- **`bun test`** runs every `*.test.ts` file in the repository. The user-list test (§3) needs Docker running; it starts its container and removes it again, in about two seconds. Starting that container is in `src/testing.ts`, which the runner's and web server's tests use too, imported as `@exhibition/shared/testing`.
- **`bun run check`** runs the TypeScript compiler without producing output (`tsc --noEmit`). Bun runs TypeScript by removing the types without checking them, so type errors show only here and in the editor.
- **`bun run lint`** runs Biome's linter (D61), which reports likely mistakes. Biome doesn't format the code. In test files the rule against `!` (telling TypeScript a value can't be missing) is off, since a wrong `!` there makes the test fail loudly anyway.

The tests cover:

- **events:** every event type survives a trip to a stream entry and back; a wrong shape, broken JSON or a missing `event` field comes back as an error result;
- **keys:** the date at either side of midnight UTC, and the user list (§3);
- **settings:** starting with no environment, values from the environment, unrelated variables ignored, each kind of invalid value refused, and one error naming every invalid variable.

## Sources

- [Zod](https://zod.dev/), version 4.6.7 (checked November 2026)
- [Bun: TypeScript](https://bun.com/docs/runtime/typescript), [Bun: workspaces](https://bun.com/docs/install/workspaces), [Bun: test runner](https://bun.com/docs/cli/test) (checked November 2026)
- [Valkey: streams](https://valkey.io/topics/streams-intro/) (checked November 2026)
