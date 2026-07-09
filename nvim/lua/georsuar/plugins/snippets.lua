-- LuaSnip itself is declared in autocomplete.lua (canonical spec, with build step).
-- This file only loads the snipmate-format snippets from ./snippets.
return {
    {
        "L3MON4D3/LuaSnip",
        config = function(_, opts)
            require("luasnip").setup(opts)
            require("luasnip.loaders.from_snipmate").load({ paths = "./snippets" })
        end,
    },
}
