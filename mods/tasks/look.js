// Looks shared by the agents list (lasso.js) and the Work board (board.js).
import { div, image, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { isAlias } from "./work.js";
import { spaceFill, corner, spinner, burst, STATUS_SPRING, TILE } from "./shared.js";

// The space a repo's rows take their color from: the one named after the repo (its main
// checkout), so worktree agents wear their repo's color. None: `fallback`.
export const repoSpace = (spaces, repo, fallback) => spaces.find((s) => s.name === repo)?.id ?? fallback;

// A small card that names the space on a sidebar row with no space header above it:
// your alias as written (repoAliases in lasso.json), else the label's first 3 letters.
export function spaceCard(t, id, name, label) {
  const { bg, fg } = spaceFill(t, id);
  const code = isAlias(label) ? label : [...label.replace(/[^\p{L}\p{N}]/gu, "")].slice(0, 3).join("").toUpperCase() || "?";
  return h_flex().id(`space-card-${id}`).h(16).px(4).flex_none().rounded(4).bg(bg).items_center()
    .text_size(9.5).font_semibold().text_color(fg).tooltip(name).child(code);
}

// The board's roomier version: the whole label.
export const spacePill = (t, id, label) => {
  const { bg, fg } = spaceFill(t, id);
  return h_flex().h(18).px(6).flex_none().rounded(5).bg(bg).items_center().text_size(11).font_medium().text_color(fg).child(label);
};

// The agent's 14px icon from the app's program table: a one-color glyph or a picture.
export function icon(program, color) {
  if (!program?.icon) return null;
  return program.tint ? svg(program.icon).size(14).flex_none().text_color(color) : image(program.icon).w(14).h(14).flex_none();
}

// An agent's icon with its status in its corner: a turning arc while working (in `tint`), a
// dot when blocked or done. The dot keeps its last color while it leaves.
const dotColor = new Map();
export function statusIcon(t, id, status, focused, pic, tint) {
  pic ??= div().size(8).rounded(4).bg(t.muted);
  const color = status === "blocked" ? t.blocked : status === "done" ? (t.done ?? t.ansi2) : null;
  if (color) dotColor.set(id, color);
  const tip = { working: "Working", blocked: "Needs you", done: "Done" }[status] ?? "Idle";
  return h_flex().id(`st-${id}`).relative().size(TILE).flex_none().items_center().justify_center().tooltip(tip)
    .child(div().id(`st-pic-${id}`).opacity(status === "idle" && !focused ? 0.45 : 1).transition("opacity", 220).child(pic))
    .child(corner()
      .child(spinner(tint ?? t.working, id, status === "working", true))
      // Finished: done, or straight to idle when its tab is on screen (it gets no dot then).
      .child(burst(id, status === "working", status === "done" || status === "idle", t.done ?? t.ansi2))
      // It rests at 1px, not 0: the spring overshoots, and a size below zero is undefined.
      .child(div().id(`st-dot-${id}`).flex_none().rounded_full().bg(dotColor.get(id) ?? t.blocked)
        .w(color ? 7 : 1).h(color ? 7 : 1).spring("width", STATUS_SPRING).spring("height", STATUS_SPRING)
        .opacity(color ? 1 : 0).transition("opacity", color ? { duration: 120, delay: 60 } : 140)));
}

// A status dot for a folded group's header, where no icon carries the status.
export function statusMark(t, status, id) {
  const dot = (color) => div().id(`mark-${id}-${status}`).size(7).mx(3).flex_none().rounded(4).bg(color);
  if (status === "working") return dot(t.working).loop("opacity", { from: 0.35, to: 1, period: 2100, easing: "ease-in-out" });
  if (status === "blocked") return dot(t.blocked);
  if (status === "done") return dot(t.done ?? t.ansi2);
  return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
}

// Drops the measured widths (view.fit) and dot colors of rows no longer drawn. Board rows
// have the prefix "w-" in both; agent rows have "ag-" in view.fit and none in the dot colors.
export function forget(view, alive, prefix) {
  const onBoard = prefix === "w-";
  for (const k of view.fit?.keys() ?? []) if (k.startsWith(prefix) && !alive.has(k.slice(prefix.length))) view.fit.delete(k);
  for (const k of dotColor.keys()) if (onBoard === k.startsWith("w-") && !alive.has(onBoard ? k.slice(2) : k)) dotColor.delete(k);
}
