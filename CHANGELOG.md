# Changelog

All notable changes to PR Peer. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- One-step installers, `install.ps1` (Windows) and `install.sh` (macOS, Linux, WSL). They install what is missing (git, Node 24, Python 3, optionally gh) with winget, Homebrew, nvm or the distro's package manager, asking first (`-Yes` / `-y` to accept all).
- On Windows, the installer detects a real Python hidden behind the Microsoft Store alias and offers to put it first in the user `PATH`.
- `prpeer doctor`: checks Node, git, Python, dependencies and build, the `prpeer` command, GitHub credentials, the AI provider and the port, with the command that fixes each problem.
- The `prpeer` command repairs itself: on an old Node it explains how to update instead of crashing, and on a fresh copy it installs dependencies and builds the map on first run.
- Startup header with the PR Peer logo in ASCII and a random quip, in the CLI and the installers.
- Author intents: inline review comments that start with `#i-<id>` are grouped by intent and passed to the AI as "Author intents" in the story and every review. See `GUIA-PR-PEER.md`.
- Home: search PRs and commits of an owner across all its repos (type the owner or `@owner`), with state filter and server-side search on GitHub (`GET /api/search`).
- Author filter asks the source (GitHub search / `git --author`) instead of filtering only the loaded items.
- Map: smooth inertial wheel zoom anchored to the cursor; focus-based opening (more code for cards near the cursor) and dimming of out-of-focus cards; pan limited to the content.
- Map: right-click menu for cards, folders and background (pin open, explain with AI, relations, fit, levels, use view as context).
- AI context includes what is on screen (`view` in `/api/ask`), listed as "In view" in the Assistant.
- Jira ticket section in the Assistant and ticket key link in the map bar; Jira now brings type, priority, assignee and a longer description.
- Animated loader with rotating lines while the story is built.
- Friendly 404 page for unknown sessions (`/pr/<id>`), localized, with a link back home.
- `--serve` opens the browser (`--no-open` to skip) and `-v` / `--verbose` logs one line per API request.
- README: install guide, tour of the demo with screenshots and GIFs, review workflow, troubleshooting, WSL notes and how to re-record the media.

### Changed
- Shared design layer `web/ui.css` for home and PR pages (cards, motion, skeleton loaders, glass panels); respects `prefers-reduced-motion`.
- New favicon and logo (the two eyes).
- The project is now called PR Peer everywhere: folder `prpeer/`, command `prpeer`, package name, UI texts, `x-prpeer` headers, `PRPEER_*` environment variables, `prpeer-*` browser storage keys.
- User files moved from `~/.prmap` to `~/.prpeer`; the per-repo file is now `.prpeer.json`; the config file is `prpeer.config.json`.
- Screenshots and GIFs re-recorded with the English UI and a real Python, so they show functions and linked files.

### Security
- The GitHub token reaches git through `GIT_CONFIG_*` env vars instead of `-c` on the command line, and only over https to `github.com` or the `cloneUrl` host.
- `demo --dir` only replaces an empty folder or a previous demo repo.

### Migration
- Move `~/.prmap` to `~/.prpeer` to keep saved connections.
- Rename `.prmap.json` to `.prpeer.json` in your repos.
- Map positions, theme and custom CSS stored in the browser start fresh once.
- If you had a global `prmap` command, uninstall it (`npm uninstall -g prmap`) and run the installer.
