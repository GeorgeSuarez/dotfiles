local opt = vim.opt -- for conciseness
--
-- line numbers
opt.relativenumber = true -- show relative line numbers
opt.number = true -- shows absolute line number on cursor line (when relative number is on)

-- tabs & indentation (default 2-space; ftplugin/ overrides per-filetype:
-- tabs for go)
opt.tabstop = 2
opt.shiftwidth = 2
opt.softtabstop = 2
opt.expandtab = true -- expand tab to spaces
opt.smartindent = true

-- line wrapping
opt.wrap = false -- disable line wrapping

-- search settings
opt.ignorecase = true -- ignore case when searching
opt.smartcase = true -- if you include mixed case in your search, assumes you want case-sensitive

-- cursor line
opt.cursorline = true -- highlight the current cursor line

-- appearance
-- turn on termguicolors for nightfly colorscheme to work
-- (have to use iterm2 or any other true color terminal)
opt.termguicolors = true
opt.background = "dark" -- colorschemes that can be light or dark will be made dark
opt.signcolumn = "yes" -- show sign column so that text doesn't shift
opt.guicursor = "a:block,i:block-blinkon100-blinkoff100" -- block cursor in all modes, blinking block in insert mode

-- backspace
opt.backspace = "indent,eol,start" -- allow backspace on indent, end of line or insert mode start position

-- clipboard
-- NOTE: unnamedplus can hang over SSH (provider waits on OSC52/remote clipboard).
-- Only enable when not in an SSH session; on local macOS it is safe.
if vim.env.SSH_TTY == nil and vim.env.SSH_CONNECTION == nil then
    opt.clipboard:append("unnamedplus") -- use system clipboard as default register
end

-- WSL: explicit clipboard provider with absolute Windows paths.
-- Survives `appendWindowsPath=false` in /etc/wsl.conf (bare `clip.exe` would
-- fail with "No provider"). Under WSLg, xclip already syncs to Windows so
-- the default provider is left alone. See docs/wsl2-windows-terminal.md §5.
if vim.fn.has("wsl") == 1 then
    local has_wslg = vim.fn.executable("xclip") == 1 and os.getenv("DISPLAY") ~= nil
    if not has_wslg then
        vim.g.clipboard = {
            name = "WslClipboard",
            copy = {
                ["+"] = "/mnt/c/Windows/System32/clip.exe",
                ["*"] = "/mnt/c/Windows/System32/clip.exe",
            },
            paste = {
                ["+"] = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoLogo -NoProfile -c [Console]::Out.Write($(Get-Clipboard -Raw).tostring().replace("`r", ""))',
                ["*"] = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoLogo -NoProfile -c [Console]::Out.Write($(Get-Clipboard -Raw).tostring().replace("`r", ""))',
            },
            cache_enabled = 0,
        }
    end
end

-- split windows
opt.splitright = true -- split vertical window to the right
opt.splitbelow = true -- split horizontal window to the bottom

-- turn off swapfile
opt.swapfile = false

-- persistent undo
opt.undofile = true
pcall(vim.fn.mkdir, vim.fn.stdpath("state") .. "/undo", "p")
opt.undodir = vim.fn.stdpath("state") .. "/undo"

-- confirm instead of erroring on unsaved changes (e.g. :q, :bd)
opt.confirm = true

-- snappier mapped-sequence timeout (which-key friendly)
opt.timeoutlen = 300
