return {
    {
        "nvim-treesitter/nvim-treesitter",
        branch = "main",
        lazy = false,
        build = ":TSUpdate",
        dependencies = {
            "nvim-treesitter/nvim-treesitter-textobjects",
        },
        config = function()
            local ts_parsers = {
                "json",
                "javascript",
                "typescript",
                "tsx",
                "yaml",
                "html",
                "css",
                "markdown",
                "markdown_inline",
                "bash",
                "lua",
                "vim",
                "gitignore",
                "vimdoc",
                "swift",
                "c",
                "cpp",
                "go",
                "python",
                "c_sharp",
                "razor",
            }

            require("nvim-treesitter").setup {}

            -- install missing parsers in the background (no-op when already installed)
            require("nvim-treesitter").install(ts_parsers)

            -- folds (provided by Neovim core)
            vim.opt.foldmethod = "expr"
            vim.opt.foldexpr = "v:lua.vim.treesitter.foldexpr()"

            -- highlighting (Neovim core) and indentation (nvim-treesitter, experimental)
            vim.api.nvim_create_autocmd("FileType", {
                callback = function()
                    -- get_parser returns nil (not an error) when no parser exists,
                    -- so check its return value before calling start (which asserts)
                    if vim.treesitter.get_parser(0) then
                        vim.treesitter.start()
                        vim.bo.indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
                    end
                end,
            })

            -- textobjects: configured via its own setup; keymaps bound explicitly
            local textobjects = require("nvim-treesitter-textobjects")

            textobjects.setup({
                select = {
                    lookahead = true,
                },
                move = {
                    set_jumps = true,
                },
            })

            local select = require("nvim-treesitter-textobjects.select")
            local select_keymaps = {
                ["a="] = { query = "@assignment.outer", desc = "Select outer part of an assignment" },
                ["i="] = { query = "@assignment.inner", desc = "Select inner part of an assignment" },
                ["l="] = { query = "@assignment.lhs", desc = "Select left hand side of an assignment" },
                ["r="] = { query = "@assignment.rhs", desc = "Select right hand side of an assignment" },
                -- custom captures from after/queries/ecma/textobjects.scm
                ["a:"] = { query = "@property.outer", desc = "Select outer part of an object property" },
                ["i:"] = { query = "@property.inner", desc = "Select inner part of an object property" },
                ["l:"] = { query = "@property.lhs", desc = "Select left part of an object property" },
                ["r:"] = { query = "@property.rhs", desc = "Select right part of an object property" },
                ["aa"] = { query = "@parameter.outer", desc = "Select outer part of a parameter/argument" },
                ["ia"] = { query = "@parameter.inner", desc = "Select inner part of a parameter/argument" },
                ["ai"] = { query = "@conditional.outer", desc = "Select outer part of a conditional" },
                ["ii"] = { query = "@conditional.inner", desc = "Select inner part of a conditional" },
                ["al"] = { query = "@loop.outer", desc = "Select outer part of a loop" },
                ["il"] = { query = "@loop.inner", desc = "Select inner part of a loop" },
                ["af"] = { query = "@call.outer", desc = "Select outer part of a function call" },
                ["if"] = { query = "@call.inner", desc = "Select inner part of a function call" },
                ["am"] = { query = "@function.outer", desc = "Select outer part of a method/function definition" },
                ["im"] = { query = "@function.inner", desc = "Select inner part of a method/function definition" },
                ["ac"] = { query = "@class.outer", desc = "Select outer part of a class" },
                ["ic"] = { query = "@class.inner", desc = "Select inner part of a class" },
            }

            for _, mode in ipairs { "x", "o" } do
                for key, spec in pairs(select_keymaps) do
                    vim.keymap.set(mode, key, function()
                        select.select_textobject(spec.query, "textobjects", mode)
                    end, { desc = spec.desc })
                end
            end

            local swap = require("nvim-treesitter-textobjects.swap")
            local swap_next_keymaps = {
                ["<leader>na"] = { query = "@parameter.inner", desc = "Swap parameter with next" },
                ["<leader>n:"] = { query = "@property.outer", desc = "Swap object property with next" },
                ["<leader>nm"] = { query = "@function.outer", desc = "Swap function with next" },
            }
            local swap_prev_keymaps = {
                ["<leader>pa"] = { query = "@parameter.inner", desc = "Swap parameter with previous" },
                ["<leader>p:"] = { query = "@property.outer", desc = "Swap object property with previous" },
                ["<leader>pm"] = { query = "@function.outer", desc = "Swap function with previous" },
            }

            for key, spec in pairs(swap_next_keymaps) do
                vim.keymap.set("n", key, function()
                    swap.swap_next(spec.query)
                end, { desc = spec.desc })
            end
            for key, spec in pairs(swap_prev_keymaps) do
                vim.keymap.set("n", key, function()
                    swap.swap_previous(spec.query)
                end, { desc = spec.desc })
            end

            local move = require("nvim-treesitter-textobjects.move")
            local move_keymaps = {
                goto_next_start = {
                    ["]f"] = { query = "@call.outer", desc = "Next function call start" },
                    ["]m"] = { query = "@function.outer", desc = "Next method/function def start" },
                    ["]c"] = { query = "@class.outer", desc = "Next class start" },
                    ["]i"] = { query = "@conditional.outer", desc = "Next conditional start" },
                    ["]l"] = { query = "@loop.outer", desc = "Next loop start" },
                    ["]s"] = { query = "@scope", query_group = "locals", desc = "Next scope" },
                    ["]z"] = { query = "@fold", query_group = "folds", desc = "Next fold" },
                },
                goto_next_end = {
                    ["]F"] = { query = "@call.outer", desc = "Next function call end" },
                    ["]M"] = { query = "@function.outer", desc = "Next method/function def end" },
                    ["]C"] = { query = "@class.outer", desc = "Next class end" },
                    ["]I"] = { query = "@conditional.outer", desc = "Next conditional end" },
                    ["]L"] = { query = "@loop.outer", desc = "Next loop end" },
                },
                goto_previous_start = {
                    ["[f"] = { query = "@call.outer", desc = "Prev function call start" },
                    ["[m"] = { query = "@function.outer", desc = "Prev method/function def start" },
                    ["[c"] = { query = "@class.outer", desc = "Prev class start" },
                    ["[i"] = { query = "@conditional.outer", desc = "Prev conditional start" },
                    ["[l"] = { query = "@loop.outer", desc = "Prev loop start" },
                },
                goto_previous_end = {
                    ["[F"] = { query = "@call.outer", desc = "Prev function call end" },
                    ["[M"] = { query = "@function.outer", desc = "Prev method/function def end" },
                    ["[C"] = { query = "@class.outer", desc = "Prev class end" },
                    ["[I"] = { query = "@conditional.outer", desc = "Prev conditional end" },
                    ["[L"] = { query = "@loop.outer", desc = "Prev loop end" },
                },
            }

            for fn, keymap in pairs(move_keymaps) do
                for key, spec in pairs(keymap) do
                    vim.keymap.set({ "n", "x", "o" }, key, function()
                        move[fn](spec.query, spec.query_group or "textobjects")
                    end, { desc = spec.desc })
                end
            end

            local ts_repeat_move = require("nvim-treesitter-textobjects.repeatable_move")

            -- vim way: ; goes to the direction you were moving.
            vim.keymap.set({ "n", "x", "o" }, ";", ts_repeat_move.repeat_last_move, { desc = "Repeat last move" })
            vim.keymap.set({ "n", "x", "o" }, ",", ts_repeat_move.repeat_last_move_opposite, { desc = "Repeat last move opposite" })

            -- make builtin f, F, t, T also repeatable with ; and ,
            vim.keymap.set({ "n", "x", "o" }, "f", ts_repeat_move.builtin_f_expr, { desc = "Repeatable f", expr = true })
            vim.keymap.set({ "n", "x", "o" }, "F", ts_repeat_move.builtin_F_expr, { desc = "Repeatable F", expr = true })
            vim.keymap.set({ "n", "x", "o" }, "t", ts_repeat_move.builtin_t_expr, { desc = "Repeatable t", expr = true })
            vim.keymap.set({ "n", "x", "o" }, "T", ts_repeat_move.builtin_T_expr, { desc = "Repeatable T", expr = true })
        end,
    },

    {
        "JoosepAlviste/nvim-ts-context-commentstring",
        config = function()
            vim.g.skip_ts_context_commentstring_module = true
        end,
        opts = {
            options = {
                c = { __default = "// %s", __multiline = "/* %s */" },
                cpp = { __default = "// %s", __multiline = "/* %s */" },
            },
        },
    },

    {
        "nvim-treesitter/nvim-treesitter-context",
        config = function()
            require("treesitter-context").setup({
                enable = true,
                multiwindow = false,
                max_lines = 4,
                min_window_height = 0,
                line_numbers = true,
                multiline_threshold = 1,
                trim_scope = "outer",
                mode = "cursor",
                zindex = 20,
                on_attach = nil,
            })
        end,
    },
}
