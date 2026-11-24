#!/usr/bin/env sh
# PR Peer installer for macOS, Linux and WSL. Run it from the downloaded PR Peer folder:
#   sh install.sh        (asks before installing anything)
#   sh install.sh -y     (installs what is missing without asking)
# Installs what is missing (git, Node 24 via nvm, Python 3, optionally gh), installs PR Peer,
# puts `prpeer` on PATH and finishes with `prpeer doctor`.
set -eu
APP="$(cd "$(dirname "$0")" && pwd)"
YES=0; [ "${1:-}" = "-y" ] || [ "${1:-}" = "--yes" ] && YES=1
OS="$(uname -s)"

fail() { echo "prpeer install: $1" >&2; echo "The duck is disappointed, but not surprised." >&2; exit 1; }
step() { echo "-> $1"; }
has() { command -v "$1" >/dev/null 2>&1; }
ask() { [ "$YES" = 1 ] && return 0; printf '%s [Y/n] ' "$1"; read -r a </dev/tty || a=n; case "$a" in ""|[yYsS]*) return 0;; *) return 1;; esac; }
node_major() { has node && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
SUDO=""; [ "$(id -u)" != 0 ] && has sudo && SUDO="sudo"
# system packages: brew on macOS, the distro's package manager on Linux
pkg() {
  if [ "$OS" = Darwin ]; then
    if has brew; then brew install "$@"; else xcode-select --install 2>/dev/null || true; fail "install Homebrew (https://brew.sh) or the Xcode command line tools (now opening), then run this again."; fi
  elif has apt-get; then $SUDO apt-get update -qq && $SUDO apt-get install -y "$@"
  elif has dnf; then $SUDO dnf install -y "$@"
  elif has pacman; then $SUDO pacman -S --noconfirm "$@"
  elif has zypper; then $SUDO zypper install -y "$@"
  else fail "no known package manager: install $* by hand and run this again."; fi
}

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then O="$(printf '\033[38;5;214m')"; R="$(printf '\033[0m')"; else O=""; R=""; fi
# the logo: two eyes peeking over the orange bar
cat <<EOF
     .-----.   .-----.
    /  .-.  \\ /  .-.  \\
   |  ( o )  |  ( o )  |
${O}  .---------------------.${R}
${O}  |  ===========        |${R}   P R   P E E R   installer
${O}  |  ======             |${R}   Hatching a code reviewer. Please do not tap the glass.
${O}  '---------------------'${R}

EOF

[ -f "$APP/package.json" ] || fail "no package.json next to this script ($APP). Run it from the downloaded PR Peer folder."

step "Checking your toolbox..."
if ! has git; then
  ask "git is missing. Install it?" && pkg git || fail "git is required."
fi
if [ "$(node_major)" -lt 24 ]; then
  if has node; then NOW="Node $(node -v) is too old"; else NOW="Node.js is missing"; fi
  ask "$NOW (PR Peer needs 24+). Install Node 24 with nvm (in your home, no sudo)?" || fail "Node 24+ is required."
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    has curl || pkg curl
    step "Installing nvm..."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  step "Installing Node 24..."
  nvm install 24 && nvm alias default 24 >/dev/null
  [ "$(node_major)" -ge 24 ] || fail "Node 24 did not install. Open a new terminal and run this again."
fi
if ! has python3; then
  if ask "Python 3 is missing (only needed to analyze Python repos). Install it?"; then
    if [ "$OS" = Darwin ]; then pkg python; else pkg python3; fi
  fi
fi
if ! has gh; then
  ask "GitHub CLI (gh) is missing (optional: open PRs by number, private repos). Install it?" && { pkg gh || echo "   Could not install gh: see https://cli.github.com"; echo "   Run \"gh auth login\" afterwards to connect your account."; } || true
fi

cd "$APP"
step "Downloading half the internet (npm ci). Good time for a coffee..."
npm ci --no-audit --no-fund || fail "npm ci failed. Check your connection or proxy and try again."
step "Teaching your terminal a new word: prpeer..."
# dependencies and the build are already in place: the global entry is only a link to this folder
if ! npm install -g . --ignore-scripts --no-audit --no-fund; then
  echo "Global install failed (no write access to npm's global folder?). Retry with:" >&2
  echo "  cd \"$APP\" && sudo npm install -g . --ignore-scripts" >&2
  echo "or install Node with nvm (this installer does it if you remove the system Node), whose global folder lives in your home." >&2
  exit 1
fi

echo
step "Asking the doctor for a second opinion..."
node "$APP/bin.mjs" doctor || true
echo
echo "PR Peer is installed. Your PRs are now being watched (in a supportive way)."
echo "Open a new terminal and try:"
echo "  prpeer --serve                                  # home screen"
echo "  prpeer https://github.com/owner/repo/pull/123   # open a PR"
echo "  prpeer doctor                                   # check the setup any time"
