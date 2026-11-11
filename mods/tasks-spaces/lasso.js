// lasso's additions to the shipped `spaces` mod. main.js stays Herdr's file plus one-line hooks
// into this one, so `herdr-mods-sync` can merge upstream changes into it cleanly.
//   - the Work board (mods/tasks) is a page in "work-stack": picking a space leaves it, and no
//     space looks selected while it shows
//   - every row is ROW tall, as the footer rows
//   - New work: a hover "+" on a space, and a row per queued job (mods/new-work)
//   - the collapsed rail shows each space's colored tile (a worktree: its branch mark)
import { div, svg } from "gpui-kit";
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
// The row goes when that space shows; a failure stays on the row until clicked.
// ponytail: exec stops a program after 30 s; a slow LLM pick near that shows as a failure.
export const jobs = () => shared("newwork.jobs") ?? [];
const saveJob = (id, change) => setShared("newwork.jobs", jobs().flatMap((j) => (j.id !== id ? [j] : change ? [{ ...j, ...change }] : [])));

// Each tick: start queued jobs, drop finished ones. `place(s, panes)` is the stock helper.
export function runJobs(view, now, sp, ps, place, cx) {
  view.running ??= new Set(); // new work jobs this copy runs
  for (const j of jobs()) {
    if (j.dir) {
      // Done: the row stays until its space shows (or a few seconds pass).
      if (now - j.done > 5000 || sp.some((s) => view.shown.has(s.id) && place(s, ps)?.startsWith(j.dir))) saveJob(j.id, null);
    } else if (j.started && !j.error && !view.running.has(j.id)) {
      saveJob(j.id, { error: "Stopped: Herdr restarted while it ran." });
    } else if (!j.started) {
      view.running.add(j.id);
      saveJob(j.id, { started: now });
      cx.spawn(async (cx) => {
        const r = await exec(`${appHome()}/bin/herdr-open-work`, j.args).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
        view.running.delete(j.id);
        const dir = r.code === 0 && r.stdout.trim().split("\n").pop();
        saveJob(j.id, dir ? { dir, done: Date.now() } : { error: r.stderr.trim().split("\n").pop() || `Failed (exit ${r.code}).` });
        cx.notify();
      });
    }
  }
}

function jobRow(j, t, collapsed) {
  const failed = Boolean(j.error);
  return h_flex().id(`job-${j.id}`).h(ROW).px(8).flex_none().gap(9).items_center().rounded(8)
    .text_color(t.dim).hover((s) => s.bg(t.hover))
    .when(failed, (el) => el.cursor_pointer().tooltip(`${j.error} Click to dismiss.`).on_click(() => saveJob(j.id, null)))
    .child(h_flex().size(18).flex_none().rounded(5).border_1().border_color(failed ? t.blocked : t.input).items_center().justify_center().text_size(10.5).child(failed ? "!" : "…"))
    .when(!collapsed, (el) => el
      .child(div().flex_shrink(0).max_w(150).truncate().text_color(t.muted).child(j.label))
      .child(div().flex_1())
      .child(div().flex_none().text_size(11.5).text_color(failed ? t.blocked : t.dim)
        .child(failed ? "failed" : j.repo && j.repo !== "auto" ? `${j.repo} · starting…` : "finding repo…")));
}
export const jobRows = (t, collapsed) => jobs().map((j) => jobRow(j, t, collapsed));

// The space's colored letter tile, as the stock row draws it. `MARK` is the stock palette.
function tile(w, t, MARK) {
  const color = (shared("space.colors") ?? {})[w.id] ?? "ansi6";
  const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
  return h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?");
}

// The rail: the tile (a worktree: its branch mark), centered, its name as a tooltip.
export function compactTile({ w, tree }, t, MARK) {
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
    .child(tree ? svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim) : tile(w, t, MARK));
}

// The "Spaces" header: taller, with its "+" centered on the rail.
export const header = (collapsed, t) => h_flex().h(36).pt(5).pl(16).pr(10).when(collapsed, el => el.px(0)).items_center()
  .when(collapsed, el => el.justify_center()).when(!collapsed, el => el.justify_between()).text_size(11.5).font_medium().text_color(t.dim);
