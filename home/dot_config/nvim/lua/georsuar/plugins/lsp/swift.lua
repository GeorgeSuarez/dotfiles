return {
    {
        "wojciech-kulik/xcodebuild.nvim",
        dependencies = {
            "MunifTanjim/nui.nvim",
        },
        config = function()
            require("xcodebuild").setup({
                nvim_tree = {
                    enabled = false,
                },
            })
        end,
    },
}
