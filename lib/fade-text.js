import { div, PathBuilder, Background } from "gpui-kit";
import { h_flex } from "gpui-base";

// The end of the text fades when it doesn't fit. The fade is painted, so `bg` must be the
// color the row really shows.
const RECT = () =>
  PathBuilder.fill()
    .move_to("0%", "0%")
    .line_to("100%", "0%")
    .line_to("100%", "100%")
    .line_to("0%", "100%")
    .close()
    .build();
export function fadeText(text, bg, key, view, min) {
  const fit = (view.fit ??= new Map());
  const tooLong = (widths) => (widths?.text ?? 0) > (widths?.box ?? Infinity) + 0.5;
  const measure = (part) => (size, cx) => {
    const widths = fit.get(key) ?? {};
    const was = tooLong(widths);
    widths[part] = size.width;
    fit.set(key, widths);
    if (tooLong(widths) !== was) cx.notify();
  };
  const box = h_flex()
    .id(`fade-${key}`)
    .relative()
    .overflow_hidden()
    .whitespace_nowrap()
    .on_size_change(measure("box"));
  return (min == null ? box.flex_1().min_w(0) : box.flex_initial().min_w(min))
    .child(div().id(`fade-text-${key}`).flex_none().on_size_change(measure("text")).child(text))
    .when(tooLong(fit.get(key)), (el) =>
      el.child(
        div()
          .absolute()
          .top(0)
          .right(0)
          .h_full()
          .w(22)
          .child(
            globalThis.window
              .paint_path(RECT(), Background.linear_gradient(90, bg + "00", bg))
              .absolute()
              .top(0)
              .left(0)
              .size_full(),
          ),
      ),
    );
}
