# Congressional Trading Map

## Skills and plugins

This repo ships its Claude Code setup so cloud sessions get the same tools as local ones:

- `.claude/skills/find-docs`: Context7 docs lookup via `npx ctx7@latest`
- `.claude/skills/impeccable` → `.agents/skills/impeccable`: frontend design skill
- `.claude/settings.json` enables plugins: `superpowers`, `context7` (MCP), `data`, `engineering`

| User says / task | Use |
|---|---|
| "context7", "check the docs", any library, framework, SDK, API, or CLI question | `find-docs` skill (or the `context7` MCP tools when connected). Use it even when you think you know the answer. |
| "impeccable", `/impeccable <command>`, any UI or visual design work | `impeccable` skill. Pass sub-commands (e.g. `critique`, `polish`, `audit`) as args. |
| Data analysis, SQL, dashboards, charts | `data:*` skills (e.g. `data:analyze`, `data:write-query`, `data:build-dashboard`) |
| Code review, debugging, system design, docs, testing strategy | `engineering:*` skills |
| New features, plans, bugs, TDD | `superpowers:*` skills (brainstorming, writing-plans, systematic-debugging, test-driven-development) |

## Rules

- For UI work that uses a library (Tailwind, a map library, a charting library), use `impeccable` for design and `find-docs` for that library's API.
- Do not run `impeccable hooks on` unless asked.
- Impeccable downloads its engine binary from github.com on first use, and `find-docs` needs the npm registry and context7.com, so cloud environments need network access to those hosts.
