return {
    "mfussenegger/nvim-lint",
    event = { "BufReadPre", "BufNewFile" },
    config = function()
        local lint = require("lint")

        lint.linters_by_ft = {
            javascript = { "oxlint" },
            typescript = { "oxlint" },
            javascriptreact = { "oxlint" },
            typescriptreact = { "oxlint" },
            python = { "ruff" },
            swift = { "swiftlint" },
        }

        local lint_augroup = vim.api.nvim_create_augroup("lint", { clear = true })

        vim.api.nvim_create_autocmd({ "BufReadPost", "BufWritePost", "InsertLeave" }, {
            group = lint_augroup,
            callback = function()
                -- skip linters whose binary is missing to avoid ENOENT
                lint.try_lint(nil, {
                    filter = function(linter)
                        local cmd = linter.cmd
                        if type(cmd) == "function" then
                            cmd = cmd()
                        end
                        return vim.fn.executable(cmd) == 1
                    end,
                })
            end,
        })

        vim.keymap.set("n", "<leader>ll", function()
            lint.try_lint(nil, { ignore_errors = true })
        end, { desc = "Trigger linting for current file" })
    end,
}
