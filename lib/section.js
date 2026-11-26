import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, run, shared, setShared } from "herdr";
import { find } from "./config.js";

// The sidebar's sections (Spaces, Agents) as collapsible sections: a header row of one height,
// whose chevron and title fold the section to that row, and its actions on the right.
// Folding is Herdr's own layout.resize on the section's layout block, kept per screen.
export const SECTION_HEADER = 36; // as tall as the Work row above, so the rows keep one rhythm

export const sectionFolded = (id) => find(layout(), id)?.size?.px === SECTION_HEADER;

// Unfolded, a section gets back the share it had.
export function toggleSection(id) {
  if (sectionFolded(id)) return run("layout.resize", { id, weight: shared(`${id}.weight`) ?? 1 });
  setShared(`${id}.weight`, find(layout(), id)?.size?.weight ?? 1);
  run("layout.resize", { id, px: SECTION_HEADER });
}

// `height`: less than SECTION_HEADER when the block has a top border, so it folds to the same px.
export const sectionHeader = (t, { id, title, key, height = SECTION_HEADER }) => {
  const folded = sectionFolded(id);
  return h_flex()
    .h(height)
    .flex_none()
    .pl(12)
    .pr(10)
    .items_center()
    .text_size(11.5)
    .font_medium()
    .text_color(t.dim)
    .child(
      h_flex()
        .id(`${id}-fold`)
        .flex_1()
        .h_full()
        .gap(6)
        .items_center()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .tooltip(`${folded ? "Show" : "Fold"} ${title.toLowerCase()}${key ? ` (${key})` : ""}`)
        .on_click(() => toggleSection(id))
        .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11))
        .child(title),
    );
};

// A header action (+, sort): the same box everywhere, so they line up on the right edge.
export const sectionAction = (t, id) =>
  div()
    .id(id)
    .size(26)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(6)
    .hover((s) => s.bg(t.hover).text_color(t.foreground));
