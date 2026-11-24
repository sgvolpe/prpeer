<p align="center">
  <img src="prpeer/docs/logo-peer.gif" alt="PR Peer logo" width="72">
</p>

<h1 align="center">PR Peer</h1>

<p align="center">
  <b>Understand a Pull Request at a glance.</b><br>
  PR Peer turns the diff of a PR, a branch or a commit into a map of folders and files, points out where to start,<br>
  and lets you ask an AI questions without leaving the screen.
</p>

<p align="center">
  Local-first · runs on <code>127.0.0.1</code> · Node 24 · GitHub, local git and Jira · Claude or any OpenAI-compatible model
</p>

![PR Peer walkthrough on a sample PR](prpeer/docs/demo-historia.gif)

## Contents

- [Why](#why)
- [Install](#install)
- [Try it in a minute](#try-it-in-a-minute)
- [A tour of the demo](#a-tour-of-the-demo)
- [Usage](#usage)
- [The interface](#the-interface)
- [Reviewing a PR with PR Peer](#reviewing-a-pr-with-pr-peer)
- [Writing PRs that PR Peer understands](#writing-prs-that-pr-peer-understands)
- [Connections](#connections)
- [Configuration](#configuration)
- [Languages](#languages)
- [Supported code languages](#supported-code-languages)
- [Security and privacy](#security-and-privacy)
- [Windows and WSL](#windows-and-wsl)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## Why

A flat diff shows which lines changed, not how they relate or which ones matter. PR Peer adds what is missing:

- **Structure:** changed files grouped by folder, with how much each one changed and in which functions.
- **Priority:** a risk light per file (calm, attention, risky) that explains its reasons.
- **Context:** files that did not change but depend on what did (the *linked* ones), where breakage tends to hide.
- **Questions:** an AI that answers with the PR's code at hand, plus the ticket, the commits and the author's own notes.

| Flat diff | PR Peer |
|---|---|
| A list of files in alphabetical order | Files grouped by folder and module, sized by change |
| Every file looks equally important | A risk light that says *why* a file deserves attention |
| Only what changed | Also what did not change but depends on it |
| Context lives in your head | Ticket, commits, comments and docstrings next to the code |

## Install

### Requirements

| Tool | Version | Why |
|---|---|---|
| [Node.js](https://nodejs.org) | 24 or later | Runs PR Peer (TypeScript runs natively, no build step for the server). |
| [git](https://git-scm.com) | any recent | Reads diffs and creates temporary worktrees. |
| [Python](https://python.org) | 3.x | Only to analyze Python repos. On Windows, the Microsoft Store alias does not count. |
| [gh](https://cli.github.com) | optional | Open PRs by number and read private GitHub repos (`gh auth login`). |

You do not need to install these first: the installer finds what is missing and installs it for you.

### Steps

1. **Download PR Peer** and unzip it (or copy the folder) anywhere you like. The folder holds `install.ps1`, `install.sh` and the `prpeer/` app.
2. **Run the installer** from that folder:

   **Windows (PowerShell):**

   ```powershell
   powershell -ExecutionPolicy Bypass -File install.ps1
   ```

   **macOS, Linux and WSL:**

   ```bash
   sh install.sh
   ```

3. **Open a new terminal** and run:

   ```bash
   prpeer --serve                                   # home screen
   prpeer https://github.com/owner/repo/pull/123    # straight to a PR
   ```

The installer asks before installing anything; add `-Yes` (Windows) or `-y` (macOS/Linux) to accept everything. It:

1. **Installs what is missing:**

   | | Windows | macOS | Linux / WSL |
   |---|---|---|---|
   | git | winget `Git.Git` | Homebrew (or Xcode command line tools) | apt / dnf / pacman / zypper |
   | Node 24 | winget `OpenJS.NodeJS.LTS` | nvm, in your home (no sudo) | nvm, in your home (no sudo) |
   | Python 3 | winget `Python.Python.3.13` | Homebrew | apt / dnf / pacman / zypper |
   | gh (optional) | winget `GitHub.cli` | Homebrew | the distro's package |

2. **Fixes the Microsoft Store Python trap** on Windows: if a real Python is installed but the Store alias wins on `PATH`, it offers to put the real one first in your user `PATH`.
3. Runs `npm ci` in `prpeer/` (installs dependencies and builds the map).
4. Registers the global `prpeer` command, linked to the downloaded folder: do not move or delete that folder afterwards.
5. Finishes with `prpeer doctor`, so you see what is ready and what is optional.

### It repairs itself

The `prpeer` command starts with a small launcher with no dependencies:

- If Node is older than 24, it says so and tells you how to update, instead of crashing.
- If the dependencies or the map build are missing (a fresh copy, a cleaned folder), the first `prpeer --serve` installs them by itself and then starts.

### prpeer doctor

Run it any time something looks off:

```bash
prpeer doctor
```

```
prpeer doctor: the duck checks your setup

  [ok]   Node.js                  24.21.0
  [ok]   git                      2.56.0
  [warn] Python 3                 installed but the Microsoft Store alias comes first on PATH
         fix: move ...\Python314 before ...\WindowsApps in your user PATH
  [ok]   Dependencies and build   in place
  [ok]   prpeer command           ...\npm\prpeer.cmd
  [ok]   GitHub                   gh is logged in
  [warn] AI                       no provider (optional: the map works without it)
         fix: export ANTHROPIC_API_KEY=..., or add one from the Connections button
  [ok]   Port 4173                free

Ready to go. 2 optional thing(s) could be better.
```

It checks Node, git, Python (including the Store alias), the dependencies and build, whether `prpeer` is on `PATH`, GitHub credentials, an AI provider and the port. Each problem comes with the command that fixes it. Exit code 1 means something required is missing.

**Update:** replace the folder with the new download and run the installer again. **Uninstall:** `npm uninstall -g prpeer`, then delete the folder (and `~/.prpeer` if you also want to remove saved connections and cloned repos).

On Linux, if the global install fails for lack of permissions (a system Node owned by root), use [nvm](https://github.com/nvm-sh/nvm), whose global folder is in your home, or follow the `sudo` hint the installer prints.

### Without the installer

```bash
cd prpeer
npm ci              # installs and builds the map ("prepare" script)
npm link            # optional: global `prpeer` command
```

Without `npm link`, run it from that folder with `node bin.mjs` (or `node prpeer.ts` once the dependencies are installed).

### Set up connections

All optional; PR Peer works on local repos with none of them. Set them from the **Connections** button on the home screen, or see [Connections](#connections):

- **GitHub:** `gh auth login` or `GITHUB_TOKEN` (read-only).
- **AI:** `ANTHROPIC_API_KEY`, an OpenAI-compatible provider, or your Claude Code subscription.
- **Jira:** `PRPEER_JIRA_URL`, `PRPEER_JIRA_EMAIL`, `PRPEER_JIRA_TOKEN`.

## Try it in a minute

```bash
cd prpeer                 # inside the downloaded folder
npm run demo              # builds a sample repo with a PR and opens it in the browser
```

`npm run demo` creates a repo in the temp folder with a `feature/partial-refunds` branch against `main` and opens PR Peer on that diff. To keep the repo somewhere else: `npm run demo -- --dir ./demo-shop`.

## A tour of the demo

The sample PR adds partial refunds to a shop: 8 files, +220 −4. It is built to show every capability, with a few flaws planted on purpose.

### 1. The PR at a glance

Eight files grouped by folder (`payments/`, `orders/`, `api/`, `notifications/`, `db/`). Tests are hidden so the map shows product code first. Every card shows its added and removed lines and how many functions it touches.

![Overview of the sample PR](prpeer/docs/01-vista-general.jpg)

### 2. The risk light

`refunds.py` and `gateway.py` come out **risky**: other files use them, no test imports them, they mention «payment» and they sit on a sensitive path. The panel on the right lists the reasons, so the light is never a black box.

![Risk light with reasons in the side panel](prpeer/docs/02-semaforo.jpg)

### 3. What did not change

With **show linked**, `revenue.py` and `dashboard.py` appear in blue: they are not in the diff but depend on what changes. The first does not subtract refunds and the second fails with the new state. Selecting a file draws its relations in white.

![Linked files that are not in the diff](prpeer/docs/03-vinculados.jpg)

![Clip: turning linked files on and following relations](prpeer/docs/clip-linked.gif)

### 4. The code, without leaving the map

Zoom is semantic: whatever is under the cursor opens as you zoom in. Zoomed in far enough, each card shows the added lines of its functions.

![Cards showing the changed code when zoomed in](prpeer/docs/04-zoom-codigo.jpg)

![Clip: semantic zoom from folders to code](prpeer/docs/clip-zoom.gif)

### 5. By module

**Close all** and **Open one level**: `payments` gathers the risky files, `orders` and `db` call for attention. Useful to split a large PR between reviewers.

![The map collapsed to module level](prpeer/docs/05-modulos.jpg)

![Clip: opening and closing folder levels](prpeer/docs/clip-levels.gif)

The full script, with the planted flaws and how to re-record the screenshots, is in [demo/HISTORIA.md](prpeer/demo/HISTORIA.md).

## Usage

```bash
prpeer --serve                        # home screen: pick a repo and open a PR, branch or commit
                                      # in the search box, type an owner (or @owner) to search PRs and commits across all its repos;
                                      # the Author field asks the source again (any login, not only loaded items)
prpeer 123 --serve                    # PR #123 of the current repo (needs gh and a clone with origin)
prpeer https://github.com/o/r/pull/123   # a GitHub PR URL needs no --serve and no local clone
prpeer my-branch --base main --serve  # a branch against main
prpeer my-branch --links              # no server: summary in the terminal
prpeer doctor                         # check the setup
```

It opens in your browser by itself and greets you with the logo and a random quip; Ctrl-C stops it. Without the global command, use `node bin.mjs` inside the prpeer folder instead of `prpeer`.

| Option | What it does |
|---|---|
| `--serve` | Starts the web interface. Without a PR, it opens the home screen. |
| `--port N` | Port (default 4173). |
| `--no-open` | Does not open the browser. |
| `-v`, `--verbose` | One line per API request (method, path, status and duration; no query or body). Internal errors are always printed. |
| `--base <ref>` | Base branch or commit. Defaults to `origin/HEAD`, or `main` / `master`. |
| `--repo <folder>` | Repo to analyze (defaults to the current directory). |
| `--json` | Prints the full analysis as JSON (without `--serve`). |
| `--sections`, `--links`, `--max-links N` | Per-function detail and links in the terminal. |
| `--keep` | Keeps the temporary worktree. |
| `--config <file>` | Your own configuration (see below). |
| `doctor` | Checks the setup and prints how to fix what is missing (see [prpeer doctor](#prpeer-doctor)). |

PR Peer never touches your working copy: it analyzes the PR in a temporary `git worktree` and removes it on exit.

## The interface

Three panels: **worktree** on the left, **map** in the middle and **Assistant** on the right.

**Map.** Each folder is a block that opens and closes; each file is a card with its added and removed lines and its functions.
- Zoom bar at the top: − / slider / +, percentage (one click goes back to 100%) and **Fit everything**.
- Folder levels: **Close all**, **Close one level**, **Open one level** and **Open all**.
- Zoom is smooth and semantic: the wheel zooms with inertia toward the cursor, and each card on screen gets a *focus* from the zoom and its distance to the cursor. More focus shows more lines of code; out-of-focus cards are dimmed. Selected and pinned cards stay at full strength.
- The view stays around the content (you cannot pan off into empty space).
- A minimap in the corner shows where you are in large PRs.
- You can drag top-level folders and widen open ones from the right edge; positions are remembered in the browser.

| Shortcut | Action |
|---|---|
| `+` / `-` | Zoom in / out |
| `0` | Fit everything |
| `[` / `]` | Close / open one folder level |

**Right-click menu.**
- On a card: pin it open (always in the AI context), explain it with AI, show its relations, explain how the selected N relate, center, copy path, show only this file.
- On a folder: fit it, keep only this one open, explain the module.
- On the background: fit everything, open/close one level, close all, use what I see as context.

**Risk light.** Each file adds up points and the panel says why:

| Signal | Points |
|---|---|
| Changed lines | lines / 150, up to 3 |
| How many files use it | 0.7 per file, up to 2 |
| No test imports it | 1 |
| Mentions a sensitive word (`auth`, `payment`, `token`, `migration`…) | 0.8 |
| Path marked as sensitive in the configuration | its weight |

Below 2 is *calm*, below 3.5 *attention*, and from there on *risky*. Tests and `CHANGELOG` do not score (adjust with `ignore`).

**Linked.** Files that did not change but import what did (or the other way around). They show in blue with **show linked**; when you select a file, its relations are highlighted in white.

**Hide.** You can hide files or folders from the map and show them again. The worktree search box filters by name or extension (`.md`, `*.sh`, `test`).

**Side panel.** For the selection: summary, risk reasons, what changed, the file's docstring, the folder's `README.md`, who uses it and what it uses, and **View full diff**.

**Local security scan.** Looks for secrets and dangerous patterns only in the lines the PR adds, with no AI and no network.

**AI Assistant.** Summary and explanation of the PR or of the selection, chat with the chosen context, the PR story and reviews:

| Tool | What it checks |
|---|---|
| Story | What the PR does and why, from the diff, the ticket, the commits and the author's intents |
| Coherence | Ticket, changelog and diff tell the same story |
| Comments | Pending review comments and whether the diff answers them |
| Security | Injection, auth, secrets, SSRF… and confirms or dismisses the local scan findings |
| Tests | Logic that changed without a test |
| Breakage | Changes that may break files outside the diff |

Drag files from the map onto the panel to add them to the context; suggestions propose neighbors (same folder, importers). What is on screen is also context: the panel lists it under **In view**, and each question sends the full code of in-focus functions, a cut of half-focus ones and only the header of the rest.

**Jira ticket.** A Jira button in the Assistant opens the ticket cited in the title, the branch or the commits: key (linked to Jira), type, status, priority, assignee, summary and the full description. The key also shows as a link in the top bar of the map. Without Jira connected it shows the key and offers to connect; with Jira connected, the story and coherence use the ticket too.

**Customize.** A ☀️/🌙 button for the light or dark theme and 🎨 to write your own CSS; both are stored in the browser.

## Reviewing a PR with PR Peer

A suggested flow for a 10-minute first pass:

1. **Open it.** `node prpeer.ts <PR url> --serve`, or pick it from the home screen.
2. **Read the shape.** Fit everything and look at which folders the PR touches and how big each card is.
3. **Start with red.** Click each *risky* file and read its reasons in the panel.
4. **Turn on linked.** Blue files are where breakage hides: check that they still hold.
5. **Zoom into the code** of the files that matter; open **View full diff** only when you need the whole thing.
6. **Ask.** Run *Story* to check your understanding, then *Tests* and *Breakage*. Use the chat for anything specific.
7. **Split if big.** Collapse to module level and hand each module to a different reviewer.

## Writing PRs that PR Peer understands

PR Peer reads everything the author leaves behind: docstrings, folder `README.md` files, `CHANGELOG.md`, commit messages, the Jira ticket and review comments. The more intent the author writes down, the better the map and the AI answers.

The convention is **intents with an ID** (`#i-retry`, `#i-cache-key`): one per reason for change, cited in commits (`Intent: #i-retry`), in code comments where the reason is not obvious, in the changelog, and in a `PR-PEER.md` index that lists file by file which line ranges belong to which intent.

Once the PR is open, the author posts one inline review comment per row of that index, anchored to the line range:

```
#i-retry — retry loop with backoff. See PR-PEER.md
```

PR Peer groups those comments by intent and hands them to the AI as "Author intents", so the story and every review start from what the author meant, not only from what the diff shows.

The full guide, with templates, a checklist and instructions for coding agents, is in [GUIA-PR-PEER.md](GUIA-PR-PEER.md) (Spanish).

> Today PR Peer reads intent comments from GitHub PRs opened from the app. It does not parse `PR-PEER.md` yet, and it reads at most the first 100 review comments.

## Connections

They work from **⚙ Settings → Connections** on the home screen or with environment variables. Settings also holds the local repo folders, theme/language/custom CSS, how many maps stay open, branch-map depth and the clone cache (with a delete button).

| What | How |
|---|---|
| Local repos | No setup. Looks for clones in `~/repos`, `~/code`, `~/projects`, `~/src`, `~/dev`, `~/git`, `~/source/repos`, `~/Documents/GitHub` and `~/Desktop`. Change them in **⚙ Settings → Local repos** (saved in `~/.prpeer/settings.json`, it wins over `repoDirs` in `config.json`). |
| GitHub (read-only) | `export GITHUB_TOKEN=...` or `gh auth login` on the machine where prpeer runs. |
| AI with an API | `export ANTHROPIC_API_KEY=...`, or another OpenAI-compatible provider (OpenAI, Ollama, LM Studio, OpenRouter…) in `~/.prpeer/config.json`. |
| AI with your subscription | Install Claude Code, run `claude auth login` and pick "Claude Code" in the chat's ⚙. It does not work on native Windows: use WSL. |
| Jira (optional) | `PRPEER_JIRA_URL` links the tickets; with `PRPEER_JIRA_EMAIL` and `PRPEER_JIRA_TOKEN` it also fetches their summary, status and description. |

If you do not set a default provider, prpeer picks the first one that can answer. Repos you do not have are cloned into `~/.prpeer/repos`.

## Configuration

`~/.prpeer/config.json` (or `--config`, `$PRPEER_CONFIG`, `./prpeer.config.json`) defines AI providers, the default model, the default interface language (`lang`), the language of AI replies (`language`), where to look for clones and the risk light rules. A full example is in [prpeer.config.example.json](prpeer/prpeer.config.example.json). `$PRPEER_HOME` moves the folder that holds saved connections.

Each repo can tune the risk light with a `.prpeer.json` at its root:

```json
{
  "mood": {
    "riskWords": ["ledger", "invoice", "idempot", "refund"],
    "riskPaths": [{ "match": "(^|/)billing/", "weight": 1 }],
    "ignore": ["spec", "(^|/)tests?/", "(^|/)test_", "CHANGELOG"],
    "thresholds": [2, 3.5]
  }
}
```

It is read from the **base branch**, not the PR's: a PR cannot loosen its own rules. Layers, from lowest to highest priority: defaults, user configuration, `.prpeer.json`. You can also tune `riskWeight`, `churnPer`, `churnMax`, `fanInWeight`, `fanInMax` and `noTestWeight` (see [mood.ts](prpeer/mood.ts)).

## Languages

- **Interface:** Spanish (default) and English. A floating ES/EN button at the bottom-right of every page switches language; the choice is stored in the browser and the page reloads. For browsers with no stored choice, set the default with `"lang": "en"` or `"lang": "es"` in the config file; the server then serves that language.
- **AI assistant:** summary, chat, story and reviews answer in the UI language. `"language": "…"` in the config overrides the reply language by name (for example `"português"`) without changing the UI.
- **Errors and hints** returned by the API follow the language too (the page sends the `x-prpeer-lang` header). The CLI's terminal output, config-file validation errors and logs are English only.
- **Adding or fixing a translation:** client strings live in `web/locales.js` (each key is a `[Spanish, English]` pair, with `{vars}` and `one|other` plurals); server strings (API errors, AI prompts) live in `locales.ts`. `npm test` fails if a key is missing in one language or the placeholders differ. To add a third language, add a column in both files and its code in `LANGS` in `web/i18n.js` and `i18n.ts`.
- Code, comments, docs and tests are written in English.

## Supported code languages

| Languages | What PR Peer sees |
|---|---|
| **Python** (with Python 3), **JavaScript / TypeScript** | Per-function and per-class sections, and an import graph. |
| **Terraform** (with AWS Lambda/archive sources), shell, SQL, Markdown, YAML, JSON, TOML, Makefile, HTML and templates, CSS / SCSS / LESS, Dockerfile, GraphQL, Protobuf | Named sections and references between files. |
| **Go, Java, Kotlin, C#, PHP, Rust, Ruby** | Sections per type and method/function, and references between files where the language maps imports to files (Java, Kotlin, PHP, Rust `mod`, Ruby, Protobuf). Lightweight analyzers, not full grammars: see the "shortcut" notes in `langs.ts`. |
| Anything else | Falls back to git's `@@` header. |

## Security and privacy

- The server listens only on `127.0.0.1`, validates the `Host` header against DNS rebinding and requires its own header on POSTs against CSRF.
- The page carries a content policy that keeps anything from leaving its origin; a PR's code is treated as untrusted data.
- API keys never reach the browser. Those you enter from Connections are stored in `~/.prpeer/connections.json`, readable only by your user.
- Code only travels to the AI provider you choose and only when you ask it something. What is sent is built by the server, capped at about 80,000 characters of context.

## Windows and WSL

- If `python` is the Microsoft Store shortcut, prpeer sees no functions or links in Python repos. Install a real Python 3 and put it before `WindowsApps` in `PATH`; `npm run demo` warns if it cannot find one.
- Install Node 24 from nodejs.org or with nvm; on WSL/Ubuntu `sudo apt install nodejs` brings an old version. The installer handles both.
- On WSL it opens the Windows browser with `cmd.exe`.
- **Running it in WSL:** copy the folder into your Linux home instead of using it from `/mnt/c`. A shared `node_modules` holds native binaries for one OS only, so installing from both sides breaks one of them, and `/mnt/c` is slow. Then run `sh install.sh` there:

  ```bash
  mkdir -p ~/pr-peer && tar -C "/mnt/c/path/to/PR Peer" --exclude=node_modules -cf - . | tar -C ~/pr-peer -xf -
  cd ~/pr-peer && sh install.sh
  ```

- In WSL, `~/.prpeer` is the Linux one: connections saved on Windows are not shared, add them again from **Connections**. Repos on the Windows side work with `--repo /mnt/c/...`, only slower.
- The Claude Code subscription provider works in WSL (not on native Windows).

## Troubleshooting

Start with `prpeer doctor`: it finds most of these by itself.

| Symptom | Cause and fix |
|---|---|
| `prpeer` is not recognized | Open a new terminal after installing. If it persists, `prpeer doctor` from `node bin.mjs doctor` in the folder tells you why. |
| Python files show "1 section" and no linked files | No real Python 3 on `PATH` (see Windows above). The Windows installer can fix it. |
| "Node X is too old; PR Peer needs Node 24" | Run the installer, or install Node 24 (winget / nvm) and open a new terminal. |
| The first run takes a minute | It is installing dependencies and building the map, once. |
| Port 4173 is in use | Another prpeer is running, or something else: `prpeer --serve --port 4174`. |
| It worked on Windows and broke in WSL (or the other way around) | Both sides installed into the same folder: see "Running it in WSL" above. |
| "without `gh` I cannot know the PR base branch" | Install and log in to `gh`, or pass `--base origin/<branch>`. |
| The map is empty | The PR is already merged and the base moved: pass `--base <sha of the original base>`. |
| `npm ci` fails with EUSAGE | You are not in the folder with `package.json`. |
| The AI does not answer | No provider configured: see [Connections](#connections). The chat's ⚙ shows which ones are available. |
| GitHub search shows nothing | No token: export `GITHUB_TOKEN` (read-only) or run `gh auth login`. |

## Development

```bash
npm test            # tests (node --test), including the demo
npm run build       # builds the map (web/map → web/dist)
npm run typecheck   # map types
```

| Folder or file | What it holds |
|---|---|
| `bin.mjs`, `prpeer.ts`, `doctor.ts` | Launcher (Node check, first-run install), CLI and `prpeer doctor`. |
| `analyze.ts`, `diff.ts`, `graph.ts`, `sections.ts`, `langs.ts`, `tslang.ts`, `pysections.py` | Diff, per-function sections and import graph. |
| `mood.ts`, `scan.ts` | Risk light and secret scan. |
| `app.ts`, `serve.ts` | Sessions, API and HTTP server. |
| `llm.ts`, `ask.ts`, `context.ts`, `jira.ts`, `connections.ts`, `sources.ts` | AI, context, integrations and repo sources (including the `#i-` intent comments). |
| `i18n.ts`, `locales.ts`, `web/i18n.js`, `web/locales.js` | Translations, server side and client side. |
| `locales.test.ts`, `web/i18n.test.ts` | Translation tests: every key in every language, matching placeholders. |
| `web/` | Interface: `home.*` (home), `index.html` + `app.js` (panels) and `map/` (the map, React Flow). |
| `demo/` | Sample repo (`shop/base` and `shop/pr`), its script and the scripts that record the screenshots. |
| `docs/` | Screenshots and GIFs for this README. |

### Re-recording the screenshots and GIFs

With the demo running (`npm run demo -- --no-open`) and a real Python 3 with Pillow:

```bash
LANG_UI=en node demo/shoot.mjs /tmp/shots <demo url>     # one screenshot per scene
LANG_UI=en node demo/clips.mjs /tmp/clips <demo url>     # frames for the short clips
LANG_UI=en python demo/mkstory.py /tmp/shots docs        # story GIF + jpg screenshots
python demo/mkclips.py /tmp/clips docs                   # clip-*.gif
```

The scripts drive a headless Chrome; the path is set at the top of `shoot.mjs` and `clips.mjs`. More detail in [demo/HISTORIA.md](prpeer/demo/HISTORIA.md).

What changed is in [CHANGELOG.md](prpeer/CHANGELOG.md); there is a list of ideas in [TODO.md](prpeer/TODO.md).
