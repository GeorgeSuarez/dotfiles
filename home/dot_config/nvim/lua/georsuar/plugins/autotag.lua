return {
    "windwp/nvim-ts-autotag",
    event = { "BufReadPre", "BufNewFile" },
    opts = {
        enable_on_close = true,
        enable_rename = true,
        enable_close_on_slash = false,
    },
}
