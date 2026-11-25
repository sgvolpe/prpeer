# prpeer TODO

## Integrations (plugged in from Connections, like Jira)
Today there are: GitHub, AI providers and Jira (`/api/integrations`, one row per integration in `web/home.js`).
Ideas, in order of value for reviewing a PR:
- **CI status**: failed checks already mark their files on the map; still missing: cross them with the story pages and pass them to the AI reviews.
- **Linear / GitHub Issues** as an alternative to Jira (same flow: key in title/branch/commits → ticket content).
- **Sentry**: recent errors in the files the PR touches.
- **Confluence / Notion**: design doc linked from the ticket.
- **Slack**: post the story or the result of a review to a channel (outbound action: ask for confirmation).

## Review
- Show progress while the AI builds the story (on big PRs the batch summaries run first, with no feedback yet).
- Reviewed marks: keep the ones whose file did not change in a new push (today a new head starts over).
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
