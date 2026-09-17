; extends
; @property captures for javascript/typescript (ecma parser), used by the
; a: / i: / l: / r: textobjects keymaps in treesitter.lua
(pair
  key: (_) @property.lhs
  value: (_) @property.rhs) @property.outer

(pair) @property.inner
