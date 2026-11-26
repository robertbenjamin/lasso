// lasso's additions to the stock `spaces` mod, called from one-line hooks in main.js.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, openOverlay, shared, setShared, spaces, panes } from "herdr";
import {
  pastelFill,
  boardShown as onBoard,
  keepConfFresh,
  repoAlias,
  sectionHeader,
  sectionFolded,
  SECTION_HEADER,
} from "./lib/shared.js";
export {
  pastelFill,
  solid,
  fadeText as fadeName,
  boardShown as onBoard,
  tourVeil,
} from "./lib/shared.js";

export const ROW = 32;

export { keepConfFresh };
export const spaceName = (space) => repoAlias(space.name);

// A repo's worktree spaces nest under its main checkout's space. With that space closed, the
// first worktree space stands in for it, so a repo is one group, never a row per worktree.
export function headless(list) {
  const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
  return list.map((r) => {
    if (!r.g?.linked || mains.has(r.g.repo)) return r;
    mains.add(r.g.repo);
    return { ...r, g: { ...r.g, linked: false } };
  });
}

export function selectSpace(id) {
  run("space.select", { id });
  if (onBoard()) run("layout.select", { stack: "work-stack", child: "work" });
}

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

// New work jobs: mods/lasso-data runs them, this draws a row for each until its space shows.
const jobs = () => shared("newwork.jobs") ?? [];
const dismiss = (id) =>
  setShared(
    "newwork.jobs",
    jobs().filter((j) => j.id !== id),
  );

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
        .on_click(() => dismiss(job.id)),
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
// `shown`: ids of the spaces the list shows. `place(space, panes)` is the stock helper.
export function jobRows(t, collapsed, shown, place) {
  const ps = panes();
  const shows = (dir) => spaces().some((s) => shown.has(s.id) && place(s, ps)?.startsWith(dir));
  return jobs()
    .filter((job) => !job.dir || !shows(job.dir))
    .map((job) => jobRow(job, t, collapsed));
}

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
    .child([...spaceName(space)][0]?.toUpperCase() ?? "?");
}

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
    .tooltip(spaceName(space))
    .on_click(() => selectSpace(space.id))
    .child(
      tree ? svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim) : tile(space, t),
    );
}

// The list's header, with the stock + after it. On the rail: only +, centered.
export function header(collapsed, t, view) {
  // Folding hides the row under the pointer, so its hover never ends: end it here.
  if (sectionFolded("spaces") && view.hoverSpace) {
    view.hoverSpace = null;
    setShared("space.hover", null);
  }
  return collapsed
    ? h_flex().h(SECTION_HEADER).flex_none().justify_center().items_center().text_color(t.dim)
    : sectionHeader(t, { id: "spaces", title: "Spaces", key: "⌘⇧B" });
}
