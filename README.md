# Dotfiles

My macOS dotfiles, managed with [chezmoi](https://chezmoi.io).

## What's tracked

- Shell: `.zshrc` (starship prompt), `.zshenv`, `.zprofile`, `.tmux.conf`, `.gitconfig`
- `~/.config/nvim`, `~/.config/opencode` (`opencode.jsonc`, `tui.json`, plugins), `~/.config/ghostty`, `~/.config/herdr`, `~/.config/starship.toml`, `~/.config/chezmoi`
- `~/.agents/` — global agent skills (shared across harnesses)
- `~/.pi/agent/` — pi-specific extensions, settings, prompts, tests (`dot_pi/` is the Pi agent harness, not a Raspberry Pi)

Excluded: `.ssh`, caches, logs, session history, machine-local files (see `~/.zshrc.local`).

## Bootstrap a new machine

```sh
chezmoi init --apply https://github.com/GeorgeSuarez/dotfiles.git
```

Or from a local clone (avoids double-cloning):

```sh
git clone https://github.com/GeorgeSuarez/dotfiles.git && cd dotfiles && ./install.sh
```

## Workflow

- Edit configs in place as usual.
- `dotdiff` — review `chezmoi status` + `chezmoi diff` (live vs source).
- `chezmoi re-add <file>` — pull a live change you intend to keep back into the source.
- `sync-dotfiles` — review diff, then apply source -> live.
- `push-dotfiles` — review `git status`, stage tracked changes, review cached diff, commit, push.
