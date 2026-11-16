# Facts, promises and case packs

Loaded by Phase 0 (fact source), Phase 3 (operating cycle) and Phase 5 (scheduled
promises). What an agent may say, what it has promised, and what it must know
about a person before it answers.

## 1. One generated fact source

Agents quote facts to customers, suppliers and partners: prices, stock, coverage,
features, limits. Each quoted fact comes from **one generated source**, never from
a prompt, a memory note or an old message.

- One generator builds the fact sheet from the systems of record on a schedule.
  It is the only writer. Name it in `SYSTEMS_OF_RECORD`.
- **Edit the generator, never its output.** A sheet rebuilt hourly by a script
  silently undid hand corrections made to the sheet itself.
- Every fact carries its **conditions**: a price with its volume tier, region and
  product; a stock count with the pool, place and time it was read; a feature with
  the plan that includes it. Shape in `schemas.md` §P.
- **A price quoted without its condition is a wrong price.** A volume price sent
  to a small buyer is a commitment the company never made.
- Facts that expire (stock, availability, status, "fixed") carry `observedAt` and
  an expiry. Past expiry they are not quoted; the sender reads them live instead.
- Facts that are policy, not data (what is not offered, who decides a discount),
  are `standing` entries in the policy register (`authority-and-decision-rights.md`
  §3). The generator reads them from there.

**Send-time allow-list.** Every outbound message on every channel (mail, chat,
tickets, public posts) passes one check before `ready`:

1. Extract each quotable claim (amounts, counts, named features, dates).
2. Match it to a fact-sheet row whose conditions fit this recipient.
3. Re-read any expiring fact live.
4. No match, or a match whose conditions do not fit, holds the draft with reason
   `fact-not-allowed`. The fix is a fact-sheet row, not an edited draft.

The check is part of the content sanity gate (`action-safety.md` §7). A channel
that skips it is a channel that can misquote.

## 2. Promises are records

A promise is anything the company said it would do for someone: a reply, a fix,
a page, a call back, a credit the owner approved, a follow-up on a date. It is a
first-class record, not a sentence buried in a thread.

- Record it when it is made: who it is to, what exactly, the accountable owner, a
  due date and the source message. Shape in `schemas.md` §N.
- On the card thread, a `Promise:` line carries it so `export-board.mjs health`
  can see it (format in SKILL.md Phase 6). The newest line for an id is its state.
- States: `open`, `kept` (with proof the person received the outcome), `released`
  (the person or the owner withdrew it, with the source).
- **Every cycle begins by listing open promises past due**, ranked with incidents
  (SKILL.md Phase 3, rank rule). They resurface every cycle until kept or
  released.
- **A card cannot close while a promise on it is open.** `health` reports
  `done_with_open_promise` and `promise_overdue`; the owner brief lists both as
  RED items.
- "Reply soon" is a promise with a due date. If no date was said, the due date is
  the channel's normal answer time, and it is recorded that way.
- A kept promise needs the same evidence as any outcome: a page that returns 200
  with the promised content, a delivered message, a ledger row. Saying it is done
  is not keeping it.

One audit found ten unkept promises, including partner pages that returned 404
and a chat left on "reply soon" for seventeen days.

## 3. Scheduled promises execute themselves (design)

A dated commitment ("your plan changes on the first of the month", "the trial
ends Friday, then we switch you back") must not depend on a session being awake
on that date.

- Turn it into a **timer that acts**: a scheduled job under the guarded runner
  (`control-plane-and-observability.md` §2) with one action key.
- The job performs the change, verifies it at the source, and **reverts on a
  failed verification**.
- It sends its own notice to the person through the normal send path.
- If the notice fails, it leaves a flag on the card (`uncertain` label and a
  RED item). It never retries the notice blindly.
- It closes the promise only on a verified change and a delivered notice.
- **Rehearse it on scratch state first**: a throwaway account, a test date, the
  full act, verify, revert and notice path. Record the rehearsal on the card.

## 4. Case pack before any reply

The context packet (`intake-and-context.md` §4) becomes a **case pack**: one
lookup, keyed on the canonical account ID, that any operator runs before a reply
on any channel. It returns:

| Field | Source |
|---|---|
| account state, plan, role | system of record |
| money: payments, balance, open invoices | billing ledger, payment provider |
| usage: last use, volume, errors | usage ledger |
| notes from every channel | CRM, chat, mail, tickets, calls |
| open tickets | ticket system |
| mail both ways | inbox and sent archive, full history |
| open promises | promise records (§2) |
| opt-out and contact holds | suppression store |
| attachments on the thread | opened and summarized as data |

Rules:

- **Outcomes come from the system of record**, never from what the conversation
  claims. "We paid", "it works now" or "you promised" is checked against billing,
  usage and the promise records before the reply relies on it.
- **Attachments are context.** A tool that cannot open them hides evidence. A
  partner's screenshots sat unreviewed for eleven days because the mail tool
  could not open attachments. If a channel's tool cannot read attachments, the
  case pack says so and the item goes to a human or a tool that can.
- A field that could not be read is `unknown` in the pack, and the reply does not
  rely on it (doctrine 10).
- The pack is rebuilt immediately before sending. If anything moved, the draft is
  stale.
