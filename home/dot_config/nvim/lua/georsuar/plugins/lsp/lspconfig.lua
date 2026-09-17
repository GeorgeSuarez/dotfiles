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
            group = vim.api.nvim_create_augroup("UserLspConfig", { clear = true }),
            callback = function(ev)
                -- Buffer local mappings.
                -- See `:help vim.lsp.*` for documentation on any of the below functions
                local opts = { buffer = ev.buf, silent = true }

                local conform_owned = {
                    javascript = true,
                    typescript = true,
                    javascriptreact = true,
                    typescriptreact = true,
                    svelte = true,
                    css = true,
                    html = true,
                    json = true,
                    yaml = true,
                    markdown = true,
                    grapql = true,
                    lua = true,
                    python = true,
                    c = true,
                    cpp = true,
                    go = true,
                    csharp = true,
                }

                local client = vim.lsp.get_client_by_id(ev.data.client_id)
                if client and conform_owned[vim.bo[ev.buf].filetype] then
                    client.server_capabilities.documentFormattingProvider = false
                    client.server_capabilities.documentRangeFormattingProvider = false
                end

                -- set keybinds
                opts.desc = "Show LSP references"
                keymap.set("n", "gR", vim.lsp.buf.references, opts) -- show definition, references

                opts.desc = "Go to declaration"
                keymap.set("n", "gD", vim.lsp.buf.declaration, opts) -- go to declaration

                opts.desc = "Show LSP definitions"
                keymap.set("n", "gd", vim.lsp.buf.definition, opts) -- show lsp definitions

                opts.desc = "Show LSP implementations"
                keymap.set("n", "gi", vim.lsp.buf.implementation, opts) -- show lsp implementations

                opts.desc = "Show LSP type definitions"
                keymap.set("n", "gt", vim.lsp.buf.type_definition, opts) -- show lsp type definitions

                opts.desc = "See available code actions"
                keymap.set({ "n", "v" }, "<leader>ca", vim.lsp.buf.code_action, opts) -- see available code actions, in visual mode will apply to selection

                opts.desc = "Smart rename"
                keymap.set("n", "<leader>rn", vim.lsp.buf.rename, opts) -- smart rename

                opts.desc = "Show line diagnostics"
                keymap.set("n", "<leader>d", vim.diagnostic.open_float, opts) -- show diagnostics for line

                opts.desc = "Go to previous diagnostic"
                keymap.set("n", "[d", function()
                    vim.diagnostic.jump({
                        count = -1,
                        on_jump = function(_, bufnr)
                            vim.diagnostic.open_float({ bufnr = bufnr, scope = "cursor", focus = false })
                        end,
                    })
                end, opts) -- jump to previous diagnostic in buffer

                opts.desc = "Go to next diagnostic"
                keymap.set("n", "]d", function()
                    vim.diagnostic.jump({
                        count = 1,
                        on_jump = function(_, bufnr)
                            vim.diagnostic.open_float({ buffnr = bufnr, scope = "cursor", focus = false })
                        end,
                    })
                end, opts) -- jump to next diagnostic in buffer

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

                opts.desc = "Document symbols"
                keymap.set("n", "<leader>ds", function()
                    Snacks.picker.lsp_symbols()
                end, opts)

                opts.desc = "Workspace symbols"
                keymap.set("n", "<leader>ws", function()
                    Snacks.picker.lsp_workspace_symbols()
                end, opts)

                if client and client:supports_method("textDocument/inlayHint", ev.buf) then
                    vim.lsp.inlay_hint.enable(true, { bufnr = ev.buf })
                end
            end,
        })

        -- used to enable autocompletion on every language server (blink.cmp)
        vim.lsp.config("*", {
            capabilities = require("blink.cmp").get_lsp_capabilities(),
        })

        vim.lsp.config("lua_ls", {
            settings = {
                Lua = {
                    -- make the language server recognize "vim" global
                    diagnostics = {
                        globals = { "vim" },
                    },
                    runtime = { version = "LuaJIT" },
                    workspace = {
                        checkThirdParty = false,
                    },
                    telemetry = { enabled = false },
                    completion = {
                        callSnippet = "Replace",
                    },
                },
            },
        })
        vim.lsp.enable("lua_ls")

        -- Native TypeScript (tsgo) via `tsc --lsp --stdio` (TypeScript 7+).
        vim.lsp.config("tsc", {
            settings = {
                ["js/ts"] = {
                    inlayHints = {
                        parameterNames = {
                            enabled = "all",
                            suppressWhenArugmentMatchesName = false,
                        },
                        parameterTypes = { enabled = true },
                        variableTypes = { enabled = true },
                        propertyDeclarationTypes = { enabled = true },
                        functionLikeReturnTypes = { enabled = true },
                        enumMemberValues = { enabled = true },
                    },
                    referencesCodeLens = {
                        enabled = false,
                        showOnAllFunctions = false,
                    },
                    implementationsCodeLens = {
                        enabled = false,
                        showOnInterfaceMethods = false,
                        showOnAllClassMethods = false,
                    },
                },
            },
        })
        vim.lsp.enable("tsc")

        vim.lsp.config("jsonls", {
            settings = {
                json = {
                    validate = { enable = true },
                    format = { enable = false },
                },
            },
        })
        vim.lsp.enable("jsonls")

        vim.lsp.config("yamlls", {
            settings = {
                yaml = {
                    validate = true,
                    completion = true,
                    hover = true,
                    format = { enable = false },
                },
            },
        })
        vim.lsp.enable("yamlls")

        -- Roslyn C# language server (mason: roslyn-language-server).
        -- Uses lspconfig's "roslyn_ls" config (auto-enabled by mason-lspconfig).
        -- Homebrew's dotnet shim in Cellar/dotnet/*/bin breaks the tool apphost's
        -- runtime lookup, so put the real muxer first on PATH.
        vim.lsp.config("roslyn_ls", {
            cmd_env = { PATH = "/opt/homebrew/opt/dotnet/libexec:" .. vim.env.PATH },
        })
    end,
}
