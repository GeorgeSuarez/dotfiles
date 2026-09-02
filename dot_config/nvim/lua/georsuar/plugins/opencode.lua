return {
    "NickvanDyke/opencode.nvim",
    dependencies = {
        -- Recommended for `ask()` and `select()`.
        -- Required for `snacks` provider.
        ---@module 'snacks' <- Loads `snacks.nvim` types for configuration intellisense.
        { "folke/snacks.nvim", priority = 1000, lazy = false, init = function()
            -- Resolve file icons by basename so dotfiles (.gitignore, .zshrc, ...) get their icon
            local util = require("snacks.util")
            local icon = util.icon
            util.icon = function(name, cat, opts)
                if cat == "file" and type(name) == "string" then
                    name = name:match("[^/]+$")
                end
                return icon(name, cat, opts)
            end

            -- snacks.input and snacks.picker are enabled via opts below,
            -- but vim.ui overrides must be deferred until after snacks.setup().
            vim.schedule(function()
                if vim.ui.input ~= require("snacks.input").input then
                    vim.ui.input = require("snacks.input").input
                end
                vim.ui.select = require("snacks.picker").select
            end)
        end, opts = {
            image = {},
            input = {},
            picker = {
                sources = {
                    explorer = {
                        hidden = true, -- show dot files by default
                    },
                },
            },
            terminal = {},
            explorer = {},
            notifier = {},
        }, keys = {
            { "<leader>ee", function() require("snacks").explorer() end, desc = "Toggle file explorer" },
            { "<leader>ef", function() require("snacks").explorer.reveal() end, desc = "Reveal current file in explorer" },
        } },
    },
    config = function()
        ---@type opencode.Opts
        vim.g.opencode_opts = {
            -- Your configuration, if any — see `lua/opencode/config.lua`, or "goto definition" on the type or field.
        }

        -- Required for `opts.events.reload`.
        vim.o.autoread = true

        -- Recommended/example keymaps.
        vim.keymap.set({ "n", "x" }, "<leader>oa", function()
            require("opencode").ask("@this: ", { submit = true })
        end, { desc = "Ask opencode…" })
        vim.keymap.set({ "n", "x" }, "<leader>os", function()
            require("opencode").select()
        end, { desc = "Execute opencode action…" })
        vim.keymap.set({ "n", "t" }, "<C-.>", function()
            require("opencode").toggle()
        end, { desc = "Toggle opencode" })

        vim.keymap.set({ "n", "x" }, "<leader>go", function()
            return require("opencode").operator("@this ")
        end, { desc = "Add range to opencode", expr = true })
        vim.keymap.set("n", "<leader>goo", function()
            return require("opencode").operator("@this ") .. "_"
        end, { desc = "Add line to opencode", expr = true })

        vim.keymap.set("n", "<S-C-u>", function()
            require("opencode").command("session.half.page.up")
        end, { desc = "Scroll opencode up" })
        vim.keymap.set("n", "<S-C-d>", function()
            require("opencode").command("session.half.page.down")
        end, { desc = "Scroll opencode down" })
    end,
}
