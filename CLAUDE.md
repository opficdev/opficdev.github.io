# opficdev.github.io Claude Code Bootstrap

## Scope

- These instructions apply to the repository root.
- Active AI working rules live in Notion under `Blog Agent Policy`.
- This file is a bootstrap document only. Do not add project policy content here.

## Required policy loading

Before planning, editing, reviewing, verifying, or performing an external write:

1. Fetch the [Blog Agent Policy](https://app.notion.com/p/3f1b88a8aa5481e1917dd0bd29c55803) index through the connected Notion MCP.
2. Verify that the index is under the [opficdev.github.io](https://app.notion.com/p/3f1b88a8aa548166b719cb9327172233) page and use only policies marked `Active` in that index.
3. Load [General](https://app.notion.com/p/3f1b88a8aa5481dd8266e65ad68f6b92), [Blog](https://app.notion.com/p/3f1b88a8aa5481ab8791c671f3c72b8c), and [Claude Code](https://app.notion.com/p/3f1b88a8aa5481b9b1f0c38d66fc9605) for every task.
4. Load [Project Workflows](https://app.notion.com/p/3f1b88a8aa54818ea543f76644919e7d) for builds, commits, PRs, deployment, or CI.

If Notion MCP or a required active policy is unavailable, stop the task and report the unavailable policy. Do not use stale memory as a fallback.

## Source boundaries

- Active Notion policies are the source of AI working rules.
- Current repository code, configuration, layouts, CI workflows, and published posts are the source of implementation facts.
- Active Notion policies and current repository evidence take precedence over global Claude memory and global `~/.claude` instructions.
- Keep credentials, tokens, and private configuration out of this repository.
