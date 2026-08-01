# Dotfiles

My macOS dotfiles, managed with [chezmoi](https://chezmoi.io).

## What's tracked
- Shell: `.zshrc`, `.zshenv`, `.zprofile`, `.p10k.zsh`
- `.tmux.conf`, `.gitconfig`
- `~/.config/nvim`, `~/.config/opencode`
- Ghostty config, herdr `config.toml`

Excluded: `.ssh`, caches, state, machine-local files (see `~/.zshrc.local`).

## Bootstrap a new machine
```sh
git clone https://github.com/GeorgeSuarez/dotfiles.git && cd dotfiles && ./install.sh
```

## Workflow
- Edit configs in place as usual.
- `sync-dotfiles` — re-add live changes to chezmoi, show `chezmoi diff`, apply.
- `push-dotfiles` — stage, review `git diff --cached`, commit, push.
