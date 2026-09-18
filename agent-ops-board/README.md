# agent-ops-board

Run a business or engineering operation with AI agents through **one persistent task board**, and export that board safely.

- **Coordinator / executor contract:** the owner and one coordinating agent set direction; bounded executors do the work and report evidence.
- **Board discipline:** every material outcome and next action is written to the board with evidence (versions, IDs, counts, timestamps), then read back through the same API the board UI uses.
- **Decision boundaries:** what an agent may do alone, and what always goes to the owner (money, suspensions, legal, deleting data).
- **Safe export:** `export-board.mjs` dumps every card and its full thread to `board.json` + `board.md`: paced, rate-limit aware, read-only, private file permissions.

## Install

Copy this folder into `.claude/skills/` (project) or `~/.claude/skills/` (user). For Cursor, Copilot or plain API use, paste `SKILL.md` as context.

## Export a board

```bash
BOARD_API_URL=https://your-admin.example.com/v1 \
BOARD_API_TOKEN=your-token \
node export-board.mjs --out ./board-export
```

| Variable | Default | Purpose |
|---|---|---|
| `BOARD_API_URL` | (required) | API base URL |
| `BOARD_API_TOKEN` | (required) | Token with read access to the board |
| `BOARD_TASKS_PATH` | `/tasks` | Endpoint that lists cards |
| `BOARD_ARCHIVED_PARAM` | `archived=true` | Query string that lists archived cards |
| `BOARD_MESSAGES_PATH` | `/tasks/{id}/messages` | Thread endpoint (`{id}` is replaced) |
| `BOARD_AUTH_HEADER` | `Authorization` | Header name; `Authorization` sends `Bearer <token>`, any other name sends the raw token |
| `BOARD_DELAY_MS` | `1500` | Pause between requests |

The export is internal data: keep it out of Git and public places.

## License

MIT.
