import { div } from "gpui-kit";
import { shared, setShared } from "herdr";

// The tour's demo repo (mods/tour). An agent in one of its worktrees is a scripted one, and
// the Context panel shows it sample data.
export const TOUR_REPO = "lasso-demo";

// While a tour runs, every section of lasso adds `.children(tourVeil(t, "its-name"))` to its
// root. That puts a layer over it that takes the clicks, so a click outside the tour cannot
// leave it in a state the tour does not expect: the tour's card says so instead (tourNudge).
// mods/tour names in shared "tour.focus" the sections a step is about. The others also fade
// under the layer, which breathes. Mods cannot blur, and only mods can draw this: mods/tour
// lays a window over the terminals.
export const VEIL = "d9"; // 85%, as hex alpha
export const breathes = (el) => el.loop("opacity", { from: 0.82, to: 1, period: 3200 });

export function tourVeiled(section) {
  const focus = shared("tour.step") ? shared("tour.focus") : null;
  return Boolean(focus?.length) && !focus.includes(section);
}

// The card opens again on top and says that the tour is on.
export const tourNudge = () => setShared("tour.top", (shared("tour.top") ?? 0) + 1);

export function tourVeil(t, section) {
  if (!shared("tour.step")) return [];
  return [
    div()
      .id(`tour-veil-${section}`)
      .absolute()
      .inset_0()
      .when(tourVeiled(section), (el) => breathes(el.bg(t.chrome + VEIL)))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(tourNudge),
  ];
}
