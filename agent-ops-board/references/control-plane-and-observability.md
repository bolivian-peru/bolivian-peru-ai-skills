# Control plane and observability

Loaded by Phase 1 (install) and Phase 7 (cadence and watch). The control plane is
what lets a human stop the engine now; observability is how anyone knows what it
is actually doing.

## 1. Kill switch and pauses

| Control | Form | Effect | Who clears it |
|---|---|---|---|
| Global kill switch | one sentinel file (or DB flag) | every guarded job halts; engine observes and reports only | a human, never a timer |
| Loop pause | `<pause-dir>/loop-paused-<loop>` with timestamp and reason | that loop halts | the owner or the entry that created it |
| Campaign pause | `<campaign-dir>/PAUSED` | that campaign halts mid-batch | the owner |

Rules:

- Read state from file **names** only, never contents. An unreadable directory is
  `unknown`, and `unknown` is treated as paused.
- Re-check before each new claim and each provider call, not only at job start, so
  a pause dropped mid-batch stops the next item.
- Distinguish a **requested** stop (file written) from an **acknowledged** stop
  (the loop's next audit line says `halt`). Report both.
- **Coverage statement**: pauses stop guarded jobs. They do not stop an action
  already in flight, an unguarded agent or a job outside the runner. Keep that
  list in the handoff.
- Nothing resumes as a side effect: not a new skill run, a revenue target, an
  unpaused global flag or a successful probe.
- Automatic pause triggers: invalid identity or permission, provider wait signal,
  uncertain dispatch, stale metrics, a paused controlling assignment.

## 2. Guarded runner

Wrap every scheduled job. Copy, set the paths, and call it from the scheduler as
`run-guarded.sh <loop> <max-runs-per-day> <timeout-seconds> <command...>`.
It needs `timeout` (GNU coreutils; `gtimeout` on macOS) and halts closed without it.
Fixed names under `ENGINE_CONTROL_DIR`: `KILL_SWITCH`, `pauses/`, `audit.jsonl`,
`locks/`, `counts/`. `ENGINE_TENANT` names the tenant (default `default`).

```bash
#!/usr/bin/env bash
# run-guarded.sh: kill switch, pause, single-flight, runs-per-day cap, timeout, audit.
set -u
LOOP="$1"; CAP="$2"; TIMEOUT_S="$3"; shift 3
CTL="${ENGINE_CONTROL_DIR:?set ENGINE_CONTROL_DIR}"; TENANT="${ENGINE_TENANT:-default}"
KILL="$CTL/KILL_SWITCH"; PAUSES="$CTL/pauses"; AUDIT="$CTL/audit.jsonl"
LOCK="$CTL/locks/$LOOP"; COUNT="$CTL/counts/$LOOP.$(date -u +%F)"
WORK="$CTL/counts/$LOOP.work"   # the job writes its count of work items here
SHA=$(command -v sha256sum || echo "shasum -a 256")
audit() {   # hash-chained: each line carries the sha256 of the previous line
  PREV=$(tail -n 1 "$AUDIT" 2>/dev/null | $SHA | cut -d' ' -f1)
  printf '{"ts":"%s","tenant":"%s","loop":"%s","decision":"%s","note":"%s","prevSha256":"%s"}\n' \
    "$(date -u +%FT%TZ)" "$TENANT" "$LOOP" "$1" "$2" "$PREV" >> "$AUDIT"; }

TO=$(command -v timeout || command -v gtimeout) || { audit halt no-timeout-binary; exit 1; }
[ -e "$KILL" ] && { audit halt kill-switch; exit 0; }
ls "$PAUSES" >/dev/null 2>&1 || { audit halt pause-dir-unreadable; exit 0; }
[ -e "$PAUSES/loop-paused-$LOOP" ] && { audit halt loop-paused; exit 0; }
N=$(cat "$COUNT" 2>/dev/null || echo 0)
[ "$N" -ge "$CAP" ] && { audit halt runs-cap; exit 0; }
mkdir -p "$CTL/locks" "$CTL/counts"
mkdir "$LOCK" 2>/dev/null || { audit halt lock-held; exit 0; }   # atomic single-flight
printf '{"pid":%s,"startedAt":"%s"}\n' $$ "$(date -u +%FT%TZ)" > "$LOCK/owner.json"
echo $((N + 1)) > "$COUNT"
rm -f "$WORK"
"$TO" "$TIMEOUT_S" "$@"; RC=$?
audit run "exit=$RC work=$(cat "$WORK" 2>/dev/null || echo unknown)"
[ "$RC" -eq 0 ] && rm -rf "$LOCK"   # a crashed run keeps its lock: reconcile, don't delete
exit "$RC"
```

The job itself re-checks the kill switch, loop pause and campaign `PAUSED` file
before each side effect. A lock left by a crashed run is evidence that something
may have half-happened; inspect `owner.json`, reconcile the actions it may have
taken, then remove it by hand.

**The runner caps runs, not actions.** Per-action caps (sends, grants, spend) are
enforced inside the job against the action records, before each claim:

```
if count(action records where type=T and tenant=X and attempted today) >= cap(T): halt "action-cap"
```

**Distributed variant** (several hosts, containers, CI runners or a cloud
scheduler cannot share a local directory). Same semantics on a shared store:
the kill switch is a flag row read before each step; pauses are rows keyed by
loop; the runs cap and per-action caps are atomic counters (conditional
increment that fails at the cap); the lock is the unique-key or advisory-lock
pattern from `action-safety.md` §3; an unreachable store is `unknown`, treated as
paused.

## 3. Outcome circuit breaker

Each loop names its outcome metric in its decision-rights row (`schemas.md` §E):
`outcomeMetric: {name, direction: up|down, minChange, lagDays}`. Run daily from
the snapshot collector:

```
for each loop L with outcomeMetric {name, direction, minChange, lagDays}:
  active  = audit has a "run" line for L in the last 24h with work > 0
  base    = latest snapshot of name at least lagDays old, same metric definition
  moved   = direction == up   ? M(now) - M(base) >= minChange
                              : M(base) - M(now) >= minChange
  if active and base exists and not moved:
      write <pause-dir>/loop-paused-L  (reason: "breaker: effort without outcome")
      append audit {loop:L, decision:"halt", note:"breaker M=<now> base=<base>"}
      add RED item: loop, effort and cost spent, metric, recommendation
  if active and costCap(L) set and cost(L, lagDays) / verified outcomes > costCap(L)  (zero outcomes = over):
      pause the same way (reason: "breaker: cost per outcome over cap")
  if base missing or M(now) is null: record "breaker: unknown", do not trip or clear
```

A breaker never clears itself. Set the lag to the real outcome cycle: a
short-cycle outbound loop might use `lagDays: 7`; an enterprise sales or
procurement loop may need 60-90 days. Keep the comparison on the same definition
or it is noise.

A **delivery-health breaker** pauses a campaign on any complaint, or a bounce rate
above a threshold with a minimum count (for example >3% with ≥5 bounces).

## 4. Audit log

Append-only JSONL, one line per run or halt (`schemas.md` §F). It is the one
source for "runs versus halts" in the brief, the scoreboard, cost review and the
breaker. Never rewrite it.

- Tamper evidence: each line carries `prevSha256`, the sha256 of the previous
  line; verification recomputes the chain.
- Rotate by date, and copy each closed file off-host to storage the writer cannot
  modify.
- Retention is a per-tenant setting, recorded in the policy register.

## 5. Company snapshot

- One collector, one schedule, the only writer of KPI rows.
- It reads the same defended metrics source the dashboards use. If two consumers
  compute the same metric differently, fix the source; do not add a third.
- Failed reads are `null`. Every metric row carries `source`, `observedAt`,
  `completeness` and a `note` on what it does not prove (for example: cash is a
  provider-unreconciled lower bound; prepaid top-ups are not recurring revenue).
- Mark the whole snapshot `stale` after N hours (default 6) and add a RED item
  instead of interpreting old numbers.
- Keep capped history (e.g. 90 days) for the breaker and weekly review.
- Derived from it: the ranked daily plan and the RED owner queue.

## 6. Runtime observation lens

A read-only view of the scheduler and executors (agents, jobs, last result, next
run, pauses).

- Fixed allowlist of read-only commands as argument arrays, no shell; bounded time
  (seconds), output size and concurrency; no mutation routes.
- One designated runtime authority. Replicas return
  `unavailable / NOT_RUNTIME_AUTHORITY` instead of divergent local reads.
- Short cache with in-flight dedup; a failed metadata read is retried next call,
  not cached.
- Project raw output onto an allowlisted shape; reject oversize or malformed lists
  as `INVALID_OUTPUT`.
- Map raw errors to a finite set (for example `AUTH_FAILED`, `NOT_ALLOWED`,
  `DELIVERY_FAILED`, `RUN_TIMEOUT`, `RUN_FAILED`). Never return raw error text.
- Redact secret-shaped strings (key prefixes, long tokens, JWTs, IP addresses).
- Every payload: `sources[]` (`id, available, checkedAt, errorCode`) and a static
  `limitations[]` listing what it does not prove.
- Status: `unavailable` if no core source was read; `degraded` if any source
  failed, the scheduler is off, no agents, any enabled job's last run failed or
  never ran, or any pause is active; `healthy` otherwise.
- A disabled job's last error is labelled historical. "Running" is shown as
  reported, never as a heartbeat.
- Admin-only, current session identity, `Cache-Control: no-store`.

## 7. Freshness contract

- Every value carries `observedAt`. Values older than the expiry (default 120 s)
  or in the future are hidden, not shown as last-known-good.
- Refresh only while the viewer is visible.
- Change feeds order by `(updatedAt, id)` and include archive and delete
  transitions. Events are wake-up hints; the state transition and its audit record
  are written atomically.

## 8. Watchdogs

- Probe the outcome the customer buys, end to end (TLS, status, a bounded valid
  body), not an intermediate handshake.
- Check certificates on the wire at the served endpoint, not files on disk.
- Watch restart counts and fatal log lines, not only point-in-time populations: a
  process that crashes and recovers between samples is invisible otherwise.
- Alert on a transition after 2 consecutive bad runs, and once on recovery.
- Persist the pending notification before sending and the receipt (message ID)
  after confirmation, so a lost alert is retried next run.
- If a PID, start time or counter regressed between samples, report the interval
  as unknown; never let an incomplete sample become a baseline.
- Encode never-touch boundaries in the probe (outside-only checks for foreign
  systems).
- A diagnostic runs in its own error boundary and can never disable the work it
  watches.

## 9. Storm and starvation patterns

- Capped sweeps order candidates by least recently attempted and write an
  attempted-at timestamp, so permanent failures cannot starve the queue.
- Check your own failure paths, retries and timers before attributing churn or
  failure to a counterparty (`evidence-and-metrics.md` §7).

## 10. Console privacy

- Caches keyed by the actor from the session; a login change in another tab
  clears the view.
- Private threads excluded from list and public payloads by default.
- Any public roadmap is an opt-in curated projection with its own fields.
