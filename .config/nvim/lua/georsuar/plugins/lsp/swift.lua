return {
	{
		"keith/swift.vim",
		ft = "swift",
		config = function()
			vim.g.swift_developer_completions = 1
		end,
	},

	{
		"wojciech-kulik/xcodebuild.nvim",
		dependencies = {
			"nvim-telescope/telescope.nvim",
			"MunifTanjim/nui.nvim",
			"nvim-tree/nvim-tree.lua",
		},
		config = function()
			require("xcodebuild").setup({})
		end,
	},
}
