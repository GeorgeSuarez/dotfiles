return {
    "williamboman/mason.nvim",
    dependencies = {
        "williamboman/mason-lspconfig.nvim",
        "WhoIsSethDaniel/mason-tool-installer.nvim",
    },
    config = function()
        -- import mason
        local mason = require("mason")

        -- import mason-lspconfig
        local mason_lspconfig = require("mason-lspconfig")

        local mason_tool_installer = require("mason-tool-installer")

        -- enable mason and configure icons
        mason.setup({
            ui = {
                border = "rounded",
                icons = {
                    package_installed = "✓",
                    package_pending = "➜",
                    package_uninstalled = "✗",
                },
            },
        })

        mason_lspconfig.setup({
            -- vtsls excluded: tsc (TS7 native) is the chosen TS server.
            -- two TS servers on one buffer crash inlay hints (neovim#36318).
            automatic_enable = {
                exclude = { "vtsls" },
            },
            -- list of servers for mason to install
            ensure_installed = {
                "html",
                "cssls",
                "tailwindcss",
                "lua_ls",
                "pyright",
                "jsonls",
                "yamlls",
            },
            -- servers are automatically enabled via vim.lsp.enable (mason-lspconfig
            -- default). custom server configs (lua_ls, vtsls, roslyn) live in
            -- lspconfig.lua and use the modern vim.lsp.config/enable API.
        })

        mason_tool_installer.setup({
            auto_update = true,
            run_on_start = true,
            start_delay = 3000,
            debounce_hours = 12,
            ensure_installed = {
                -- lsp servers
                "roslyn-language-server",
                -- formatters
                "oxfmt",
                "stylua",
                "clang-format",
                "csharpier",
                -- linters
                "ruff",
                "oxlint",
                "swiftlint",
            },
        })
    end,
}
