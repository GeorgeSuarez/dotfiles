return {
    "nvim-lualine/lualine.nvim",
    dependencies = { "nvim-tree/nvim-web-devicons" },
    config = function()
        local lualine = require("lualine")
        local lazy_status = require("lazy.status") -- to configure lazy pending updates count

        -- configure lualine with built-in tokyonight theme (matches colorscheme)
        lualine.setup({
            options = {
                theme = "tokyonight",
            },
            sections = {
                lualine_x = {
                    {
                        lazy_status.updates,
                        cond = lazy_status.has_updates,
                        color = { fg = "#ff9e64" },
                    },
                    { "encoding" },
                    { "fileformat", symbols = { unix = "" } },
                    { "filetype" },
                },
            },
        })
    end,
}
