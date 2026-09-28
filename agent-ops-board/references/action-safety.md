# Action safety

Loaded by Phase 4 (single-flight) and Phase 5 (side effects). Every external side
effect happens exactly once, or its state is explicitly uncertain.

## 1. Side-effect state machine

| From | To | Guard | Record written |
|---|---|---|---|
| planned | context_verified | context packet fresh, identity resolved | packet hash |
| context_verified | ready | authority row allows it; content sanity gate passed | payload hash, policy version |
| context_verified | stale | revision, rights or payload changed | reason |
| ready | suppressed | opt-out, bounce, complaint, contact hold | reason code |
| ready | held | per-item preflight found changed context | reason code |
| ready | claimed | atomic claim succeeded (§3) | action key, claimant, attempt ID |
| claimed | attempted | kill switch and pause re-checked | intent persisted **before** the call |
| attempted | accepted | provider returned an ID | provider ID persisted **after** the call |
| attempted | failed | provider definitively rejected (4xx with no commit) | error category |
| attempted | uncertain | timeout, transport error, 5xx, crash, lost response | everything known |
| accepted | confirmed | provider delivery/settlement event read back | event, observedAt |
| confirmed | recorded | card thread written and read back | message ID |

There is **no edge from uncertain to attempted.** `uncertain` leaves only through
reconciliation: find the provider record by stable ID, then move to `accepted`,
`failed`, or keep `uncertain` and escalate. An `uncertain` item blocks every future
attempt with the same key and stops the batch it belongs to.

## 2. Action keys and idempotency

- `actionKey = sha256(tenant | source identity | action type | content hash)`.
  Two drafts can never produce two answers to one triggering message; an authorized
  distinct follow-up carries its own authority reference and so its own key.
- Send a stable external ID wherever the provider accepts one (an RFC Message-ID
  such as `<campaign.account@your-domain>`, or an idempotency-key header).
- Client-generated message IDs for record writes, persisted privately before the
  request. Server contract (see `schemas.md`):
  - same ID, same payload → original receipt, `replayed: true`;
  - same ID, different payload → `409`;
  - possible commit with lost response → `503 write uncertain`: keep the same ID
    and body, reconcile, never mint a new ID.
- Retry a write only on an explicit rate limit, within a bounded `Retry-After`
  window. Transport failures are not retried in place because a lost response may
  follow a committed write.

## 3. Single-flight substrates

In-process flags are not locks: several workers or a cron fork each hold their own.

**Unique key, exactly-once business event** (keyed on an immutable source row,
never a mutable counter an admin can edit). Invariant: a second claim of the same
event inserts nothing. Example for PostgreSQL:

```sql
INSERT INTO handled_events (source_row_id, action_type, claimed_at)
VALUES ($1, $2, now())
ON CONFLICT (source_row_id, action_type) DO NOTHING
RETURNING source_row_id;   -- no row returned = already handled
```

Declare the unique index in code. Without it, `ON CONFLICT DO NOTHING` silently
inserts everything.

**Conditional contact slot**. Invariant: two senders can never both contact one
person inside the quiet period; the claim is one conditional write. Example for a
document database:

```js
const r = await contacts.updateOne(
  { accountId, $or: [{ lastContactAt: null }, { lastContactAt: { $lte: new Date(Date.now() - quietMs) } }] },
  { $set: { lastContactAt: new Date(), lastContactKey: actionKey } },
);
if (r.modifiedCount !== 1) return record('skipped-concurrent');
```

**Advisory lock on a pinned connection**. Invariant: the lock belongs to a
session, so take and release it on one pinned connection (a pooled query may run
on another). Example for PostgreSQL with node-postgres:

```js
const conn = await pool.connect();          // pin
try {
  const { rows } = await conn.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID]);
  if (!rows[0].ok) return;                   // someone else holds it
  await doWork(conn);
} finally {
  await conn.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
  conn.release();
}
```

**Atomic directory lock** for file-based jobs: `mkdir <lock>` plus `owner.json`
(operation, PID, startedAt). A lock left by a crash is evidence to reconcile, not
garbage to delete.

Scheduled work runs in one dedicated process; request workers have scheduling
disabled. Enforce single-flight anyway.

## 4. Reviewed-batch protocol

For any bulk outbound, grant, correction or listing change.

**Roster** (immutable file): per item the canonical ID, destination, role,
expected state, rendered subject/body, `contentHash = sha256(canonical message)`,
and the hashes of the source records used.

**Approval** (separate file): campaign ID, purpose, approver, evidence list,
`sha256(roster bytes)`, `sha256(authorization text)`, `notBefore`, `expiresAt`,
max items, audiences. Campaign scopes are an allowlist in code; a new campaign
cannot run without a reviewed change naming it.

**Sender loop**, per item:

1. Re-read roster and approval; abort if either hash differs or the window closed.
2. Re-check kill switch, loop pause and campaign pause.
3. Preflight (all must pass, else move to hold queue with a reason code):
   - identity, role and status unchanged on the canonical account;
   - suppression across every store (file, DB, CRM, sales contacts) by canonical
     key; bounces and complaints;
   - preference or unsubscribe token still matches the link in the body;
   - no contact in any ledger within the quiet period (floor 48 h in code;
     exceptions need a named, hash-bound approval listing the overridden sends);
   - no open or updated ticket, no new inbound or outbound since the channel
     baseline recorded at review (channel cursor plus invalidation token, for
     example IMAP UIDVALIDITY and last UID; `schemas.md` §M);
   - the channel's consent basis and the recipient's quiet hours still allow it
     (SMS, voice, chat and in-app channels have their own rules);
   - no new purchase, changed setup or observed usage that makes the copy obsolete.
4. Claim the contact slot (§3), then the action key.
5. Send with the stable external ID and record the item in the §1 states:
   `claimed → attempted` (intent persisted) `→ accepted` (provider ID) `→
   recorded`. `attempted` without `accepted` is `uncertain` and blocks future
   attempts. A provider exception or non-success stops the batch.

Hold-queue reason codes are machine-readable (`channel-context-changed`,
`new-purchase`, `suppressed`, `ticket-open`, `quiet-period`, `identity-changed`).
Holds are never auto-released within the run. Hold rows: `schemas.md` §M.

Before the batch, fetch every public link in the body. Compare the exclusion count
against the known total; an empty suppression set on a non-empty base is a bug.

## 5. Bounded runner and reconciliation

- Batches of N with a hard maximum batch count per run.
- After every batch, even a failed one, run provider reconciliation and recording.
- Acceptance ≠ delivery ≠ reply ≠ sale. Read the provider's last event per item;
  providers can drop a send to an account-level suppression list while returning a
  normal ID.
- Upsert bounced, suppressed and complained addresses into the opt-out store.
- Delivery health is a stop condition (complaint, or bounce rate over threshold):
  write the campaign `PAUSED` file; never auto-resume.
- Reconcilers and recorders cannot send. They can be re-run freely after any
  failure.
- Never resume or extend a finished campaign; a new window is a new approval.

## 6. Two-phase dry-run and apply

For corrections, cleanups, migrations and mailbox reconciliation:

1. Dry run is the default and writes nothing shared. Verify that: read every
   subprocess it calls for side effects.
2. Produce a manifest with a stable operation ID.
3. Before the first mutation, write immutable manifest, before-images and intent.
4. Re-check each target's identity and unrelated fields immediately before each
   write.
5. Read back after, and record the verification.

Cleanup is dedupe plus hand-verified blocklists. Never bulk-delete on a keyword
heuristic; dedup by business-key window and add the unique index that prevents
recurrence.

## 7. Content sanity gate

Reject before `ready`: unrendered placeholders or template tokens, broken
interpolation (`undefined`, `NaN`, `[object Object]`), zero or negative amounts,
bodies below a minimum length, banned characters, claims not derivable from live
data. Rewrite errors that mention credentials to a generic message before logging.

## 8. Money integrity

- Size a suspected leak in the underlying unit (value, volume), not rows.
- Understand every funding model before re-attributing usage; prepaid is not
  unbilled. Keep a fast revert ready.
- Every money-moving endpoint pair must conserve value (no positive adjustment
  followed by a refund that mints balance). High-risk flows default off behind
  explicit flags, with a detection query kept for audits.
- Exact numeric types in money and metering paths; no rounding of small periodic
  increments. Deploy schema changes before the code that relies on them.
- A code-guard fix and a historical correction are separate facts; neither implies
  the other. Correct a balance only after a reported, proven problem, with owner
  authority.
- Derive business events from immutable source rows with exactly-once claims.

All state files: mode 0600 under umask 077, atomic write via temp file + rename.
