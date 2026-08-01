#!/usr/bin/env bash
# Bootstrap a fresh macOS machine into this dotfiles setup.
# Usage: ./install.sh
set -euo pipefail

REPO_URL="https://github.com/GeorgeSuarez/dotfiles.git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. Homebrew
if ! command -v brew >/dev/null 2>&1; then
  echo "==> Installing Homebrew"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# 2. Runtime dependencies
echo "==> Installing runtime dependencies (brew bundle)"
brew bundle --file="$SCRIPT_DIR/Brewfile"

# 3. Oh My Zsh
if [[ ! -d "$HOME/.oh-my-zsh" ]]; then
  echo "==> Installing Oh My Zsh"
  git clone --depth=1 https://github.com/ohmyzsh/ohmyzsh.git "$HOME/.oh-my-zsh"
fi

# 4. tmux TPM + plugins
if [[ ! -d "$HOME/.tmux/plugins/tpm" ]]; then
  echo "==> Installing tmux TPM"
  git clone --depth=1 https://github.com/tmux-plugins/tpm "$HOME/.tmux/plugins/tpm"
fi
"$HOME/.tmux/plugins/tpm/bin/install_plugins" || true

# 5. Apply dotfiles
echo "==> Applying dotfiles via chezmoi"
chezmoi init --apply "$REPO_URL"

echo "Done. Open a new shell to load your config."
