-- Rex keymap, mirroring Herdr.
--
-- Two sources, merged:
--   ~/.config/herdr/config.toml  [keys]  -- the Herdr TUI (prefix = ctrl+a)
--   ~/.config/herdr-app/keys.json        -- the Herdr app's direct chords
--
-- Herdr's workspaces are Rex sessions, Herdr's tabs are Rex tabs, and
-- Herdr's panes are Rex panes. Herdr keys with no Rex counterpart are
-- listed at the bottom of this file.

-- Tabs (herdr: prefixed tabs)
rex.bind("ctrl+a>c", "client.tab.new")            -- new_tab
rex.bind("ctrl+a>n", "client.tab.next")           -- next_tab
rex.bind("ctrl+a>p", "client.tab.previous")       -- previous_tab
rex.bind("ctrl+a>shift+t", "client.tab.rename")   -- rename_tab
rex.bind("ctrl+a>shift+x", "client.tab.close")    -- close_tab
-- switch_tab, prefix+1..9
for index = 1, 9 do
  rex.bind("ctrl+a>" .. index, "client.tab.goto", { index = index })
end

-- Panes
rex.bind("ctrl+a>\\", "pane.split", { direction = "right" })   -- split_vertical = "prefix+backslash"
rex.bind("ctrl+a>enter", "pane.split", { direction = "down" }) -- split_horizontal = "prefix+enter"
rex.bind("ctrl+a>h", "pane.focus", { direction = "left" })     -- focus_pane_left
rex.bind("ctrl+a>j", "pane.focus", { direction = "down" })     -- focus_pane_down
rex.bind("ctrl+a>k", "pane.focus", { direction = "up" })       -- focus_pane_up
rex.bind("ctrl+a>l", "pane.focus", { direction = "right" })    -- focus_pane_right
rex.bind("ctrl+a>shift+h", "pane.move", { direction = "left" })  -- swap_pane_left
rex.bind("ctrl+a>shift+j", "pane.move", { direction = "down" })  -- swap_pane_down
rex.bind("ctrl+a>shift+k", "pane.move", { direction = "up" })    -- swap_pane_up
rex.bind("ctrl+a>shift+l", "pane.move", { direction = "right" }) -- swap_pane_right
rex.bind("ctrl+a>tab", "pane.focus_next")          -- cycle_pane_next
rex.bind("ctrl+a>shift+tab", "pane.focus_previous") -- cycle_pane_previous
rex.bind("ctrl+a>x", "pane.close")                 -- close_pane
rex.bind("ctrl+a>z", "pane.zoom")                  -- zoom
rex.bind("ctrl+a>shift+p", "pane.rename")          -- rename_pane

-- Sessions (herdr: workspaces)
rex.bind("ctrl+a>shift+9", "session.previous")     -- previous_workspace = "prefix+("
rex.bind("ctrl+a>shift+0", "session.next")         -- next_workspace = "prefix+)"
rex.bind("ctrl+a>shift+n", "session.new")          -- new_workspace
rex.bind("ctrl+a>shift+w", "session.rename")       -- rename_workspace
rex.bind("ctrl+a>shift+d", "session.close")        -- close_workspace
rex.bind("ctrl+a>w", "session.switch")             -- workspace_picker

-- Client chrome
rex.bind("ctrl+a>g", "pane.go_to")                 -- goto (the Go To picker)
rex.bind("ctrl+a>space", "client.palette.toggle")  -- command_palette
rex.bind("ctrl+a>s", "client.settings")            -- settings
rex.bind("ctrl+a>b", "client.sidebar.toggle")      -- toggle_sidebar
rex.bind("ctrl+a>shift+r", "client.config.reload") -- reload_config

-- Resize mode (herdr: resize_mode = "prefix+r"; h/j/k/l and shift+h/j/k/l)
rex.mode("resize", { exclusive = true })
rex.bind("ctrl+a>r", "client.mode.enter", { name = "resize" })
rex.bind("resize/h", "pane.resize", { direction = "left", amount = 5 })
rex.bind("resize/j", "pane.resize", { direction = "down", amount = 5 })
rex.bind("resize/k", "pane.resize", { direction = "up", amount = 5 })
rex.bind("resize/l", "pane.resize", { direction = "right", amount = 5 })
rex.bind("resize/shift+h", "pane.resize", { direction = "left", amount = 20 })
rex.bind("resize/shift+j", "pane.resize", { direction = "down", amount = 20 })
rex.bind("resize/shift+k", "pane.resize", { direction = "up", amount = 20 })
rex.bind("resize/shift+l", "pane.resize", { direction = "right", amount = 20 })
rex.bind("resize/left", "pane.resize", { direction = "left", amount = 5 })
rex.bind("resize/down", "pane.resize", { direction = "down", amount = 5 })
rex.bind("resize/up", "pane.resize", { direction = "up", amount = 5 })
rex.bind("resize/right", "pane.resize", { direction = "right", amount = 5 })
rex.bind("resize/escape", "client.mode.exit")
rex.bind("resize/enter", "client.mode.exit")
rex.bind("resize/q", "client.mode.exit")

-- Herdr app chords: tabs
rex.bind("cmd+t", "client.tab.new")                -- cmd-t: tab.new
rex.bind("cmd+w", "client.tab.close")              -- cmd-w: tab.close
rex.bind("f2", "client.tab.rename")                -- f2: tab.rename
rex.bind("ctrl+tab", "client.tab.next")            -- ctrl-tab: tab.next
rex.bind("ctrl+shift+tab", "client.tab.previous")  -- ctrl-shift-tab: tab.prev
rex.bind("shift+cmd+]", "client.tab.next")         -- cmd-shift-]: tab.next
rex.bind("shift+cmd+[", "client.tab.previous")     -- cmd-shift-[: tab.prev
for index = 1, 9 do
  rex.bind("cmd+" .. index, "client.tab.goto", { index = index }) -- cmd-1..9: tab.select
end

-- Herdr app chords: spaces (Rex sessions)
rex.bind("cmd+n", "session.new")                   -- cmd-n: space.new
rex.bind("shift+f2", "session.rename")             -- shift-f2: space.rename
rex.bind("cmd+alt+]", "session.next")              -- cmd-alt-]: space.next
rex.bind("cmd+alt+[", "session.previous")          -- cmd-alt-[: space.prev
-- ctrl-1..9: space.select. Rex selects a session by ID, so the index is
-- resolved against session.list, which is in Herdr's own order.
rex.action{
  name = "herdr_session_goto",
  title = "Go to Session by Number",
  args = { index = "number" },
  run = function(_, args)
    local result, err = rex.call("session.list")
    if not result then
      return nil, err
    end
    local session = (result.sessions or {})[args.index]
    if not session then
      return nil, "there is no session " .. tostring(args.index)
    end
    return rex.client.queue("session.select", { session_id = session.session_id })
  end,
}
for index = 1, 9 do
  rex.bind("ctrl+" .. index, "herdr_session_goto", { index = index })
end

-- Herdr app chords: panes
rex.bind("cmd+d", "pane.split", { direction = "right" })        -- cmd-d: pane.split:right
rex.bind("shift+cmd+d", "pane.split", { direction = "down" })   -- cmd-shift-d: pane.split:down
rex.bind("shift+cmd+w", "pane.close")                           -- cmd-shift-w: pane.close
rex.bind("shift+cmd+enter", "pane.zoom")                        -- cmd-shift-enter: pane.zoom
rex.bind("cmd+alt+left", "pane.focus", { direction = "left" })  -- cmd-alt-left: pane.go:left
rex.bind("cmd+alt+right", "pane.focus", { direction = "right" })
rex.bind("cmd+alt+up", "pane.focus", { direction = "up" })
rex.bind("cmd+alt+down", "pane.focus", { direction = "down" })
rex.bind("cmd+alt+shift+left", "pane.move", { direction = "left" })   -- cmd-alt-shift-left: pane.swap:left
rex.bind("cmd+alt+shift+right", "pane.move", { direction = "right" })
rex.bind("cmd+alt+shift+up", "pane.move", { direction = "up" })
rex.bind("cmd+alt+shift+down", "pane.move", { direction = "down" })
-- cmd-] and cmd-[ are Herdr's agent.next / agent.prev. Rex has no agent
-- navigation, so both keep Rex's defaults: pane.focus_next / pane.focus_previous.

-- Herdr app chords: the app itself
rex.bind("cmd+,", "client.settings")               -- cmd-,: app.settings
rex.bind("shift+cmd+p", "client.palette.toggle")    -- cmd-shift-p: app.palette
rex.bind("cmd+p", "pane.go_to")                    -- cmd-p: mod.open:picker
rex.bind("cmd+b", "client.sidebar.toggle")         -- cmd-b: layout.toggle:sidebar
rex.bind("cmd+shift+l", "client.tab_style.toggle") -- cmd-shift-l: layout.switch
rex.bind("cmd+=", "client.font.increase")          -- cmd-=: app.zoom_in
rex.bind("cmd+-", "client.font.decrease")          -- cmd--: app.zoom_out
rex.bind("cmd+0", "client.font.reset")             -- cmd-0: app.zoom_reset
rex.bind("cmd+f", "client.find.open")              -- cmd-f: terminal.search

-- Herdr app chords: terminal keys. Rex sends these bytes already, apart
-- from alt-backspace, which Herdr binds to ctrl-w (delete the word).
rex.bind("alt+backspace", "pane.send_key", { key = "ctrl+w" })

-- Herdr has no cmd+/ help panel and Rex has no help action, so the key is
-- free; Rex's sidebar toggle moved to cmd+b above.
rex.unbind("cmd+/")

-- Rex defaults displaced by the Herdr chords above, kept on nearby keys.
rex.bind("ctrl+cmd+n", "client.window.new")   -- was cmd+n (now session.new)
rex.bind("ctrl+cmd+w", "client.window.close") -- was shift+cmd+w (now pane.close)

-- Herdr bindings with no Rex counterpart, left unbound:
--   prefix+[          copy mode
--   prefix+e          edit scrollback in $EDITOR
--   prefix+?          help panel
--   prefix+q          detach
--   prefix+shift+g    new worktree
--   prefix+a, prefix+shift+a, prefix+m, prefix+o, prefix+shift+o
--                     annotate plugin actions
--   cmd+alt+h         hide others
--   cmd+/             app help
--   cmd+] / cmd+[     agent.next / agent.prev (Rex keeps pane focus)
--   ctrl+v            paste image
--   cmd+c / cmd+v     copy and paste (Rex handles both natively)
