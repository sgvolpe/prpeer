# PR Peer demo: "Partial refunds"

Sample repo: the files live in `shop/base` (branch `main`) and `shop/pr` (what the PR changes); `npm run demo` turns them into a git repo (branch `feature/partial-refunds` against `main`). It is built so that each file in the diff showcases one capability of the tool.

## The story (5 scenes)

| Scene | What you see | Why it works in this repo |
|---|---|---|
| 1. The PR | 8 files, +220 −4, grouped by folder; tests are hidden | A multi-layer change: `payments/`, `orders/`, `api/`, `notifications/`, `db/` |
| 2. The traffic light | `refunds.py` risky: 2 files use it, no direct test, mentions «payment», sensitive path | New 80-line file, imported by `service.py` and `routes/orders.py`, with no `test_refunds.py` |
| 3. What did not change | `gateway.py` is used by 4 files, including `revenue.py` and `dashboard.py` (linked, in blue) | Those two are not in the diff and have latent bugs (below) |
| 4. The code | Zoom: the added lines of each function appear | `gateway.py` adds 46 lines in 6 sections |
| 5. By module | `payments` with 2 risky, `orders` and `db` on watch, `api` and `notifications` calm | The scores are spread on purpose |

## Bugs planted in files that do NOT change (to tell in scene 3)

- `shop/reports/revenue.py`: `monthly_revenue` sums the gateway charges and does not subtract refunds.
- `shop/admin/dashboard.py`: `orders_by_status` has hardcoded statuses and fails with `KeyError` on `partially_refunded`.

## How the traffic light is calibrated

`.prpeer.json` (on `main`, because the tool reads it from the base branch) adds 0.5 to everything under `payments/`. Score = changed lines / 150 (capped at 3) + 0.7 per file that uses it (capped at 2) + 1 if no test imports it + 0.8 if it mentions sensitive words (`payment`, `migration`…) + path rules. Below 2 is calm, below 3.5 is watch, from there it is risky.

## Reproduce

On Windows a real Python is needed on the PATH (the Microsoft Store shortcut makes the tool fall back to a mode with no function analysis or links).

```bash
npm run demo                               # builds the repo in the temp folder and opens PR Peer
npm run demo -- --dir ./demo-shop --no-open --port 4180
```

Screenshots (uses headless Chrome, 1920×1080) and GIF, with the demo already served on port 4180 (set `LANG_UI=en` to shoot the English UI):

```bash
node demo/shoot.mjs demo/frames http://localhost:4180/
python demo/mkstory.py demo/frames docs
```

## Missing: the AI scene

The scene of asking questions about the PR is not in the presentation: when recording, the provider showed as "ready" but no key was loaded and the chat returned an authentication error. With `ANTHROPIC_API_KEY` set (or `claude auth login` and choosing "Claude Code" in the chat ⚙) it is recorded with `IA=1 node demo/shoot.mjs ...`. Suggested question: «Which files could break with this PR even if they do not change?».

Clips cortos por función (niveles, zoom y vinculados), con el servidor de la demo en el puerto 4180:

```bash
node demo/clips.mjs demo/clips http://localhost:4180/
python demo/mkclips.py demo/clips docs
```
