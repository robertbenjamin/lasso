// lasso's additions to the stock `spaces` mod: main.js calls these from one-line hooks.
//   - picking a space leaves the Work board (mods/tasks), and no space looks selected on it
//   - New work: a hover "+" on a space, and a row per queued job (mods/new-work)
//   - the collapsed rail shows each space's colored tile (a worktree: its branch mark)
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, exec, openOverlay, shared, setShared, appHome } from "herdr";
import { pastelFill, boardShown as onBoard } from "./shared.js";
export { pastelFill, solid, fadeText as fadeName, boardShown as onBoard } from "./shared.js";

export const ROW = 32;

export function selectSpace(id) {
  run("space.select", { id });
  if (onBoard()) run("layout.select", { stack: "work-stack", child: "work" });
}

// The agents list (mods/tasks) dims other spaces' agents while a space is hovered.
export function trackHover(view, space, over, cx) {
  if (over) view.hoverSpace = space.id;
  else if (view.hoverSpace === space.id) view.hoverSpace = null;
  if ((shared("space.hover") ?? null) !== view.hoverSpace)
    setShared("space.hover", view.hoverSpace);
  cx.notify();
}

export const newWorkButton = (space, t) =>
  div()
    .id(`space-work-${space.id}`)
    .size(20)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(5)
    .text_color(t.muted)
    .hover((s) => s.bg(t.raised).text_color(t.foreground))
    .tooltip("New Claude in a worktree (⌘⇧N)")
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => {
      cx.stop_propagation();
      openOverlay({
        mod: "new-work",
        kind: "dialog",
        width: 540,
        height: 400,
        props: { space: space.id },
      });
    })
    .child(svg("mods/workspace-chrome/plus.svg").size(12));

// New work jobs (shared "newwork.jobs", queued by mods/new-work). Each gets a row here while
// bin/herdr-open-work makes the worktree and opens the real space.
export const jobs = () => shared("newwork.jobs") ?? [];
// change: the fields to set, or null to remove the job.
const saveJob = (id, change) =>
  setShared(
    "newwork.jobs",
    jobs().flatMap((j) => (j.id !== id ? [j] : change ? [{ ...j, ...change }] : [])),
  );

// A failure also opens a background space with the command and its stderr, to read later.
function fail(job, error, stderr = "") {
  saveJob(job.id, { error });
  const text = `New work failed: ${job.label}\n$ herdr-open-work ${job.args.join(" ")}\n\n${stderr.trim() || error}\n`;
  run("space.new", {
    name: "New work failed",
    argv: ["zsh", "-c", 'print -r -- "$1"; exec "${SHELL:-/bin/zsh}" -l', "nw", text],
    focus: false,
  });
}

// Each tick: start queued jobs, drop finished ones. `place(space, panes)` is the stock helper.
export function runJobs(view, now, spaces, panes, place, cx) {
  view.running ??= new Set(); // the jobs this copy runs
  for (const job of jobs()) {
    if (job.dir) {
      // Done: the row stays until its space shows, at most 5 s.
      const spaceShows = spaces.some(
        (s) => view.shown.has(s.id) && place(s, panes)?.startsWith(job.dir),
      );
      if (spaceShows || now - job.done > 5000) saveJob(job.id, null);
    } else if (job.started && !job.error && !view.running.has(job.id)) {
      fail(job, "Stopped: Herdr restarted while it ran.");
    } else if (!job.started) {
      view.running.add(job.id);
      saveJob(job.id, { started: now });
      cx.spawn(async (cx) => {
        // 2 min: the repo pick and the fetch can pass exec's 30 s default.
        const r = await exec(`${appHome()}/bin/herdr-open-work`, job.args, {
          timeout: 120000,
        }).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
        view.running.delete(job.id);
        const dir = r.code === 0 && r.stdout.trim().split("\n").pop();
        if (dir) saveJob(job.id, { dir, done: Date.now() });
        else fail(job, r.stderr.trim().split("\n").pop() || `Failed (exit ${r.code}).`, r.stderr);
        cx.notify();
      });
    }
  }
}

function jobRow(job, t, collapsed) {
  const failed = Boolean(job.error);
  const status = failed
    ? "failed"
    : job.repo && job.repo !== "auto"
      ? `${job.repo} · starting…`
      : "finding repo…";
  return h_flex()
    .id(`job-${job.id}`)
    .h(ROW)
    .px(8)
    .flex_none()
    .gap(9)
    .items_center()
    .rounded(8)
    .text_color(t.dim)
    .hover((s) => s.bg(t.hover))
    .when(failed, (el) =>
      el
        .cursor_pointer()
        .tooltip(`${job.error} The "New work failed" space has the details. Click to dismiss.`)
        .on_click(() => saveJob(job.id, null)),
    )
    .child(
      h_flex()
        .size(18)
        .flex_none()
        .rounded(5)
        .border_1()
        .border_color(failed ? t.blocked : t.input)
        .items_center()
        .justify_center()
        .text_size(10.5)
        .child(failed ? "!" : "…"),
    )
    .when(!collapsed, (el) =>
      el
        .child(div().flex_shrink(0).max_w(150).truncate().text_color(t.muted).child(job.label))
        .child(div().flex_1())
        .child(
          div()
            .flex_none()
            .text_size(11.5)
            .text_color(failed ? t.blocked : t.dim)
            .child(status),
        ),
    );
}
export const jobRows = (t, collapsed) => jobs().map((job) => jobRow(job, t, collapsed));

// The space's colored letter tile, as the stock row draws it.
function tile(space, t) {
  const { bg, fg } = pastelFill(t, (shared("space.colors") ?? {})[space.id] ?? "ansi6");
  return h_flex()
    .size(18)
    .flex_none()
    .rounded(5)
    .bg(bg)
    .items_center()
    .justify_center()
    .text_size(10.5)
    .font_bold()
    .text_color(fg)
    .child([...space.name][0]?.toUpperCase() ?? "?");
}

// A space on the collapsed rail: its tile (a worktree: a branch mark), its name as a tooltip.
export function compactTile({ w: space, tree }, t) {
  const selected = space.active && !onBoard();
  return h_flex()
    .id(`space-${space.id}`)
    .h(ROW)
    .flex_none()
    .justify_center()
    .items_center()
    .rounded(8)
    .when(selected, (el) => el.bg(t.selected))
    .when(!selected, (el) => el.hover((s) => s.bg(t.hover)))
    .tooltip(space.name)
    .on_click(() => selectSpace(space.id))
    .child(
      tree ? svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim) : tile(space, t),
    );
}

// The "Spaces" header: taller, with its "+" centered on the rail.
export const header = (collapsed, t) =>
  h_flex()
    .h(36)
    .pt(5)
    .pl(16)
    .pr(10)
    .when(collapsed, (el) => el.px(0))
    .items_center()
    .when(collapsed, (el) => el.justify_center())
    .when(!collapsed, (el) => el.justify_between())
    .text_size(11.5)
    .font_medium()
    .text_color(t.dim);
