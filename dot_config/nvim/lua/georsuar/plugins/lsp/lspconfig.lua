return {
    "neovim/nvim-lspconfig",
    event = { "BufReadPre", "BufNewFile" },
    dependencies = {
        { "antosha417/nvim-lsp-file-operations", config = true },
        { "folke/lazydev.nvim", opts = {} },
    },

    config = function()
        local keymap = vim.keymap -- for conciseness

        vim.api.nvim_create_autocmd("LspAttach", {
            group = vim.api.nvim_create_augroup("UserLspConfig", {}),
            callback = function(ev)
                -- Buffer local mappings.
                -- See `:help vim.lsp.*` for documentation on any of the below functions
                local opts = { buffer = ev.buf, silent = true }

                -- set keybinds
                opts.desc = "Show LSP references"
                keymap.set("n", "gR", "<cmd>Telescope lsp_references<CR>", opts) -- show definition, references

                opts.desc = "Go to declaration"
                keymap.set("n", "gD", vim.lsp.buf.declaration, opts) -- go to declaration

                opts.desc = "Show LSP definitions"
                keymap.set("n", "gd", "<cmd>Telescope lsp_definitions<CR>", opts) -- show lsp definitions

                opts.desc = "Show LSP implementations"
                keymap.set("n", "gi", "<cmd>Telescope lsp_implementations<CR>", opts) -- show lsp implementations

                opts.desc = "Show LSP type definitions"
                keymap.set("n", "gt", "<cmd>Telescope lsp_type_definitions<CR>", opts) -- show lsp type definitions

                opts.desc = "See available code actions"
                keymap.set({ "n", "v" }, "<leader>ca", vim.lsp.buf.code_action, opts) -- see available code actions, in visual mode will apply to selection

                opts.desc = "Smart rename"
                keymap.set("n", "<leader>rn", vim.lsp.buf.rename, opts) -- smart rename

                opts.desc = "Show buffer diagnostics"
                keymap.set("n", "<leader>D", "<cmd>Telescope diagnostics bufnr=0<CR>", opts) -- show  diagnostics for file

                opts.desc = "Show line diagnostics"
                keymap.set("n", "<leader>d", vim.diagnostic.open_float, opts) -- show diagnostics for line

                opts.desc = "Go to previous diagnostic"
                keymap.set("n", "[d", vim.diagnostic.goto_prev, opts) -- jump to previous diagnostic in buffer

                opts.desc = "Go to next diagnostic"
                keymap.set("n", "]d", vim.diagnostic.goto_next, opts) -- jump to next diagnostic in buffer

                opts.desc = "Show documentation for what is under cursor"
                keymap.set("n", "K", vim.lsp.buf.hover, opts) -- show documentation for what is under cursor

                opts.desc = "Restart LSP"
                keymap.set("n", "<leader>rs", function()
                    local clients = vim.lsp.get_clients({ bufnr = 0 })
                    if #clients == 0 then
                        vim.notify("No LSP clients attached to current buffer", vim.log.levels.WARN)
                        return
                    end
                    for _, client in ipairs(clients) do
                        vim.cmd("lsp restart " .. client.name)
                        vim.notify("Lsp client " .. client.name .. " has been restarted.", vim.log.levels.INFO)
                    end
                end, opts) -- mapping to restart lsp if necessary

                opts.desc = "Organize imports"
                keymap.set("n", "<leader>oi", function()
                    vim.lsp.buf.code_action({
                        context = { only = { "source.organizeImports" }, diagnostics = {} },
                        apply = true,
                    })
                end, opts)
            end,
        })

        -- Change the Diagnostic symbols in the sign column (gutter)
        -- (Uses the modern vim.diagnostic.config API; replaces deprecated sign_define)
        vim.diagnostic.config({
            signs = {
                text = {
                    [vim.diagnostic.severity.ERROR] = " ",
                    [vim.diagnostic.severity.WARN] = " ",
                    [vim.diagnostic.severity.HINT] = "󰠠 ",
                    [vim.diagnostic.severity.INFO] = " ",
                },
            },
        })

        -- used to enable autocompletion on every language server (blink.cmp)
        vim.lsp.config("*", {
            capabilities = require("blink.cmp").get_lsp_capabilities(),
        })

        -- shared TypeScript/JavaScript settings for vtsls
        local ts_js_settings = {
            preferences = {
                importModuleSpecifier = "relative",
                includeCompletionsForImportStatements = true,
                includeCompletionsWithSnippetText = true,
                quoteStyle = "single",
            },
            suggest = {
                autoImports = true,
                completeFunctionCalls = true,
            },
            inlayHints = {
                parameterNames = { enabled = "literals" },
                parameterTypes = { enabled = true },
                variableTypes = { enabled = true },
                propertyDeclarationTypes = { enabled = true },
                functionLikeReturnTypes = { enabled = true },
                enumMemberValues = { enabled = true },
            },
        }

        vim.lsp.config("lua_ls", {
            settings = {
                Lua = {
                    -- make the language server recognize "vim" global
                    diagnostics = {
                        globals = { "vim" },
                    },
                    completion = {
                        callSnippet = "Replace",
                    },
                },
            },
        })
        vim.lsp.enable("lua_ls")

        vim.lsp.config("vtsls", {
            settings = {
                typescript = vim.deepcopy(ts_js_settings),
                javascript = vim.deepcopy(ts_js_settings),
            },
        })
        vim.lsp.enable("vtsls")

        -- Roslyn C# language server (installed via the "roslyn" mason package)
        vim.lsp.config("roslyn", {
            cmd = { vim.fn.stdpath("data") .. "/mason/bin/roslyn-language-server", "--stdio" },
            filetypes = { "cs", "csharp" },
            root_markers = { ".sln", ".slnx", ".csproj", ".slnf", "global.json" },
        })
        vim.lsp.enable("roslyn")
    end,
}
