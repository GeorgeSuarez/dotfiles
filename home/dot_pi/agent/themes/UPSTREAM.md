# Tokyo Night Storm Improved — upstream

`tokyo-night-storm-improved.json` is a vendored third-party theme, not written here.

| | |
| --- | --- |
| Package | [`pi-theme-tokyo-night-storm-improved`](https://www.npmjs.com/package/pi-theme-tokyo-night-storm-improved) 1.0.0 |
| Source | https://github.com/H1V35/pi-theme-tokyo-night-storm-improved |
| Author | H1V35 |
| License | MIT |
| Fetched | 2026-11-17, from the npm tarball |

The theme file is otherwise verbatim. One change was made on import: `$schema` moved from the
pre-1.2 `raw.githubusercontent.com/earendil-works/pi/.../theme-schema.json` path to
`https://pi.dev/schemas/theme.schema.json`, so editor validation uses the schema pi actually
validates against. `$schema` is metadata only; it does not affect how the theme loads.

The file lives in this tree because pi auto-discovers `~/.pi/agent/themes/*.json` and hot-reloads
the active one, so plain files are enough — installing the npm package would add a dependency to
`agent/npm/` for a single JSON file.

## Updating

Re-download the tarball, replace the JSON, re-apply the `$schema` change above, then load it
through pi's own validator before applying:

```bash
cd "$(npm root -g)/@earendil-works/pi-coding-agent" && node --input-type=module -e '
import { setThemeJsonValidator, loadThemeFromPath } from "./dist/modes/interactive/theme/theme.js";
import { validateThemeJson } from "./dist/modes/interactive/theme/theme-schema.js";
setThemeJsonValidator(validateThemeJson);
console.log(loadThemeFromPath(process.argv[1]).name);
' ~/.pi/agent/themes/tokyo-night-storm-improved.json
```

Note the theme sets `"text": ""`, which means body text uses the terminal's own default
foreground. Pin it to `#c0caf5` if the terminal palette should not bleed into message text.
