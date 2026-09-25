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
                lua = { "stylua" },
                python = { "ruff" },
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
                timeout_ms = 500,
                lsp_fallback = true,
            },
            -- Async formatting must happen after the write completes.
            -- format_on_save runs at BufWritePre and cannot be async.
            format_after_save = {
                lsp_fallback = true,
            },
        })

        vim.keymap.set({ "n", "v" }, "<leader>mp", function()
            conform.format({
                lsp_fallback = true,
                async = true,
                timeout_ms = 500,
            })
        end, { desc = "Format file or range (in visual mode)" })
    end,
}
