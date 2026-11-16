import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, exec, layout, updates, notify, appHome } from "herdr";

// The sidebar footer of workspace-chrome (Settings, Add machine) with Claude usage above it.
// The layout gives this block 141px: 1 border + 4 top + 4 rows of 32 + 8 bottom.

// ponytail: borrows Claude Code's OAuth token read-only and never refreshes it (a refresh
// rotates it under Claude Code). Expired token: last numbers stay until Claude Code refreshes.
// The endpoint is the undocumented one behind /usage; it may change.
const FETCH = `security find-generic-password -s "Claude Code-credentials" -w \
| jq -r '"Authorization: Bearer " + .claudeAiOauth.accessToken' \
| curl -sf -m 15 -H @- -H 'anthropic-beta: oauth-2025-04-20' https://api.anthropic.com/api/oauth/usage`;

const GAP = 9; // the Settings row's gap, used everywhere in a row

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Time until the 5h window resets: "2h 05m", "38m".
function untilText(at) {
  const total = Math.ceil((at - Date.now()) / 60e3);
  if (!(total > 0)) return "now";
  const h = Math.floor(total / 60), m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export default class ClaudeFooter extends View {
  init(_props, cx) {
    this.usage = null;
    this.refresh(cx);
    this.checkClones(cx);
    cx.timer.every(5 * 60e3, (cx) => this.refresh(cx));
    cx.timer.every(60e3, (cx) => cx.notify()); // countdowns are in minutes
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", FETCH]);
        if (r.code === 0) { this.usage = JSON.parse(r.stdout); cx.notify(); }
      } catch {}
    });
  }

  // lasso's clones of shipped mods (tasks, tasks-*) don't get Herdr's updates. Once per start,
  // when one is based on an older Herdr, say so; clicking opens a tab with the details.
  checkClones(cx) {
    const sync = `${appHome()}/bin/herdr-mods-sync`;
    cx.spawn(async () => {
      try {
        const r = await exec(sync, ["status", "--quiet"]);
        if (r.code !== 1 || !r.stdout.trim()) return;
        notify({ title: "lasso mods are behind Herdr", body: `${r.stdout.trim()}\nRun herdr-mods-sync merge.`, level: "warning",
          action: { name: "terminal.open", args: { argv: ["sh", "-c", `"${sync}" status; exec "\${SHELL:-zsh}"`], place: "tab" } } });
      } catch {}
    });
  }

  // `countdown`: the label is the time until this window resets (the clock icon says so).
  usageRow(key, label, icon, collapsed, countdown) {
    const t = theme();
    const w = this.usage?.[key];
    const pct = Math.round(w?.utilization ?? 0);
    const color = pct >= 90 ? t.blocked : pct >= 75 ? t.working : t.muted;
    if (countdown && w) label = untilText(Date.parse(w.resets_at));
    // The rail has no room for a bar: only the percent, its window in a tooltip.
    if (collapsed) return h_flex().id(`${key}-rail`).h(32).justify_center().items_center().text_size(11.5).text_color(color)
      .tooltip(countdown ? `5h window, resets in ${label}` : label).child(w ? `${pct}%` : "–");
    return h_flex().h(32).px(8).gap(GAP).items_center().text_color(t.muted)
      .child(h_flex().size(18).flex_none().rounded(5).items_center().justify_center().child(svg(icon).size(14)))
      .when(!collapsed, (el) => el.child(div().w(46).flex_none().whitespace_nowrap().child(label)))
      .child(div().flex_1().min_w(0).h(4).rounded_full().bg(t.border)
        .child(div().id(`${key}-fill`).h_full().rounded_full().bg(color).w(`${pct}%`)
          .transition("width", { duration: 450, easing: "ease-out" })))
      // A fixed, right-aligned column: the percents line up across both rows.
      .when(!collapsed, (el) => el
        .child(div().w(30).flex_none().text_right().text_size(12).whitespace_nowrap().child(w ? `${pct}%` : "–")));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const row = (id, icon, label, dim, action) => h_flex().id(id).h(32).px(8).gap(GAP).items_center().rounded(8).when(collapsed, el => el.justify_center().tooltip(label))
      .text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
      .on_click(action).child(h_flex().size(18).flex_none().rounded(5).items_center().justify_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(14)))
      .when(!collapsed, el => el.child(label));
    return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).pt(4).pb(8).text_size(13)
      .child(this.usageRow("five_hour", "5h", "mods/workspace-chrome/clock.svg", collapsed, true))
      .child(this.usageRow("seven_day", "Week", "mods/claude-footer/calendar.svg", collapsed))
      .child(row("settings", "settings", "Settings", false, () => run("app.settings"))
        .when(Boolean(updates().app.ready), el => el.child(div().size(6).rounded_full().bg(t.accent))))
      .child(row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })));
  }
}
