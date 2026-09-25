return {
    "saghen/blink.cmp",
    version = "1.*",
    event = "VeryLazy",
    dependencies = {
        "L3MON4D3/LuaSnip",
        "rafamadriz/friendly-snippets",
    },
    opts = {
        keymap = {
            ["<C-k>"] = { "select_prev", "show_signature", "hide_signature", "fallback" }, -- previous suggestion
            ["<C-j>"] = { "select_next", "fallback" }, -- next suggestion
            ["<C-u>"] = { "scroll_documentation_up", "fallback" },
            ["<C-d>"] = { "scroll_documentation_down", "fallback" },
            ["<C-Space>"] = { "show", "show_documentation", "hide_documentation" }, -- show completion suggestions
            ["<C-e>"] = { "hide", "fallback" }, -- close completion window
            ["<CR>"] = { "accept", "fallback" }, -- accept only when something is selected
            ["<Tab>"] = {
                function(cmp)
                    if cmp.snippet_active() then
                        return cmp.snippet_forward()
                    else
                        return cmp.select_next()
                    end
                end,
                "fallback",
            },
        },
        appearance = {
            nerd_font_variant = "mono",
            use_nvim_cmp_as_default = false,
        },
        completion = {
            trigger = {
                show_in_snippet = false,
                show_on_trigger_character = true,
            },
            menu = {
                border = "rounded",
                max_height = 10,
                draw = {
                    columns = {
                        { "kind_icon" },
                        { "label", "label_description", gap = 1 },
                        { "source_name" },
                    },
                    components = {
                        source_name = {
                            text = function(ctx)
                                local source_names = {
                                    lsp = "[LSP]",
                                    buffer = "[Buffer]",
                                    path = "[Path]",
                                    snippets = "[Snippets]",
                                }
                                return source_names[ctx.source_name] or ("[" .. ctx.source_name .. "]")
                            end,
                            highlight = "CmpItemMenu",
                        },
                    },
                },
                auto_show = true,
            },
            documentation = {
                auto_show = true,
                window = {
                    border = "rounded",
                },
            },
            ghost_text = {
                enabled = true,
            },
            list = {
                selection = {
                    preselect = true,
                },
            },
            accept = {
                auto_brackets = {
                    enabled = true,
                },
            },
        },
        sources = {
            default = { "lsp", "path", "snippets", "buffer" },
            providers = {
                lsp = {
                    score_offset = 1000,
                },
                path = {
                    score_offset = 3,
                },
                snippets = {
                    score_offset = -100,
                    max_items = 2,
                    min_keyword_length = 3,
                },
                buffer = {
                    score_offset = -150,
                    min_keyword_length = 3,
                },
            },
        },
        snippets = {
            preset = "luasnip",
        },
        signature = {
            enabled = true,
            trigger = {
                show_on_trigger_character = false,
                show_on_insert_on_trigger_character = false,
            },
            window = {
                border = "rounded",
            },
        },
    },
}
