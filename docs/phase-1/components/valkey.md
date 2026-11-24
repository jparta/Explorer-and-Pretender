# Valkey

Valkey is the store that the runner and the web server share (D3, D18). It holds every key in the architecture's Valkey contract (architecture §3): the Session streams, the `slots` stream, presence and watching keys, and the day's spend and sleeping marker. This component is only configuration and Kubernetes manifests: we run the official Valkey image and write no code for it.

## 1. What runs

| Object | Name | What it is for |
|---|---|---|
| StatefulSet | `valkey` | Runs one Valkey pod, `valkey-0`, from `valkey/valkey:9.1.3-alpine` (D43), and creates its volume (D28) |
| ConfigMap | `valkey-config-<hash>` | Valkey's settings (§2) and the users' permissions (§6), generated from `deploy/base/valkey/valkey.conf` and `users.acl` (D45) |
| Secret | `valkey-passwords` | The users' passwords (§6). Locally fixed values from `deploy/overlays/local/` (D49) |
| Service (headless) | `valkey` | Gives the pod a stable DNS name, `valkey`, on port 6379 |
| Volume claim | `data-valkey-0` | 256 MiB for the append-only file (D41). Created by the StatefulSet from its volume claim template, and kept when the pod restarts |
| NetworkPolicy | `valkey` | Lets only the web and runner pods connect, on port 6379 (D42) |

The manifests live in `deploy/base/valkey/` and are listed in `deploy/base/kustomization.yaml`.

**How the other components reach it:** at `valkey:6379`. Inside the `exhibition` namespace the short name `valkey` resolves through the cluster's DNS. Because the Service is *headless* (it has no virtual IP of its own), the name resolves straight to the pod's IP address. One consequence: while the pod isn't ready, the name doesn't resolve at all, so the runner and web server see a DNS error instead of a refused connection. Both retry either way (architecture §9).

**The NetworkPolicy** selects Valkey's pod by its label `app: valkey` and allows incoming connections only from pods labelled `app: web` or `app: runner`. Once a pod is selected by any NetworkPolicy, everything not allowed is refused. The probes aren't affected: the kubelet runs `valkey-cli` inside Valkey's own container, so they never cross the network.

## 2. Valkey's configuration

The settings are in `deploy/base/valkey/valkey.conf`, mounted into the container, and Valkey starts with `valkey-server /etc/valkey/valkey.conf`. Kustomize generates the ConfigMap from the file with a hash of its contents in the name, so editing the file restarts Valkey with the new settings (D45).

| Setting | Value | Why |
|---|---|---|
| `appendonly` | `yes` | Write every change to the append-only file (D23) |
| `appendfsync` | `everysec` | Flush the file to disk once a second, so a crash loses at most about a second of writes (D23). This is Valkey's default once `appendonly` is on; it's written out so the config says what D23 says |
| `save` | `""` (off) | Turns off the periodic snapshots (RDB), which Valkey takes by default. The append-only file already holds everything, and Valkey loads from it at start-up when it is on, so the snapshots would bring no benefit |
| `maxmemory` | `48mb` | Refuse writes before the container's 64 MiB limit is reached (D40) |
| `maxmemory-policy` | `noeviction` | At the limit, answer writes with an error instead of deleting keys (D40) |
| `aclfile` | `/tmp/users.acl` | The user list, assembled at start-up (§6.1) |
| `dir` | `/data` | Where the volume is mounted. The append-only files live in `/data/appendonlydir/` |

Everything else stays at Valkey's defaults.

**Protected mode stays off.** Valkey normally refuses connections from other machines when no password is set (*protected mode*). The official image turns that default off when it's built, since a container's port is only reachable when published on purpose. We keep it off: the NetworkPolicy decides who can connect. Valkey's example `valkey.conf` sets `protected-mode yes`, so copying settings from it would silently lock out the web server and runner.

**Shutdown.** When Kubernetes stops the pod, it sends SIGTERM. Valkey then flushes the append-only file and exits, well within Kubernetes' default 30-second grace period.

### 2.1 The append-only file's size

The file only grows: every change is appended, including deletions, such as a Session stream expiring. Valkey compacts it automatically (an *AOF rewrite*) once it has doubled since the last compaction and is at least 64 MB. So on disk it reaches about 64 MB, which is what the 256 MiB volume (D41) is sized for.

The file's size doesn't drive memory. Loading it replays the history, so it needs only as much memory as the most data that existed at once, about 1 MB here, not 64 MB.

### 2.2 Memory, measured

An empty Valkey 9.1.3 used about 5 MiB of container memory (`docker stats`), and Valkey reported 0.9 MB of its own data structures. Our data: at most three running Sessions of about 120 KB each, the streams of Sessions that ended in the last minute, and a handful of small keys. That's around 1 MB, far below `maxmemory`.

## 3. Health checks

D29 says Valkey uses `valkey-cli ping` for both readiness and liveness. The probe runs:

```sh
valkey-cli --no-auth-warning --user probe --pass probe ping | grep -q PONG
```

The `probe` user can only run `PING` (§6).

**Timing (D44):** readiness every 2 seconds, so Valkey counts as ready again soon after a restart. Liveness at Kubernetes' defaults: every 10 seconds, a 1-second timeout, and a restart after 3 failures in a row.

**Why the `grep`:** `valkey-cli` exits with 0 even when Valkey answers with an error. That matters right after a restart: while Valkey loads its files, it answers `PING` with a `LOADING` error, and a bare `valkey-cli ping` would count that as healthy. The pod would be marked ready, and traffic sent to it, before Valkey can serve anything. Checking for `PONG` counts only a real answer. When Valkey isn't running at all, `valkey-cli` can't connect and exits with 1, so that case fails either way.

**Tested** with plain Docker, using a much larger file than ours:
1. Started Valkey 9.1.3 with the append-only file on, and filled it with 5 million keys (`debug populate 5000000`, a command for testing that has to be enabled at start-up).
2. Rewrote the file (`bgrewriteaof`), which gave a 130 MB base file.
3. Restarted the container and ran `valkey-cli ping` over and over.

It printed `LOADING Valkey is loading the dataset in memory` seven times, each with exit code 0, then `PONG`. Our own file loads in milliseconds, too briefly to catch this by hand, which is why the test needed a large file.

## 4. Failure behaviour

| What happens | What Valkey does | What the rest of the app sees |
|---|---|---|
| The pod is restarted (deploy, node restart) | Loads its files and continues, with at most about a second of writes lost | A stall of a few seconds (architecture §9) |
| Valkey hangs: the process runs but doesn't answer | The liveness probe fails. After 3 failures in a row, 10 seconds apart (D44), Kubernetes restarts the container | A stall from when the hang starts until the restart finishes: up to about 30 seconds, plus the restart |
| Data reaches `maxmemory` (48 MB) | Refuses writes with an `OOM command not allowed` error, keeps serving reads (D40) | The runner's writes fail, so running Sessions end as *interrupted*. The error shows in the runner's logs. With about 1 MB of data, this needs a bug, such as a stream that is never trimmed |
| The container goes over its 64 MiB limit anyway | The kernel kills Valkey (*OOM kill*), and Kubernetes restarts it | A restart. Unlikely, since `maxmemory` stops data growth 16 MiB earlier |
| The disk fills up | Writes to the append-only file fail, and Valkey refuses writes until there is space | The runner's writes fail, so running Sessions end as *interrupted* |

## 5. Running and testing it alone

With the cluster up and `tilt up` running, Tilt shows `valkey` as its own resource. To talk to it directly:

```bash
kubectl exec -it valkey-0 -n exhibition -- valkey-cli --user admin --askpass
```

`--askpass` asks for the `admin` password (§6) instead of taking it on the command line, where it would end up in your shell history. The commands below run the same way; each asks for the password.

**Checking that data survives a restart.** Store a value under a throwaway key. `test:persistence` is just a name made up for this test; the colon is the usual way to group Valkey key names, as in `session:{id}`.

```bash
kubectl exec -it valkey-0 -n exhibition -- valkey-cli --user admin --askpass set test:persistence hello
```

Wait a second, since writes reach the disk once a second, then delete the pod:

```bash
kubectl delete pod valkey-0 -n exhibition
```

The StatefulSet creates a new `valkey-0` with the same volume. Once it's ready, read the value back:

```bash
kubectl exec -it valkey-0 -n exhibition -- valkey-cli --user admin --askpass get test:persistence
```

It should print `hello`. Then remove the test key:

```bash
kubectl exec -it valkey-0 -n exhibition -- valkey-cli --user admin --askpass del test:persistence
```

**Checking the NetworkPolicy:** a throwaway pod without the web or runner label should be refused:

```bash
kubectl run nettest -n exhibition --rm -i --restart=Never --image=valkey/valkey:9.1.3-alpine --command -- sh -c "sleep 5; valkey-cli -h valkey --no-auth-warning --user probe --pass probe ping"
```

It prints `Connection refused`. The same command with `--labels=app=runner` added prints `PONG`.

The `sleep 5` matters. Tested: a pod that connects within its first moment is refused even with the right label, because k3s's policy controller hasn't yet added the new pod's address to the allowed list. The runner and web server retry their connection anyway (architecture §9), so this only shows up as a short delay when they start.

**Checking the users:** log in as each user and try something it may and may not do. For example, the web user may read Session streams but not write them:

```bash
kubectl exec valkey-0 -n exhibition -- valkey-cli --no-auth-warning --user web --pass dev-web-password xadd session:test "*" type fake
```

It prints `NOPERM User web has no permissions to run the 'xadd' command`.

## 6. Users and permissions

Each component logs in as its own Valkey user, allowed only what it needs (D46), on top of the NetworkPolicy (D42). The user list, roughly:

```
user default off
user runner on ~session:* ~slots ~spend:* ~sleeping:* %R~presence %R~watching:* +xadd +xrevrange +expire +get +set +incrbyfloat +exists +ping
user web on %R~session:* %R~slots ~presence ~watching:* +xread +xrange +xrevrange +set +ping
user probe on nopass +ping
user admin on ~* &* +@all
```

- `default off` turns off the anonymous user, so every client must log in.
- `~pattern` allows reading and writing matching keys; `%R~pattern` allows reading only.
- `+command` allows a command; everything not listed is refused with a `NOPERM` error.
- `probe` needs no password (`nopass`), since it can only run `PING`. `valkey-cli` still has to send one to log in as a named user; with `nopass` any value is accepted, so the probe sends `probe`. Tested: without `--pass`, `valkey-cli` doesn't log in at all and gets `NOAUTH`, again with exit code 0. The health check becomes `valkey-cli --no-auth-warning --user probe --pass probe ping | grep -q PONG`.
- `admin` may do anything. It's for people, debugging with `kubectl exec`, and no component uses it. Locally its password is in `deploy/overlays/local/` (D49).

Each command list matches what that component's code does: the runner's is settled ([runner component doc §2.4](runner.md#24-reading-and-writing-valkey)), the web server's is settled when it is written. Tests that run a component against a real Valkey with this user list catch a missing permission.

### 6.1 Where the passwords come from

The user list above is a template, `deploy/base/valkey/users.acl`, with a placeholder in place of each password, for example `user runner on >{{runner}} ~session:* …` (D50). The passwords are a separate Secret, `valkey-passwords`, with one entry per user: `runner`, `web` and `admin`.

When Valkey's container starts, a short shell script, part of the StatefulSet's container command:
1. reads the template from the ConfigMap's mount (`/etc/valkey/users.acl`) and the passwords from the Secret's mount (`/etc/valkey-passwords/`);
2. drops comment lines and replaces each placeholder with its password;
3. writes the result to `/tmp/users.acl`, readable only by Valkey's own user;
4. hands over to the image's own start-up script, which switches to the `valkey` user and starts Valkey with `aclfile /tmp/users.acl` from `valkey.conf`.

Passwords must be letters, digits and hyphens only, since the script substitutes them with `sed`.

The runner and the web server each mount only their own entry of `valkey-passwords`, as a file (D37). The `admin` entry is mounted nowhere but Valkey.

**In development** the Secret is a plain manifest with fixed values, committed in `deploy/overlays/local/` (D49, D51), with a comment saying they're for the local cluster only. Tilt deploys them with everything else, so there's nothing to set up. **In production** only the source of `valkey-passwords` changes; the template, the script and the mounts stay the same.

## 7. Security settings

The container runs as the image sets it up (D52): it starts as root, and the image's own start-up script hands `/data` to the `valkey` user (ID 999) and switches to that user before starting Valkey. Kubernetes' stricter settings, the "restricted" Pod Security Standard, are deliberately left out for simplicity.

**Sources:** [Valkey releases](https://github.com/valkey-io/valkey/releases), [Valkey persistence](https://valkey.io/topics/persistence/), [Valkey's example configuration](https://github.com/valkey-io/valkey/blob/9.1.3/valkey.conf), [Valkey ACLs](https://valkey.io/topics/acl/), [the official image's Dockerfile](https://github.com/valkey-io/valkey-container/blob/mainline/9.1/alpine/Dockerfile), [Bitnami's Valkey chart defaults](https://github.com/bitnami/charts/blob/main/bitnami/valkey/values.yaml), [Kubernetes: probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/), [Kubernetes: debugging with ephemeral containers](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/#ephemeral-container), [Kustomize: configMapGenerator](https://kubectl.docs.kubernetes.io/references/kustomize/kustomization/configmapgenerator/), [Kubernetes: Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) (checked November 2026).
