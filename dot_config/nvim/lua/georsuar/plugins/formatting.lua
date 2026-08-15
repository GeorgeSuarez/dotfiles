return {
    "stevearc/conform.nvim",
    event = { "BufReadPre", "BufNewFile" },
    config = function()
        local conform = require("conform")

        conform.setup({
            formatters_by_ft = {
                javascript = { "oxfmt" },
                typescript = { "oxfmt" },
                javascriptreact = { "oxfmt" },
                typescriptreact = { "oxfmt" },
                svelte = { "oxfmt" },
                css = { "oxfmt" },
                html = { "oxfmt" },
                json = { "oxfmt" },
                yaml = { "oxfmt" },
                markdown = { "oxfmt" },
                graphql = { "oxfmt" },
                liquid = { "prettier" },
                lua = { "stylua" },
                python = { "isort", "black" },
                c = { "clang-format" },
                cpp = { "clang-format" },
                go = { "gofmt" },
                csharp = { "csharpier" },
            },
            formatters = {
                ["clang-format"] = {
                    prepend_args = { "-style=file", "-fallback-style=LLVM" },
                },
            },
            format_on_save = {
                lsp_fallback = true,
                async = false,
                timeout_ms = 5000,
            },
        })

        vim.keymap.set({ "n", "v" }, "<leader>mp", function()
            conform.format({
                lsp_fallback = true,
                async = false,
                timeout_ms = 1000,
            })
        end, { desc = "Format file or range (in visual mode)" })
    end,
}
