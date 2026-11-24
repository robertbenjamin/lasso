import { div } from "gpui-kit";
import { shared, setShared } from "herdr";

// The tour's demo repo (mods/tour). An agent in one of its worktrees is a scripted one, and
// the Context panel shows it sample data.
export const TOUR_REPO = "lasso-demo";

// While a tour runs, every section of lasso adds `.children(tourVeil(t, "its-name"))` to its
// root. That puts a layer over it that takes the clicks, so a click outside the tour cannot
// leave it in a state the tour does not expect: the tour's card says so instead (tourNote).
// mods/tour names in shared "tour.focus" the sections a step is about. The others fade under
// the layer. Mods cannot blur, and only mods can draw this: mods/tour lays a window over the
// terminals.
export const VEIL = "d9"; // 85%, as hex alpha
// A section fades out of focus and back in this long.
export const VEIL_FADE = 260;

export function tourVeiled(section) {
  const focus = shared("tour.step") ? shared("tour.focus") : null;
  return Boolean(focus?.length) && !focus.includes(section);
}

const count = (key) => () => setShared(key, (shared(key) ?? 0) + 1);
// The card says that the tour is on.
export const tourNote = count("tour.noted");
// The same after a press on one of the tour's own windows: a pressed window comes to the
// front, so the card and all that belongs above it open again on top.
export const tourNudge = count("tour.top");

export function tourVeil(t, section) {
  if (!shared("tour.step")) return [];
  return [
    div()
      .id(`tour-veil-${section}`)
      .absolute()
      .inset_0()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(tourNote)
      // Always there, so it has a state to fade from.
      .child(
        div()
          .id(`tour-tint-${section}`)
          .size_full()
          .bg(t.chrome + VEIL)
          .opacity(tourVeiled(section) ? 1 : 0)
          .transition("opacity", { duration: VEIL_FADE, easing: "ease-out" }),
      ),
  ];
}
