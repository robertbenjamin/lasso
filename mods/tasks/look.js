import { div, image, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import {
  isAlias,
  repoSpace,
  spaceFill,
  corner,
  spinner,
  burst,
  STATUS_SPRING,
  TILE,
  tourVeiled,
} from "./lib/shared.js";

// The space on the repo's main checkout, so worktree agents wear their repo's color.
export { repoSpace };

// Your alias as written (repoAliases in lasso.json), else the label's first 3 letters.
export function spaceCard(t, id, name, label) {
  const { bg, fg } = spaceFill(t, id);
  const code = isAlias(label)
    ? label
    : [...label.replace(/[^\p{L}\p{N}]/gu, "")].slice(0, 3).join("").toUpperCase() || "?";
  return h_flex()
    .id(`space-card-${id}`)
    .h(16)
    .px(4)
    .flex_none()
    .rounded(4)
    .bg(bg)
    .items_center()
    .text_size(9.5)
    .font_semibold()
    .text_color(fg)
    .tooltip(name)
    .child(code);
}

export const spacePill = (t, id, label) => {
  const { bg, fg } = spaceFill(t, id);
  return h_flex()
    .h(18)
    .px(6)
    .flex_none()
    .rounded(5)
    .bg(bg)
    .items_center()
    .text_size(11)
    .font_medium()
    .text_color(fg)
    .child(label);
};

export function icon(program, color) {
  if (!program?.icon) return null;
  return program.tint
    ? svg(program.icon).size(14).flex_none().text_color(color)
    : image(program.icon).w(14).h(14).flex_none();
}

// The dot keeps its last color while it leaves.
const dotColor = new Map();
export function statusIcon(t, id, status, focused, pic, tint, redrawIn) {
  pic ??= div().size(8).rounded(4).bg(t.muted);
  const color = status === "blocked" ? t.blocked : status === "done" ? (t.done ?? t.ansi2) : null;
  if (color) dotColor.set(id, color);
  const tip = { working: "Working", blocked: "Needs you", done: "Done" }[status] ?? "Idle";
  return h_flex()
    .id(`st-${id}`)
    .relative()
    .size(TILE)
    .flex_none()
    .items_center()
    .justify_center()
    .tooltip(tip)
    .child(
      div()
        .id(`st-pic-${id}`)
        .opacity(status === "idle" && !focused ? 0.45 : 1)
        .transition("opacity", 220)
        .child(pic),
    )
    .child(
      corner()
        // Herdr draws a spinning icon above the tour's veil, so the corner fades by itself.
        .when(tourVeiled("agents"), (el) => el.opacity(0.15))
        .child(spinner(tint ?? t.working, id, status === "working", redrawIn))
        // Finished: done, or straight to idle when its tab is on screen (no dot then).
        .child(
          burst(
            id,
            status === "working",
            status === "done" || status === "idle",
            t.done ?? t.ansi2,
          ),
        )
        // It rests at 1px, not 0: the spring overshoots, and a size below zero is undefined.
        .child(
          div()
            .id(`st-dot-${id}`)
            .flex_none()
            .rounded_full()
            .bg(dotColor.get(id) ?? t.blocked)
            .w(color ? 7 : 1)
            .h(color ? 7 : 1)
            .spring("width", STATUS_SPRING)
            .spring("height", STATUS_SPRING)
            .opacity(color ? 1 : 0)
            .transition("opacity", color ? { duration: 120, delay: 60 } : 140),
        ),
    );
}

export function statusMark(t, status, id) {
  const dot = (color) =>
    div().id(`mark-${id}-${status}`).size(7).mx(3).flex_none().rounded(4).bg(color);
  if (status === "working")
    return dot(t.working).loop("opacity", {
      from: 0.35,
      to: 1,
      period: 2100,
      easing: "ease-in-out",
    });
  if (status === "blocked") return dot(t.blocked);
  if (status === "done") return dot(t.done ?? t.ansi2);
  return div()
    .size(7)
    .mx(3)
    .flex_none()
    .rounded(4)
    .border(1.5)
    .border_color(t.idle ?? t.dim);
}

// Board rows have the prefix "w-" in both maps; agent rows have "ag-" in view.fit only.
export function forget(view, alive, prefix) {
  const onBoard = prefix === "w-";
  for (const key of view.fit?.keys() ?? [])
    if (key.startsWith(prefix) && !alive.has(key.slice(prefix.length))) view.fit.delete(key);
  for (const key of dotColor.keys())
    if (onBoard === key.startsWith("w-") && !alive.has(onBoard ? key.slice(2) : key))
      dotColor.delete(key);
}
