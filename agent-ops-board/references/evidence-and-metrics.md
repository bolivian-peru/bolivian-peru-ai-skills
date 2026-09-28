# Evidence and metrics

Loaded by Phase 2 (result chains) and Phase 6 (verify and record). What counts as
proof, how outcomes are staged, and how numbers stay honest.

## 1. Trust tiers

| Tier | Evidence | Example |
|---|---|---|
| 1 | Direct read of the source or serving artifact | release marker read from each running host; database row read back; remote ref listed |
| 2 | Provider receipt | payment provider event ID; email provider message ID with last event |
| 3 | Reconciled ledger | ledger row matched to a provider receipt |
| 4 | Executor report | "deployed", "sent", "paid" from an agent or job |
| 5 | Board or free text | a card saying it is done |

Tier 4 and 5 are claims. They reach the owner only after a tier 1-3 check.

## 2. Evidence labels

Every `Proof:` item carries a label, a source and `observedAt`.

| Label | Meaning |
|---|---|
| observed | read directly this cycle |
| derived | computed from observed values (state the formula) |
| reported | someone said so; not yet verified |
| proposed | a plan or quote, not agreed |
| unknown | read failed, stale or not attempted |

Keep material negative results even if a later retry passed. One green run is not
a universal pass; name exactly which check passed.

## 3. Per-claim verification recipes

| Claim | Verify by |
|---|---|
| Deployed | read the release marker from the serving artifact on **every** target host; source, build and push are not deployment |
| Sent | provider message ID plus its last event; the exact copy in the sent archive |
| Paid | provider-confirmed event, deduplicated by provider ID; never a local status filter |
| DB write | read the row back through the same interface humans use |
| Pushed | list the remote ref and compare the commit |
| Fixed | the reported failure no longer reproduces on the customer path |
| Suspended / removed | absent from the serving index over several cycles, not just flagged |
| Alarm installed | the alarm fired in a test, or its schedule and target are read from the running system |
| Recovered | customer-path probes succeed end to end; resource metrics or health 200 are not recovery |

After any interrupted or rejected command, read the real state before reporting;
it may have run.

## 4. Result-stage evidence

| Chain | Stage | Entry evidence |
|---|---|---|
| Customer | qualified | stated need, budget or use case from the customer, recorded with source |
| | prepared | we ran their integration path ourselves and kept the output |
| | integrated | first useful workload observed in usage records |
| | paid | provider-confirmed payment |
| | retained / expanded | repeat payment in a later period |
| Supplier | vetted | identity, provenance and ownership evidence |
| | agreement | signed agreement of the current version |
| | approved | approval recorded by the named approver |
| | onboarded | scoped credential issued; registration record exists |
| | active and evidenced | fresh proof of fulfilment on an authenticated channel (a heartbeat, a delivered order); a retained record is not activity |
| | quality-qualified | probe or review on the target outcome passed |
| | listed | present in the serving index or catalogue that customers buy from |
| | first paid fulfilment | fulfilment attributed in the ledger |
| | settled | payout-ledger match |
| Partner / reseller | terms agreed | owner decision recorded with volume, mix, capacity, terms |
| | first resold unit | ledger row under the partner |
| Support | resolved | the requested outcome verified, not the reply sent |
| Incident | verified | customer-path check on the exact artifact |
| Trust and safety | enforced | the enforcement is absent from every serving and promotion path over several cycles |
| | appeal decided | decision by an approver other than the enforcer, with reasons recorded |
| Dispute / chargeback | decided | the provider's decision event; ledger adjusted to match |
| Internal request / access | fulfilled | the grant read back from the source system |
| | revoked | the source system shows the access gone (not the ticket closed) |

Messages, drafts, registrations, accepted sends, proposed deals and headline fleet
size are activity. Record them, never close on them.

## 5. Measurement contract

Each metric has a fixed definition, period, source and completeness flag.

Each metric also declares its **direction** (up or down is better), its
**minimum meaningful change** and its **outcome lag**, which the circuit breaker
uses (`control-plane-and-observability.md` §3).

| Metric | Definition |
|---|---|
| External cash | provider-confirmed, deduplicated receipts in the period |
| Recognized revenue | per your accounting rule; state it |
| Contribution | revenue minus direct supply cost, per side |
| Paid activation | accounts with first payment and first useful use |
| Repeat payment | payers in period P who also paid in P-1 |
| Qualified pipeline | opportunities by stage with entry evidence |
| Verified supply capacity | distinct, active, target-qualified, listed units; offered, registered and connected counts reported separately |
| Time to first useful result | signup or payment to first useful workload |
| Obligations past due | open support or promise cards past their due date |
| *If usage-billed:* wallet-funded spend | purchases paid from an existing balance (not new cash) |
| *If usage-billed:* recurring revenue | contracted recurring charges only; prepaid top-ups excluded |
| *If subscription:* MRR / ARR | active contracted recurring charges at period end |
| *If subscription:* gross / net revenue retention | recurring revenue kept from a start cohort, without / with expansion |
| *If subscription:* logo churn, renewals | accounts lost; contracts renewed versus due |
| *If internal service:* SLA attainment | requests met within SLA over requests due |
| *If internal service:* MTTR | mean time from incident detected to verified on the user path (lower is better) |
| *If internal service:* backlog age, cost to serve | age of open requests; run cost per fulfilled request |

- Use matured cohorts (period over the signups that had time to convert).
- Revenue needs every exclusion flag your ledger uses (unpaid, paid from balance,
  test); `SUM(price)` alone overstates it.
- Every number carries `period`, `source`, `completeness` and a `note` on what it
  does not prove.

## 6. Silent no-op audit

Enforcement that silently does nothing is the most expensive failure class. Run
these checks when a guard, sweep or exclusion is introduced and in the weekly
review:

- Alert when an enforcement query structurally selects zero rows. Confirm the
  field exists and match **values**, never `exists` on a field with a default.
- A guard that fails open on a missing field is not a gate. Test locked → allowed →
  unlocked with a throwaway account; let the server decide who is covered.
- Compare an exclusion or suppression set against the known total; an empty set on
  a non-empty base is a bug.
- Dedup by business-key window plus a unique index; identical-timestamp matching
  misses near-duplicates.
- Before trusting a zero or an "all", confirm the query can match a known positive.
- Confirm the verification command actually read the changed file (for example a
  typecheck that includes no sources, or `build | tail && echo OK`, which reports
  the exit code of `tail`). Capture exit codes explicitly:
  `cmd > log 2>&1; echo "exit=$?"`.
- When something works on the primary but not replicas, check which configuration
  each client actually reads.

## 7. Fairness rules

- Our own probe, credential or provider failures never count against a customer or
  supplier; keep them on separate counters.
- Only the absence of new occurrences (last-seen date) closes a recurring theme.
- A fix to one side of the ecosystem is checked for its effect on the other side
  before it ships.
