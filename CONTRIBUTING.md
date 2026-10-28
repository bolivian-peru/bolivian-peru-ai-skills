# Contributing

This library has a high, specific bar. A skill belongs here only if:

1. **It's real.** You actually built and shipped what the skill produces. No theoretical
   prompts, no "this should work."
2. **It analyzes real systems — no mock data.** The skill must instruct the agent to read
   the user's actual code/config and verify every output against a real file. If a value
   can't be verified, the skill must tell the agent not to show it.
3. **No fluff.** Concrete steps, real code, real gotchas. Written to be *executed* by an
   agent, not admired. Cut anything that doesn't change what the agent does.
4. **Self-contained.** A reader with only the `SKILL.md` (plus any helper files in the same
   folder) can reproduce the result on their own project.

## Layout

```
<skill-name>/                 # a top-level folder in the repo root
├── SKILL.md          # Anthropic-format frontmatter (name + description) then the body
└── <helpers>         # any scripts/templates the skill references
```

The folder name MUST match the `name:` in the frontmatter.

## Frontmatter

```yaml
---
name: my-skill-name              # == folder name, kebab-case
description: >                   # the trigger — what it does + when to use it.
  One or two sentences an agent uses to decide relevance. Lead with the capability,
  then the trigger phrases a user might say.
---
```

## PR checklist

- [ ] Folder name == `name:` in frontmatter
- [ ] You shipped this; link the live result if public
- [ ] No mock data — the skill verifies against real code
- [ ] An agent can execute it end-to-end without you in the loop
- [ ] Added a row to the Skills table in the root `README.md`
- [ ] Added a row to `assets/og/skills.json` and ran `node assets/og/build.mjs` (preview card + share page)

Open an issue first for anything non-trivial. MIT-license your contribution.
