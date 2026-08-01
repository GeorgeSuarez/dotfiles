return {
    {
        "mfussenegger/nvim-dap",
        dependencies = {
            "rcarriga/nvim-dap-ui",
            "nvim-neotest/nvim-nio",
            "theHamsta/nvim-dap-virtual-text",
            "williamboman/mason.nvim",
            "jay-babu/mason-nvim-dap.nvim",
        },
        config = function()
            local dap = require("dap")
            local dapui = require("dapui")

            require("mason-nvim-dap").setup({
                ensure_installed = { "codelldb" },
                automatic_installation = true,
                -- an empty handlers table activates the default handler, which
                -- configures dap.adapters automatically for installed servers
                handlers = {},
            })

            dapui.setup()

            require("nvim-dap-virtual-text").setup()

            dap.configurations.cpp = {
                {
                    name = "Launch",
                    type = "codelldb",
                    request = "launch",
                    program = function()
                        return vim.fn.input("Path to executable: ", vim.fn.getcwd() .. "/", "file")
                    end,
                    cwd = "${workspaceFolder}",
                    stopOnEntry = false,
                    args = {},
                },
                {
                    name = "Attach to process",
                    type = "codelldb",
                    request = "attach",
                    pid = require("dap.utils").pick_process,
                    args = {},
                },
            }

            dap.configurations.c = dap.configurations.cpp

            dap.listeners.after.event_initialized["dapui_config"] = function()
                dapui.open()
            end
            dap.listeners.before.event_terminated["dapui_config"] = function()
                dapui.close()
            end
            dap.listeners.before.event_exited["dapui_config"] = function()
                dapui.close()
            end

            vim.keymap.set("n", "<F5>", dap.continue, { desc = "Debug: Start/Continue", silent = true })
            vim.keymap.set("n", "<F10>", dap.step_over, { desc = "Debug: Step Over", silent = true })
            vim.keymap.set("n", "<F11>", dap.step_into, { desc = "Debug: Step Into", silent = true })
            vim.keymap.set("n", "<F12>", dap.step_out, { desc = "Debug: Step Out", silent = true })
            vim.keymap.set(
                "n",
                "<leader>b",
                dap.toggle_breakpoint,
                { desc = "Debug: Toggle Breakpoint", silent = true }
            )
            vim.keymap.set("n", "<leader>B", function()
                dap.set_breakpoint(vim.fn.input("Breakpoint condition: "))
            end, { desc = "Debug: Set Conditional Breakpoint", silent = true })
            vim.keymap.set("n", "<leader>dr", dap.repl.open, { desc = "Debug: Open REPL", silent = true })
            vim.keymap.set("n", "<leader>dl", dap.run_last, { desc = "Debug: Run Last", silent = true })
            vim.keymap.set("n", "<leader>du", dapui.toggle, { desc = "Debug: Toggle UI", silent = true })
        end,
    },
}
