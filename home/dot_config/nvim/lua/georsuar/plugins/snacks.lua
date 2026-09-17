return {
    "folke/snacks.nvim",
    priority = 1000,
    lazy = false,
    ---@type snacks.Config
    opts = {
        bigFile = { enabled = true },
        dashboard = { enabled = true },
        input = { enabled = true },
        explorer = {
            enabled = true,
            replace_netrw = true,
        },

        picker = {
            enabled = true,
            sources = {
                explorer = {
                    diagnostics = true,
                    git_status = true,
                },
            },
        },
        notifier = {
            enabled = true,
            timeout = 3000,
            style = "fancy",
        },
        rename = { enabled = true },
        toggle = { enabled = true },
        quickfile = { enabled = true },
        scope = { enabled = true },
        scroll = { enabled = true },
        statuscolumn = { enabled = true },
        indent = { enabled = true },
        words = { enabled = true },
        bufdelete = { enabled = true },
    },
    keys = {
        {
            "<leader>ee",
            function()
                Snacks.explorer()
            end,
            desc = "File Explorer",
        },
        {
            "<leader>er",
            function()
                Snacks.explorer.reveal()
            end,
            desc = "Reveal current file in explorer",
        },
        {
            "<leader>ff",
            function()
                Snacks.picker.files()
            end,
            desc = "Find files in cwd",
        },
        {
            "<leader>fs",
            function()
                Snacks.picker.grep()
            end,
            desc = "Live grep in cwd",
        },
        {
            "<leader>fc",
            function()
                Snacks.picker.grep_word()
            end,
            mode = { "n", "x" },
            desc = "Grep current word/selection",
        },
        {
            "<leader>n",
            function()
                Snacks.notifier.show_history()
            end,
            desc = "Notification History",
        },
        {
            "<leader>un",
            function()
                Snacks.notifier.hide()
            end,
            desc = "Dismiss All Notifications",
        },
        {
            "<leader>sd",
            function()
                Snacks.picker.diagnostics()
            end,
            desc = "Workspace Diagnostics",
        },
        {
            "<leader>sD",
            function()
                Snacks.picker.diagnostics_buffer()
            end,
            desc = "Buffer Diagnostics",
        },
        {
            "<leader>td",
            function()
                Snacks.toggle.diagnostics().toggle()
            end,
            desc = "Toggle Diagnostics",
        },
        {
            "<leader>sm",
            function()
                Snacks.toggle.zoom():toggle()
            end,
            desc = "Maximize/minimize a split",
        },
        {
            "<leader>th",
            function()
                Snacks.toggle.inlay_hints():toggle()
            end,
            desc = "Toggle Inlay Hints",
        },
        {
            "]]",
            function()
                Snacks.words.jump(vim.v.count1)
            end,
            desc = "Next Reference",
            mode = { "n", "t" },
        },
        {
            "[[",
            function()
                Snacks.words.jump(-vim.v.count1)
            end,
            desc = "Prev Reference",
            mode = { "n", "t" },
        },
    },
    init = function()
        vim.api.nvim_create_autocmd("User", {
            pattern = "VeryLazy",
            callback = function()
                _G.dd = function(...)
                    Snacks.debug.inspect(...)
                end
                _G.bt = function()
                    Snacks.debug.backtrace()
                end
                Snacks.toggle.diagnostics():map("<leader>ud")
            end,
        })
    end,
    config = function(_, opts)
        require("snacks").setup(opts)

        vim.diagnostic.config({
            underline = true,
            update_in_insert = false,
            severity_sort = true,
            signs = {
                text = {
                    [vim.diagnostic.severity.ERROR] = " ",
                    [vim.diagnostic.severity.WARN] = " ",
                    [vim.diagnostic.severity.INFO] = " ",
                    [vim.diagnostic.severity.HINT] = "󰠠 ",
                },
            },
            virtual_text = {
                spacing = 4,
                prefix = "",
                source = "if_many",
            },
            float = {
                border = "rounded",
                source = true,
            },
        })
    end,
}
