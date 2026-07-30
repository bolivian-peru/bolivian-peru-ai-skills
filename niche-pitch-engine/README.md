# niche-pitch-engine

A **verified B2B outreach pipeline** in one skill: give it your offer and a niche, and the
agent researches how that industry *actually* assigns work, builds a deterministic target
shortlist, writes one researched dossier + two-step pitch per company in the target
language, adversarially QAs every claim, and persists everything to a human approval queue
behind a hard-coded send gate. **No invented facts, no fake social proof, no autonomous
sending — ever.** Proven in production for a construction brand and an IT consultancy in
Lithuania; every rule was extracted from that pipeline, not theorized.

## Files

| File | What it is |
|---|---|
| [`SKILL.md`](./SKILL.md) | The skill. Core doctrine, the operator input block, Phases 0–7 (facts whitelist → industry mechanics → segmentation → dossiers → pitches → adversarial QA → strategy → persistence + send gate), an EU compliance checklist, copy-pasteable JSON schemas, a real production pitch as the quality bar, a worked instantiation for a second niche (data products), 11 anti-patterns from real failures, and the multi-agent orchestration layout. |

## The one idea

Cold outreach that converts is a **research problem with a truthfulness constraint**, not a
copywriting problem. So the skill spends its effort where it pays:

- **OUR_FACTS whitelist** — the only permitted claims about yourself, injected verbatim
  into every agent; anything beyond it gets struck by QA.
- **Industry-mechanics-first** — research who actually assigns the work and through which
  channel *before* picking targets (the one time we skipped this, the shortlist was
  rejected and the real entry channel turned out to be something else entirely).
- **Adversarial QA** — an independent agent tries to refute every claim in every pitch;
  nothing unverified is sent or sold. Abstain never counts as a pass.
- **Hard send gate** — opt-out suppression → dedup → SQL-enforced daily caps → mandatory
  legal footer → human-set `approved`. The LLM cannot override any step; a human clicks
  every send.

## Use it

Drop this folder into your agent (`.claude/skills/`, or paste `SKILL.md` into
Cursor/Copilot/any LLM agent), fill in the **Required inputs from the operator** block
(offer, facts whitelist, niche, market, sending identity, caps, escalation contact), and
ask: **"Follow this skill to build a pitch campaign for <niche>."** The agent runs the
phases and ends with a persisted, QA'd approval queue — the sending decision stays with
you.

## What to copy vs. swap

- **Copy verbatim:** the core doctrine, the untrusted-data clause, the QA designs and
  quorum rule, the send-gate order, the halt conditions, the anti-patterns.
- **Swap per campaign:** OFFER + OUR_FACTS, the niche nouns in the research prompts, the
  segmentation filters, the target language, and the per-country legal bases (check the
  recipient country's ePrivacy transposition before send #1 — the skill insists).

MIT.
