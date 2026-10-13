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

- **Indentation**: 2 spaces by default; the Go ftplugin uses tabs at a 4-column width. Lua files use 4-space indentation from `stylua.toml`.
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

- Leader is space, set in `lua/georsuar/core/keymaps.lua`.
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
- Set LSP capabilities from `blink.cmp` for autocompletion.
- Define diagnostic signs with Nerd Font icons

### Formatting Integration

- Uses conform.nvim for formatting
- Format on save enabled with 5000ms timeout
- Formatters: oxfmt (JavaScript/TypeScript, Svelte, CSS, HTML, JSON, YAML, Markdown, GraphQL), stylua (Lua), isort/black (Python), clang-format (C/C++), gofmt (Go), csharpier (C#).

### Linting Integration

- Uses nvim-lint for linting
- Linters: oxlint (web), ruff (python), swiftlint (swift)
- Triggers on BufReadPost, BufWritePost, InsertLeave

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
- Uses termguicolors for true color support
- System clipboard (`unnamedplus`) is enabled on local sessions and intentionally disabled over SSH because remote clipboard providers can hang.
