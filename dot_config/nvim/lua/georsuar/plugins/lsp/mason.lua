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
                icons = {
                    package_installed = "✓",
                    package_pending = "➜",
                    package_uninstalled = "✗",
                },
            },
        })

        mason_lspconfig.setup({
            -- list of servers for mason to install
            ensure_installed = {
                "vtsls",
                "html",
                "cssls",
                "tailwindcss",
                "lua_ls",
                "pyright",
            },
            -- servers are automatically enabled via vim.lsp.enable (mason-lspconfig
            -- default). custom server configs (lua_ls, vtsls, roslyn) live in
            -- lspconfig.lua and use the modern vim.lsp.config/enable API.
        })

        mason_tool_installer.setup({
            ensure_installed = {
                -- lsp servers
                "roslyn-language-server",
                -- formatters
                "oxfmt",
                "stylua",
                "isort",
                "black",
                "clang-format",
                "csharpier",
                -- linters
                "ruff",
                "oxlint",
                "eslint_d",
                "swiftlint",
            },
        })
    end,
}
