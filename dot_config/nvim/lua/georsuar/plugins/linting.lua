return {
    "mfussenegger/nvim-lint",
    event = { "BufReadPre", "BufNewFile" },
    config = function()
        local lint = require("lint")

        -- eslint may be provided as `eslint` (local) or `eslint_d` (mason). Make the
        -- single `eslint` linter entry use whichever is available to avoid ENOENT.
        local eslint_linter = require("lint.linters.eslint")
        local orig_eslint_cmd = eslint_linter.cmd
        eslint_linter.cmd = function()
            local local_eslint = vim.fn.fnamemodify("./node_modules/.bin/eslint", ":p")
            if vim.loop.fs_stat(local_eslint) then
                return local_eslint
            end
            if vim.fn.executable("eslint") == 1 then
                return "eslint"
            end
            if vim.fn.executable("eslint_d") == 1 then
                return "eslint_d"
            end
            if type(orig_eslint_cmd) == "function" then
                return orig_eslint_cmd()
            end
            return orig_eslint_cmd
        end

        lint.linters_by_ft = {
            javascript = { "oxlint", "eslint" },
            typescript = { "oxlint", "eslint" },
            javascriptreact = { "oxlint", "eslint" },
            typescriptreact = { "oxlint", "eslint" },
            python = { "ruff" },
            swift = { "swiftlint" },
        }

        local lint_augroup = vim.api.nvim_create_augroup("lint", { clear = true })

        vim.api.nvim_create_autocmd({ "BufReadPost", "BufWritePost", "InsertLeave" }, {
            group = lint_augroup,
            callback = function()
                -- filter out linters whose binary is missing to avoid ENOENT
                -- (e.g. eslint not installed in this repo). eslint also requires a config file.
                lint.try_lint(nil, {
                    filter = function(linter)
                        local cmd = linter.cmd
                        if type(cmd) == "function" then
                            cmd = cmd()
                        end
                        if vim.fn.executable(cmd) ~= 1 then
                            return false
                        end
                        if linter.name == "eslint" then
                            local fname = vim.api.nvim_buf_get_name(0)
                            if fname == "" then
                                return false
                            end
                            local has_config = vim.fs.find({
                                "eslint.config.js",
                                "eslint.config.mjs",
                                "eslint.config.cjs",
                                ".eslintrc",
                                ".eslintrc.js",
                                ".eslintrc.cjs",
                                ".eslintrc.json",
                            }, { path = fname, upward = true })[1] ~= nil
                            return has_config
                        end
                        return true
                    end,
                })
            end,
        })

        vim.keymap.set("n", "<leader>ll", function()
            lint.try_lint(nil, { ignore_errors = true })
        end, { desc = "Trigger linting for current file" })
    end,
}
