# prpeer TODO

## Integrations (plugged in from Connections, like Jira)
Today there are: GitHub, AI providers and Jira (`/api/integrations`, one row per integration in `web/home.js`).
Ideas, in order of value for reviewing a PR:
- **CI status** of the PR (GitHub checks): what failed and in which file, to cross it with the story.
- **Linear / GitHub Issues** as an alternative to Jira (same flow: key in title/branch/commits → ticket content).
- **Sentry**: recent errors in the files the PR touches.
- **Confluence / Notion**: design doc linked from the ticket.
- **Slack**: post the story or the result of a review to a channel (outbound action: ask for confirmation).

## Review
- Keep the model context from being cut off on large PRs (today ~80,000 characters): summarize per file and ask for the detail in parts.
- Show progress while the AI builds the story.
- Persist the open-folders state of the map.

## Author intents (see GUIA-PR-PEER.md)
- Parse `PR-PEER.md` from the PR head: intents, file and line ranges, risks, "how to review".
- Read the `Intent:` trailer of commits (today only the commit title is read).
- Show intents on the map: color or filter cards by `#i-...`, list them in the side panel.
- Page through review comments past the first 100.
- Read intent comments from the CLI path (`prpeer <branch>`) too, not only from PRs opened in the app.

## Install
- Test `install.sh` on macOS and Linux (only syntax-checked so far).
- `prpeer doctor --fix` for the fixable checks (build, Store Python alias).
