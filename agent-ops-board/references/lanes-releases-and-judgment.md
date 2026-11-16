# Lanes, releases and judgment

Loaded by Phase 0 (stream index, runners), Phase 3 (lanes), Phase 4 (premise
check, review), Phase 8 (releases) and the autonomy ladder (calibration). How
several operators share one company without colliding, how changes ship without
deleting what is live, and how decisions stay honest.

## 1. Stream index

One card (or one pinned section of the handoff note) lists **every parallel
stream**. It is the first thing each session reads.

| Column | Content |
|---|---|
| stream | the `stream:<id>` label |
| state | active, waiting (on whom), paused (reason) |
| context | where the live context is: card ids, files, threads |
| next | one next step |
| owner | accountable owner |
| lane | the current lane claim (§2), or none |

- It is an index, not a store. Detail stays on the stream's cards.
- Update it at every material event (a stage move, a pause, a new stream, a
  handoff). A stale index is reported, never trusted.

## 2. Lanes for concurrent operators

Two operators answering the same thread minutes apart is the failure to design
out. Several sessions, scheduled runners and humans may work at once.

- **A lane claim** names the stream, the operator and a time box, in one shared
  place (the stream index or a lane card). Shape in `schemas.md` §O. The claim is
  one conditional write: a second claim on a live lane fails.
- A lane is stream-level. Inside it, the card-level single writer and lease rules
  of SKILL.md Phase 4 still apply.
- An expired claim is released by its time box, not by guess. An operator that
  needs more time renews before expiry.
- **Per-run unique names** for any plan, draft or roster file (operator, run id,
  time). A fixed name lets one run overwrite another's draft.
- **Re-read the newest message immediately before every send**, on that thread,
  through the channel itself. If anything arrived or left since the draft, the
  draft is stale (`action-safety.md` §1).
- **Answered-thread detection reads the full history**, not a recent window. A
  check over the newest N sent items hid earlier replies and caused a double
  answer. If the full history cannot be read, the thread is `unknown`, not
  unanswered.
- The handled ledger (`intake-and-context.md` §2) is shared by every operator;
  a private ledger per session is the same bug as a per-process lock.

## 3. Verify the premise before acting on a brief

A brief, a queue item or a handoff describes the world as it was when written.

- **The first step of every delegated task is to check that the situation it
  describes is still true**, at the source, and record what was read.
- The brief carries a **stop rule**: which premise, if false, ends the task with a
  report and no action.
- Two tasks in one day were launched on premises that were false: a partner said
  to be waiting who had already been answered, and a sales stop that had ended
  that morning.
- **Pass real data into delegated work, never placeholders.** A brief with
  "<list of accounts>" or sample rows invites an executor to invent the list.

## 4. Runners, models and quotas

Model limits, API quotas and account allowances are **control-plane facts**, read
like pauses.

- **One active runner per loop at a time**, with a heartbeat written on each step.
  A second runner takes over only after the heartbeat goes stale and the lock is
  reconciled.
- On a limit or quota error: back off with a bounded wait, record a `halt` audit
  line with reason `quota`, and hand back to a second runner on a different
  allowance if one is configured.
- **A stage that dies on a limit fails loudly.** It writes its halt and leaves no
  partial output that looks complete. The next stage checks that its input exists
  and is complete before it starts; missing input is a halt, not an empty run.
- **Nothing customer-facing depends on a single account's allowance.** A shared
  provider key used by another campaign can exhaust the quota for replies. List
  each such dependency in the handoff with its fallback.

## 5. Release discipline

Extends the production change protocol (`change-security-and-tenancy.md` §1).

- **Prove the running artifact equals the base you built on** before overlaying a
  change: hash the live files and compare them with the build of your base
  commit. A live file carried an in-place patch that source lacked; shipping would
  have deleted features. A mismatch stops the release until the drift is folded
  into source.
- **Grandfather existing accounts** when a rule change would silently cost them
  (a new limit, a removed tier, a changed default). Existing accounts keep the old
  behaviour; the move to the new rule is opt-in.
- **A red gate means stop and report.** Waiting for green is an explicit, recorded
  decision by the coordinator, not an executor's choice. An executor never
  re-runs a gate until it passes.
- **Backtest any automated filter or classifier over the full history** before it
  goes live. State the catch rate and the false positives with counts, and the
  period tested.
- **State plainly what was not verified end to end.** A release note lists every
  path that was only checked in part.

## 6. Independent review

- Review is a **separate role from building**. The author of a change, plan or
  design does not review it.
- Budget for an adversarial review on anything consequential (money, auth,
  deletion, customer-facing behaviour). One found unsafe changes in a design that
  had passed its author.
- A review that failed for an infrastructure reason (timeout, quota, crash) did
  not happen. Re-run it; never read silence as a pass.
- The reviewer receives the artifact and the criteria, not the author's
  conclusion.

## 7. Decision calibration

- **Classify each decision** by reversibility (easy, costly, irreversible) and
  exposure (internal, one counterparty, many, public, money).
- Routine, reversible, low-exposure decisions are made from policy, quickly, within
  authority. Irreversible or high-exposure ones get structured analysis
  (`authority-and-decision-rights.md` §7) or go to the owner.
- **Log each call**: the decision, the class, the option chosen, a confidence
  (for example 0.7), the expected outcome and a review date. Shape in `schemas.md`
  §Q.
- Record the actual outcome later and **review the log** in the weekly review.
  Confidence that does not match outcomes is adjusted.
- **Owner direction that changes the goal order** (for example distribution
  before margin) is recorded as a dated `standing` entry in the policy register
  that rewrites `PRIORITY_ORDER`. It overrides default ranking and commercial
  gates from that date. It never lifts an OWNER_ONLY category, a named pause or
  the fixed first rank rule.
