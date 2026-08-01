return {
    "saghen/blink.cmp",
    version = "1.*",
    event = "InsertEnter",
    dependencies = {
        { "L3MON4D3/LuaSnip", version = "v2.*" },
        "rafamadriz/friendly-snippets",
    },
    config = function()
        local luasnip = require("luasnip")

        luasnip.setup()

        -- loads vscode style snippets from installed plugins (e.g. friendly-snippets)
        require("luasnip.loaders.from_vscode").lazy_load()

        -- loads snipmate snippets from this config's snippets/ directory
        require("luasnip.loaders.from_snipmate").load({
            paths = vim.fn.stdpath("config") .. "/snippets",
        })

        require("blink.cmp").setup({
            -- use luasnip as the snippet engine (required: custom snippets are snipmate format)
            snippets = { preset = "luasnip" },
            keymap = {
                preset = "default",
                ["<C-k>"] = { "select_prev", "fallback" }, -- previous suggestion
                ["<C-j>"] = { "select_next", "fallback" }, -- next suggestion
                ["<C-b>"] = { "scroll_documentation_up", "fallback" },
                ["<C-f>"] = { "scroll_documentation_down", "fallback" },
                ["<C-Space>"] = { "show", "show_documentation", "hide_documentation" }, -- show completion suggestions
                ["<C-e>"] = { "hide", "fallback" }, -- close completion window
                ["<CR>"] = { "accept", "fallback" }, -- accept only when something is selected
            },
            appearance = {
                nerd_font_variant = "mono",
            },
            completion = {
                documentation = { auto_show = false },
                accept = {
                    auto_brackets = { enabled = true },
                },
                list = { selection = { preselect = false } },
            },
            sources = {
                default = { "lsp", "path", "snippets", "buffer" },
            },
        })
    end,
}
