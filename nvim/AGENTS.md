# AGENTS.md - Neovim Configuration

This is a Neovim configuration written in Lua, managed with lazy.nvim plugin manager.

## Build/Lint/Test Commands

Since this is a Neovim configuration (not a traditional project), there are no build or test commands. However:

- **Format Lua files**: Uses `stylua` via conform.nvim
- **Lint Lua files**: No explicit linter configured for Lua, but conform.nvim handles formatting
- **Validate config**: Open Neovim and check for errors on startup
- **Check health**: Run `:checkhealth` in Neovim to diagnose issues

## Code Style Guidelines

### File Structure

- Entry point: `init.lua` - requires core modules and lazy.nvim setup
- Core settings: `lua/georsuar/core/` - options, keymaps, init
- Plugins: `lua/georsuar/plugins/` - individual plugin configs
- LSP configs: `lua/georsuar/plugins/lsp/` - LSP-related plugins

### Lua Style

- **Indentation**: 2 spaces (soft tabs) for plugin configs, 4 spaces for options/keymaps
- **Quotes**: Double quotes for strings
- **Line endings**: Unix-style (LF)
- **Trailing whitespace**: Trim trailing whitespace
- **Semicolons**: Don't use semicolons

### Naming Conventions

- **Variables**: Use `snake_case` for local variables
- **Functions**: Use `snake_case` for function names
- **Modules**: Module names use lowercase with hyphens in plugin repos

### Imports and Requires

- Use local variables for conciseness: `local opt = vim.opt`
- Load modules with dot notation: `require("georsuar.core")`
- Group related requires together

### Keymaps

- Set leader key at top: `vim.g.mapleader = " "`
- Use `vim.keymap.set()` API
- Always provide descriptions: `{ desc = "Description here" }`
- Use `<cmd>` for command mode mappings
- Use `<CR>` for carriage return in mappings
- Comment each keymap with its purpose

### Plugin Specifications

- Return a Lua table with plugin spec
- Use `config = function()` for setup
- Use `dependencies = { ... }` for plugin dependencies
- Use `event = { "BufReadPre", "BufNewFile" }` for lazy loading when appropriate
- Use `build = ":TSUpdate"` for treesitter-like build steps

### Comments

- Use `--` for single-line comments
- Add space after dashes: `-- comment text`
- Use inline comments sparingly and keep them concise
- Comment sections with headers: `-- Section Name -------------------`

### Error Handling

- Check for plugin availability before requiring: `local ok, plugin = pcall(require, "plugin")`
- Use vim.notify for user-facing messages
- Handle LSP attach events with proper autocmd groups

### LSP Configuration

- Use `vim.lsp.enable()` for enabling language servers
- Create autocmd groups for LSP attach: `vim.api.nvim_create_augroup("UserLspConfig", {})`
- Set capabilities from cmp-nvim-lsp for autocompletion
- Define diagnostic signs with Nerd Font icons

### Formatting Integration

- Uses conform.nvim for formatting
- Format on save enabled with 5000ms timeout
- Formatters: prettier (web), stylua (lua), black/isort (python), clang-format (c/cpp), gofmt (go)

### Linting Integration

- Uses nvim-lint for linting
- Linters: eslint_d (web), ruff (python), swiftlint (swift)
- Triggers on BufEnter, BufWritePost, InsertLeave

## Testing Changes

1. Edit the configuration file
2. Save and exit Neovim
3. Reopen Neovim to test
4. Use `:Lazy` to check plugin status
5. Use `:LspInfo` to verify LSP configuration
6. Use `:checkhealth` for diagnostics

## Important Notes

- This config uses lazy.nvim for plugin management (lazy-lock.json tracks versions)
- Uses plenary.nvim as a dependency for many plugins
- Leader key is set to space (`<leader>` = space)
- Uses termguicolors for true color support
- Clipboard is set to use system clipboard (`unnamedplus`)
- Tab width is 4 spaces in editor, 2 spaces in plugin configs
