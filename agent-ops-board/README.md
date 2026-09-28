# agent-ops-board

An **autonomous company engine** for running a company, enterprise unit or
multi-sided ecosystem (customers, suppliers, partners, resellers) with AI agents.
One top authority (an owner, or an owner group with delegated human approvers) and
one coordinator agent set direction. Bounded executors do the work.
Every action is authorized, stoppable, done exactly once or marked uncertain,
verified at its source, and recorded on one persistent board.

```
 5. RECORD         board cards + threads, handoff note
 4. EVIDENCE       trust tiers, result stages, measurement contract
 3. ACTION SAFETY  side-effect state machine, idempotency, single-flight, reviewed batches
 2. CONTROL PLANE  kill switch, pauses, caps, outcome circuit breakers, audit log
 1. AUTHORITY      decision-rights matrix, owner policy register, autonomy ladder
```

The doctrine and most mechanisms come from production operation of a metered SaaS
with a supplier ecosystem, and generalize failures that actually happened there.
Parts marked **(design)** in `SKILL.md` (leases and fencing, scope-hash
acknowledgment, the ladder transition criteria, approver quorum, multi-tenant
operation, agent cost accounting) are recommended designs not yet proven in
production; `SKILL.md` lists both sides.

**A skill is not a runtime.** Continuous operation needs an installed scheduler
with a heartbeat, pause control and observable last-run status. The skill tells
the agent how to verify one exists and forbids claiming autonomy without it.

## Files

| File | Purpose |
|---|---|
| `SKILL.md` | Executable core: doctrine, required inputs, phases 0-8 with exit checks, autonomy ladder, handoff, anti-patterns |
| `references/authority-and-decision-rights.md` | Principals, decision-rights matrix, policy register, ladder, delegation lifecycle, ecosystem sides |
| `references/control-plane-and-observability.md` | Kill switch, pauses, guarded runner script, circuit breakers, snapshot, runtime lens, watchdogs |
| `references/intake-and-context.md` | Durable cursors, handled ledger, identity graph, context packet, support obligation, communication standard |
| `references/action-safety.md` | Side-effect state machine, idempotency, single-flight code, reviewed batches, reconciliation, money integrity |
| `references/evidence-and-metrics.md` | Trust tiers, verification recipes, result-stage evidence, measurement contract, silent no-op audit |
| `references/change-security-and-tenancy.md` | Production change protocol, incident loop, security playbooks, multi-tenant isolation, forward tests |
| `references/schemas.md` | Card, thread message, action record, policy entry, audit line, snapshot row, minimal board API contract, capability row, intake stores |
| `export-board.mjs` | Board helper: `export`, `health`, `post` (Node 18+, no dependencies) |

## Install

Copy this folder into `.claude/skills/` (project) or `~/.claude/skills/` (user).
For Cursor, Copilot or plain API use, paste `SKILL.md` as context and load a
reference file when a phase points to it.

## Quick start

1. Fill the **Required inputs** block in `SKILL.md`.
2. Create the control plane: `mkdir -p "$ENGINE_CONTROL_DIR/pauses"`, install the
   guarded runner from `references/control-plane-and-observability.md`, and prove
   that `touch "$ENGINE_CONTROL_DIR/KILL_SWITCH"` halts a test loop with an audit line.
3. Check the board:

```bash
export BOARD_API_URL=https://your-board.example.com/v1
export BOARD_API_TOKEN=...            # read access for export/health; write for post
node export-board.mjs health --out ./board-export   # exit 4 = findings to triage
node export-board.mjs --out ./board-export          # board.json + board.md
node export-board.mjs post <cardId> update.md       # write, then read back
```

## `export-board.mjs`

It needs a REST endpoint that lists cards and a thread endpoint per card. Paths,
response keys and paging parameter names are configurable below; a GraphQL board
(or anything else) needs a small adapter in front of it. A response the script
does not recognise is an error that names the keys it found, never an empty
board.

| Command | Writes to the board | Output | Exit codes |
|---|---|---|---|
| `export` (default) | never | `board.json`, `board.md`, `export-status.json` | 0 complete, 1 error or incomplete |
| `health` | never | `health.json`, `health.md` (`--json` also prints) | 0 clean, 4 findings, 1 read error |
| `post <cardId> <file> [--id <uuid>]` | one message | stderr verdict | 0 verified, 2 rejected, 3 UNCERTAIN |

- Requests are serial and paced. Reads retry on 429, 5xx, network errors and
  timeouts with bounded backoff that honours `Retry-After`. Writes retry only on an
  explicit rate limit.
- A failed export still writes what it read, with `incomplete: true` in
  `export-status.json` and INCOMPLETE in `board.md`.
- Secret-shaped strings (private keys, JWTs, bearer tokens, `password=`-style
  pairs, common API-key prefixes, long random tokens) and IPv4 addresses are masked
  in every output; `--no-redact` turns that off for a private local copy. `post`
  refuses a message that contains a secret-shaped string, and by default an IPv4
  address too (it also matches four-part version numbers). Teams whose incident
  notes need addresses set `BOARD_POST_REFUSE_IPS=0`.
- Cards from the archived listing are tagged `archived` even if the API omits the
  field; `health` skips them and `export` sorts them last.
- `health` reports stale cards, missing owner / next action / due date, overdue
  cards, `done` without a `Proof:` line, duplicate titles within a stream,
  unclassified statuses and streams, uncertain actions and unreadable threads.
  Owner, next action and due come from the card fields (`accountableOwner`,
  `nextAction`, `due`) or from the newest thread message carrying that line.
- `post` persists the client message ID to `<file>.pending.json` before posting.
  On exit 3, re-run the same command: it reconciles against the thread first and
  posts at most once, always with the same ID. The default ID is derived from the
  card and body, so posting identical text to the same card twice is a replay.
  Read-back matches on the client message ID; if the server stores none, a text
  match is accepted and reported as WEAK.
- If `post` exits 2 because `<file>.pending.json` holds an unreconciled post for a
  different card or body, the error prints that card, client message ID and body
  SHA-256. Re-run `post` with that card and the original body to reconcile. Delete
  the sidecar only after reading the thread and confirming it does not contain that
  client message ID; deleting it earlier can produce a duplicate.

| Variable | Default | Purpose |
|---|---|---|
| `BOARD_API_URL` | (required) | API base URL |
| `BOARD_API_TOKEN` | (required) | Token for the board |
| `BOARD_AUTH_HEADER` | `Authorization` | Header name. `Authorization` sends `Bearer <token>`; any other name (e.g. `X-API-Key`) sends the raw token |
| `BOARD_TASKS_PATH` | `/tasks` | Endpoint that lists cards |
| `BOARD_LIST_KEY` | (auto: `tasks`, `items`, `data`, `results`) | Response key holding the card array, dotted for nesting (e.g. `issues`) |
| `BOARD_THREAD_KEY` | (auto: `messages`, `items`, `data.messages`) | Response key holding the thread array (e.g. `comments`) |
| `BOARD_ARCHIVED_PARAM` | `archived=true` | Query string that lists archived cards |
| `BOARD_MESSAGES_PATH` | `/tasks/{id}/messages` | Thread endpoint, GET and POST (`{id}` is replaced) |
| `BOARD_DELAY_MS` | `1500` | Pause before every request |
| `BOARD_PAGE_MODE` | `none` | Card-list paging: `none`, `cursor`, `offset` or `page` |
| `BOARD_PAGE_SIZE` | `100` | Card page size |
| `BOARD_LIMIT_PARAM` | `limit` | Page-size parameter for cards and threads (e.g. `per_page`, `maxResults`) |
| `BOARD_OFFSET_PARAM` | `offset` | Parameter for `offset` mode (e.g. `startAt`) |
| `BOARD_PAGE_PARAM` | `page` | Parameter for `page` mode |
| `BOARD_CURSOR_PARAM` | `cursor` | Query parameter for `cursor` mode (next value read from `nextCursor`, `next_cursor`, `cursor.next`, `pageInfo.endCursor` or `next`) |
| `BOARD_THREAD_LIMIT` | `50` | Thread page size |
| `BOARD_THREAD_CURSOR_PARAM` | `before` | Thread cursor parameter (value: `nextBefore` or the last message id; pages are read newest first) |
| `BOARD_STATUSES` | `todo,in_progress,done` | Known statuses in order; the last one means verified. Others are reported as unclassified. Record blocked work with a blocker field or label, or add a status such as `blocked` here |
| `BOARD_STALE_HOURS` | `72` | Active card with no update for this long is stale |
| `BOARD_MESSAGE_FIELD` | `text` | Body field name for `post` |
| `BOARD_MESSAGE_ID_FIELD` | `clientMessageId` | Idempotency field name for `post` and read-back |
| `BOARD_POST_REFUSE_IPS` | `1` | `1`: `post` refuses IPv4 addresses; `0`: allows them (exports still mask) |

With `BOARD_PAGE_MODE=none`, a card list whose length is a multiple of 25 triggers
a truncation warning: set the paging mode your API supports. A board built to the
minimal contract in `references/schemas.md` §K uses `BOARD_PAGE_MODE=cursor`.

## Security

Exports and health reports are internal business data. Files are written `0600`
in a `0700` folder. Never commit them, publish them or paste them into a public
issue. Keep tokens in environment variables, never in files next to the export.

## License

MIT.
