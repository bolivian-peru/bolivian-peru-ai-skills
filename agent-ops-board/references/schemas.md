# Schemas

Copy-pasteable shapes for every record the engine writes. All of them map onto the
existing card, thread and system-of-record model; none requires a second store.
`null` means unknown, never zero.

## A. Card

Extra fields live in labels and a structured description block if the board has
no custom fields.

```json
{
  "id": "card id from the board",
  "title": "Customer X: first useful workload",
  "status": "todo | in_progress | done",
  "archived": false,
  "labels": ["objective:revenue", "stream:activation", "stage:prepared", "writer:executor-daily"],
  "objective": "revenue",
  "stream": "activation",
  "stage": "prepared",
  "proof": [{ "label": "observed", "source": "integration test log", "observedAt": "2026-01-01T10:00:00Z" }],
  "blocker": "customer has not set a credential",
  "nextAction": "send setup steps tested against their stack",
  "accountableOwner": "coordinator",
  "due": "2026-01-03",
  "authorityRef": "policy:2026-01-01-03",
  "writer": "executor-daily",
  "lease": { "attemptId": "uuid", "fence": 7, "expiresAt": "2026-01-01T11:00:00Z" },
  "revision": 12
}
```

`done` means verified. Richer state lives in `stage:*` labels and the `blocker`
field, not new statuses. `lease` and `revision` are **(design)**: if the board
lacks them, the coordinator enforces one writer per card and the handoff says so.
`health` reads `accountableOwner`, `nextAction` and `due` when present, else the
thread's `Owner:`, `Next:` and `Due:` lines.

Label conventions: `objective:<id>`, `stream:<id>` (exactly one per active card),
`stage:<slug>`, `writer:<executor>`, `paused:<reason>`, `uncertain` (an action on
this card awaits reconciliation). Label values are lowercase kebab-case slugs; a
stage slug is the chain stage name from SKILL.md Phase 2
(`stage:provenance-verified`).

## B. Thread message

```json
{
  "clientMessageId": "uuid persisted before posting",
  "actor": "set by the server from the authenticated identity",
  "kind": "update | evidence | assignment | acknowledgment | verification | decision_request | owner_decision | handoff | halt",
  "text": "Changed: ...\nProof: ...\nOpen: ...\nNext: ...\nOwner: ...\nDue: ...\nAuthority: ...",
  "createdAt": "server time"
}
```

A recipient label is display only and grants nothing. If the board has no `kind`
field, the kind travels as a `Kind:` line in the text; acknowledgment and
verification messages use the prefixes in SKILL.md Phase 4 (`Run:`,
`ScopeSha256:`, `Verifier:`, `Result:`).

**Good:**

```
Changed: stage prepared -> integrated for account 5f2c (canonical id)
Proof:   observed, usage ledger rows 2026-01-02 09:10-09:40 UTC, 1.8 units ;
         observed, release marker 4f1a9c2 read from all 3 API hosts 09:05 UTC
Open:    customer asked about volume pricing (below list -> owner)
Next:    RED item to owner with volume, mix and supply cost
Owner:   coordinator
Due:     2026-01-03
Authority: policy:2025-12-20-01
```

**Good, uncertain send:**

```
Changed: follow-up to account 91ab attempted; state UNCERTAIN (provider timeout 30s)
Proof:   observed, intent record key 3e9f... written 14:02:11 UTC ;
         unknown, provider response lost
Open:    whether the provider accepted the message
Next:    reconcile by Message-ID <followup-jan.91ab@your-domain> in provider log and
         sent archive; do NOT resend; batch stopped at item 14/40
Owner:   coordinator
Due:     2026-01-02 16:00 UTC
Authority: approval roster sha256 a1b2... window 2026-01-02
```

**Bad:** `Fixed the issue and replied to everyone.` (no evidence, no stage, no open
items, no owner, and "replied" is unverified).

## C. Action record

```json
{
  "actionKey": "sha256(tenant|source|type|contentHash)",
  "tenant": "tenant id",
  "type": "email.send | payment.refund | grant.trial | deploy | delete",
  "destination": "canonical id or target, never free text",
  "payloadHash": "sha256",
  "policyVersion": "policy register entry id",
  "authorityRef": "entry id or owner decision id",
  "state": "planned | context_verified | ready | claimed | attempted | accepted | confirmed | recorded | stale | suppressed | held | failed | uncertain",
  "reason": "machine reason code for stale/suppressed/held/failed",
  "attemptId": "uuid",
  "providerId": null,
  "externalId": "stable Message-ID or idempotency key",
  "timestamps": { "planned": "", "attempted": "", "accepted": null, "confirmed": null }
}
```

## D. Policy register entry

```json
{
  "id": "policy:2026-01-01-03",
  "date": "2026-01-01",
  "by": "owner",
  "kind": "standing | one_off | deferral | pause",
  "scope": "exact action category, target, audience",
  "ceiling": "amount, count or rate; null if none",
  "window": { "from": "2026-01-01", "to": null },
  "delivered": false,
  "neverRepeat": false,
  "supersedes": null,
  "note": "why"
}
```

## E. Decision-rights matrix row

```json
{ "category": "reply.existing_thread", "level": "L2", "cap": "40/day",
  "approver": { "group": "support-leads", "quorum": 1 },
  "evidenceRequired": ["handled-ledger check", "no newer inbound"],
  "recheckAtDispatch": ["suppression", "conversation revision", "payload hash"],
  "outcomeMetric": { "name": "support_resolved_verified", "direction": "up", "minChange": 5, "lagDays": 7 },
  "costCap": { "unit": "currency", "perVerifiedOutcome": 4.0 } }
```

A blank `level` is L0. `outcomeMetric.name` is a metric from the snapshot rows
(§G); `direction` is `up` or `down` (for example open incidents or MTTR go down).

## F. Audit line (append-only JSONL)

```json
{ "ts": "2026-01-01T06:00:00Z", "tenant": "t1", "loop": "followups", "decision": "run | halt",
  "note": "exit=0 work=12", "cost": { "unit": "currency", "amount": 0.84, "source": "model + tool invoices" },
  "prevSha256": "sha256 of the previous line" }
```

`cost` (optional) covers model tokens, tool and API spend, and human review time
(unit `minutes`); it is what the weekly review divides by verified stage moves.

## G. Snapshot row

```json
{ "metric": "external_cash", "period": "2026-01-01/2026-01-31", "value": 1234.5,
  "unit": "currency", "source": "payment provider events", "observedAt": "2026-01-01T06:00:00Z",
  "completeness": "complete | partial | unknown", "stale": false,
  "note": "provider-confirmed, deduplicated; excludes balance-funded purchases" }
```

A failed read is `"value": null, "completeness": "unknown"`.

## H. Delegation brief and acknowledgment

```json
{ "brief": { "objective": "", "scope": [], "authorityRef": "", "tools": [], "reads": [], "writes": [],
    "forbidden": [], "deferrals": [], "outputCard": "", "completionCheck": "", "stopCondition": "",
    "writer": "", "budget": "", "onUncertain": "stop, record, reconcile, never retry",
    "pauseChecks": ["before each claim", "before each provider call"] },
  "ack": { "executorRunId": "", "scopeSha256": "sha256 of the brief text as received", "at": "" },
  "verification": { "verifier": "not the executor", "criteria": [], "evidenceRefs": [], "result": "pass | fail", "at": "" } }
```

## I. Runtime snapshot

```json
{ "status": "healthy | degraded | unavailable", "observedAt": "",
  "sources": [{ "id": "scheduler", "available": true, "checkedAt": "", "errorCode": null }],
  "jobs": [{ "id": "", "enabled": true, "lastResult": "ok | error | never", "errorCategory": null,
             "nextRunAt": "", "running": "reported | none", "historical": false }],
  "pauses": { "global": false, "loops": ["followups"] },
  "limitations": ["A configured job is not proof it ran.", "A 'running' marker is reported, not a heartbeat."] }
```

## J. Handoff note

```json
{ "at": "", "releaseMarkers": [{ "surface": "", "host": "", "marker": "", "readAt": "" }],
  "cursors": {}, "completedActionKeys": [], "pendingExternal": [], "uncertain": [],
  "writers": {}, "liveVsPrepared": [], "pauses": [], "deferrals": [],
  "openIncidents": [], "ownerDecisionsPending": [] }
```

## K. Minimal board contract (for a company with no board)

The smallest HTTP surface the engine and `export-board.mjs` need. A board built to
it runs the helper with `BOARD_PAGE_MODE=cursor`.

| Method + path | Contract |
|---|---|
| `GET /tasks?limit=&cursor=` | list cards; returns `{ items, nextCursor }`; `archived=true` lists archived cards, each with `archived: true` |
| `GET /tasks/{id}` | one card with `revision` |
| `PATCH /tasks/{id}` | **(design)** requires `If-Match: <revision>` (or body `revision`); `409` on mismatch |
| `GET /tasks/{id}/messages?limit=&before=` | thread page ordered newest first, stable under appends; returns `{ messages, hasMore, nextBefore? }` (without `nextBefore`, the oldest id on the page is the next `before`) |
| `POST /tasks/{id}/messages` | body `{ text, clientMessageId }`; actor from auth; atomic conditional append; the stored message returns `clientMessageId` |
| `GET /changes?after=<updatedAt,id>` | **(design)** change feed ordered by `(updatedAt, id)`, includes archive and delete |

Message append semantics:

- same `clientMessageId`, same body → `200` with the original receipt, `replayed: true`;
- same `clientMessageId`, different body/actor → `409 MESSAGE_ID_CONFLICT`;
- commit possible but response unknown → `503 WRITE_UNCERTAIN`; client keeps the
  same ID and body and reconciles;
- a per-card message cap is enforced in the same atomic write; history is never
  sliced.

## L. Executor capability row

One row per executor capability (SKILL.md Phase 0). Each dimension is `true`,
`false` or `null` (not checked).

```json
{ "executor": "executor-daily", "capability": "reply.existing_thread",
  "discovered": true, "configured": true, "read_verified": true, "write_supported": false,
  "deployed": true, "connected": null,
  "lastRun": { "at": "2026-01-01T06:00:00Z", "result": "ok | error | never" },
  "evidenceRef": "scheduler job log read 2026-01-01T06:05Z" }
```

## M. Intake stores

Locations are named in the `SYSTEMS_OF_RECORD` input. Each is one store shared by
every sender, never agent memory.

```json
{ "handled":     { "tenant": "t1", "channel": "support-mail", "originalMessageId": "",
                   "replyProviderId": "", "sentArchiveRef": "", "at": "" },
  "cursor":      { "tenant": "t1", "channel": "support-mail", "lastId": "", "validityToken": "", "at": "" },
  "suppression": { "tenant": "t1", "canonicalId": "", "reason": "opt-out | bounce | complaint | contact-hold",
                   "source": "", "at": "" },
  "hold":        { "tenant": "t1", "actionKey": "", "reasonCode": "channel-context-changed", "at": "" } }
```

`originalMessageId` is unique per tenant and channel, so a message is handled once.
