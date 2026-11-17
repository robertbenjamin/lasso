// lasso's additions to the shipped `spaces` mod. main.js stays Herdr's file plus one-line hooks
// into this one, so `herdr-mods-sync` can merge upstream changes into it cleanly.
//   - the Work board (mods/tasks) is a page in "work-stack": picking a space leaves it, and no
//     space looks selected while it shows
//   - every row is ROW tall, as the footer rows
//   - New work: a hover "+" on a space, and a row per queued job (mods/new-work)
//   - the collapsed rail shows each space's colored tile (a worktree: its branch mark)
import { div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, exec, openOverlay, shared, setShared, layout, appHome } from "herdr";

export const ROW = 32;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
export const onBoard = () => find(layout(), "work-stack")?.active === "board-page";
export function selectSpace(id) {
  run("space.select", { id });
  if (onBoard()) run("layout.select", { stack: "work-stack", child: "work" });
}

// New work, as in Conductor: the hover "+" on a space opens the New work dialog
// (mods/new-work) for that space's repo. cmd-shift-n opens it for the focused one.
const newWork = (s) => openOverlay({ mod: "new-work", kind: "dialog", width: 540, height: 400, props: { space: s.id } });

export function trackHover(view, w, over, cx) {
  if (over) view.hoverSpace = w.id;
  else if (view.hoverSpace === w.id) view.hoverSpace = null;
  // The agents list (mods/tasks) dims other spaces' agents while one space is hovered.
  if ((shared("space.hover") ?? null) !== view.hoverSpace) setShared("space.hover", view.hoverSpace);
  cx.notify();
}

export const newWorkButton = (w, t) =>
  div().id(`space-work-${w.id}`).size(20).flex_none().flex().items_center().justify_center().rounded(5)
    .text_color(t.muted).hover((s) => s.bg(t.raised).text_color(t.foreground))
    .tooltip("New Claude in a worktree (⌘⇧N)")
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); newWork(w); })
    .child(svg("mods/workspace-chrome/plus.svg").size(12));

// New work jobs (shared "newwork.jobs", queued by mods/new-work): a row here at once, while
// bin/herdr-open-work finds the repo, makes the worktree and opens the real space.
// The row goes when that space shows. A failure also opens a background space (a sidebar row) with the job's
// command and its whole stderr, then a shell, so it is there to read after the row is gone.
export const jobs = () => shared("newwork.jobs") ?? [];
const saveJob = (id, change) => setShared("newwork.jobs", jobs().flatMap((j) => (j.id !== id ? [j] : change ? [{ ...j, ...change }] : [])));
function fail(j, error, stderr = "") {
  saveJob(j.id, { error });
  const text = `New work failed: ${j.label}\n$ herdr-open-work ${j.args.join(" ")}\n\n${stderr.trim() || error}\n`;
  run("space.new", { name: "New work failed", argv: ["zsh", "-c", 'print -r -- "$1"; exec "${SHELL:-/bin/zsh}" -l', "nw", text], focus: false });
}

// Each tick: start queued jobs, drop finished ones. `place(s, panes)` is the stock helper.
export function runJobs(view, now, sp, ps, place, cx) {
  view.running ??= new Set(); // new work jobs this copy runs
  for (const j of jobs()) {
    if (j.dir) {
      // Done: the row stays until its space shows (or a few seconds pass).
      if (now - j.done > 5000 || sp.some((s) => view.shown.has(s.id) && place(s, ps)?.startsWith(j.dir))) saveJob(j.id, null);
    } else if (j.started && !j.error && !view.running.has(j.id)) {
      fail(j, "Stopped: Herdr restarted while it ran.");
    } else if (!j.started) {
      view.running.add(j.id);
      saveJob(j.id, { started: now });
      cx.spawn(async (cx) => {
        // 2 min: a ticket's label lookup, an LLM pick and a fetch can pass exec's 30 s default.
        const r = await exec(`${appHome()}/bin/herdr-open-work`, j.args, { timeout: 120000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
        view.running.delete(j.id);
        const dir = r.code === 0 && r.stdout.trim().split("\n").pop();
        if (dir) saveJob(j.id, { dir, done: Date.now() });
        else fail(j, r.stderr.trim().split("\n").pop() || `Failed (exit ${r.code}).`, r.stderr);
        cx.notify();
      });
    }
  }
}

function jobRow(j, t, collapsed) {
  const failed = Boolean(j.error);
  return h_flex().id(`job-${j.id}`).h(ROW).px(8).flex_none().gap(9).items_center().rounded(8)
    .text_color(t.dim).hover((s) => s.bg(t.hover))
    .when(failed, (el) => el.cursor_pointer().tooltip(`${j.error} The "New work failed" space has the details. Click to dismiss.`).on_click(() => saveJob(j.id, null)))
    .child(h_flex().size(18).flex_none().rounded(5).border_1().border_color(failed ? t.blocked : t.input).items_center().justify_center().text_size(10.5).child(failed ? "!" : "…"))
    .when(!collapsed, (el) => el
      .child(div().flex_shrink(0).max_w(150).truncate().text_color(t.muted).child(j.label))
      .child(div().flex_1())
      .child(div().flex_none().text_size(11.5).text_color(failed ? t.blocked : t.dim)
        .child(failed ? "failed" : j.repo && j.repo !== "auto" ? `${j.repo} · starting…` : "finding repo…")));
}
export const jobRows = (t, collapsed) => jobs().map((j) => jobRow(j, t, collapsed));

// Space tiles from Radix Colors (radix-ui.com/colors, v3): per theme color name, light step 4
// (fill) and 11 (letter), then dark step 5 and 11. A picked #rrggbb stays as is.
const PASTEL = {
  ansi6: ["#ccf3ea", "#008573", "#084843", "#0bd8b6"], // teal
  ansi3: ["#ffdfb5", "#cc4e00", "#562800", "#ffa057"], // orange
  ansi4: ["#d5efff", "#0d74ce", "#004074", "#70b8ff"], // blue
  ansi5: ["#ebe4ff", "#6550b9", "#3c2e69", "#baa7ff"], // violet
  ansi2: ["#daf1db", "#2a7e3b", "#25482d", "#71d083"], // grass
  ansi1: ["#fbdcef", "#c2298a", "#591c47", "#ff8dcc"], // pink
};
const dark = (t) => { const h = (t.chrome ?? "#ffffff").slice(1, 7); return parseInt(h.slice(0, 2), 16) * 0.3 + parseInt(h.slice(2, 4), 16) * 0.59 + parseInt(h.slice(4, 6), 16) * 0.11 < 128; };
// mods/tasks/look.js has the same pastelFill: Herdr loads a mod only from its own folder.
export function pastelFill(t, color) {
  if (color.startsWith("#")) return { bg: color, fg: "#ffffff" };
  const p = PASTEL[color] ?? PASTEL.ansi6;
  return dark(t) ? { bg: p[2], fg: p[3] } : { bg: p[0], fg: p[1] };
}

// The space's colored letter tile, as the stock row draws it.
function tile(w, t) {
  const { bg, fg } = pastelFill(t, (shared("space.colors") ?? {})[w.id] ?? "ansi6");
  return h_flex().size(18).flex_none().rounded(5).bg(bg).items_center().justify_center().text_size(10.5).font_bold().text_color(fg).child([...w.name][0]?.toUpperCase() ?? "?");
}

// The rail: the tile (a worktree: its branch mark), centered, its name as a tooltip.
export function compactTile({ w, tree }, t) {
  const on = w.active && !onBoard();
  return h_flex()
    .id(`space-${w.id}`)
    .h(ROW)
    .flex_none()
    .justify_center()
    .items_center()
    .rounded(8)
    .when(on, (el) => el.bg(t.selected))
    .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
    .tooltip(w.name)
    .on_click(() => selectSpace(w.id))
    .child(tree ? svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim) : tile(w, t));
}

// The "Spaces" header: taller, with its "+" centered on the rail.
export const header = (collapsed, t) => h_flex().h(36).pt(5).pl(16).pr(10).when(collapsed, el => el.px(0)).items_center()
  .when(collapsed, el => el.justify_center()).when(!collapsed, el => el.justify_between()).text_size(11.5).font_medium().text_color(t.dim);

// A space name that fades out at its end instead of an ellipsis, only when it doesn't fit (as
// mods/tasks/look.js does for agent titles). It sizes like the stock name: from its text width,
// giving way down to `min`. `bg` is the row's color.
const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
export function fadeName(text, bg, key, view, min) {
  const fit = (view.fit ??= new Map());
  const over = (f) => (f?.text ?? 0) > (f?.box ?? Infinity) + 0.5;
  const measure = (k) => (size, cx) => {
    const f = fit.get(key) ?? {};
    const was = over(f);
    f[k] = size.width;
    fit.set(key, f);
    if (over(f) !== was) cx.notify();
  };
  return h_flex().id(`fade-${key}`).relative().flex_initial().min_w(min).overflow_hidden().whitespace_nowrap().on_size_change(measure("box"))
    .child(div().id(`fade-text-${key}`).flex_none().on_size_change(measure("text")).child(text))
    .when(over(fit.get(key)), (el) => el.child(div().absolute().top(0).right(0).h_full().w(22)
      .child(globalThis.window.paint_path(RECT(), Background.linear_gradient(90, bg + "00", bg)).absolute().top(0).left(0).size_full())));
}

// A theme color made opaque over `base` (a fade must end in the color the row really shows).
export function solid(c, base) {
  if (!/^#[0-9a-f]{8}$/i.test(c ?? "") || !/^#[0-9a-f]{6}/i.test(base ?? "")) return (c ?? "").slice(0, 7);
  const n = (h, i) => parseInt(h.slice(i, i + 2), 16), a = n(c, 7) / 255;
  return "#" + [1, 3, 5].map((i) => Math.round(n(c, i) * a + n(base, i) * (1 - a)).toString(16).padStart(2, "0")).join("");
}
