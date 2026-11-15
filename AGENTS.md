# Instructions for AI assistants

This file is for any AI model working in this repository (Claude, ChatGPT, Codex, Copilot or other). `CLAUDE.md` carries the same rules plus Claude-specific tooling.

1. **Read `STATUS.md` first.** It says what the project is, what is live, what is in progress, what is planned, and which decisions are settled.
2. **Then read the map for the area you are changing:** `web/README.md` for the site, `pipeline/README.md` for the data build, `docs/data-dictionary.md` for the data contract.
3. **Keep the organisation.** Put new code in the folder for its concern as those maps describe. Start every file with a short comment saying what it is for. Reuse the shared helpers (formatting, wording, URLs, downloads, normalisation); do not copy them. Split a file before it passes about 400 lines.
4. **Respect the settled decisions** listed in `STATUS.md` (privacy, wording, amounts as ranges, what counts as a tie, colour meaning). Ask the owner before changing any of them.
5. **Verify before proposing a merge:** `python -m pipeline.validate` (0 failures), `python -m pytest pipeline/tests`, and in `web/`: `npm run build` and `npm test`.
6. **Never commit secrets or generated data.** Keys live in GitHub secrets. Generated data lives in the R2 bucket, not in git.
7. **Update `STATUS.md` in the same change** whenever what is live, in progress or planned has changed.
8. **Do not push unfinished work to a branch that has an open pull request.**
