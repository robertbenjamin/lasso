// The tour's faces: the welcome dialog, the coach card (a window over the work) and the
// floating sparkle.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  GAP,
  PAD,
  SECTION,
  CONTROL,
  RADIUS_SM,
  TEXT,
  SMALL,
  TITLE,
  SPARK,
  spark,
} from "./lib/shared.js";

export const CARD_WIDTH = 320;
// Fixed, so places.js knows where the card's button is.
export const CARD_HEIGHT = 216;
const DOT = 6;

function button(t, id, label, { primary = false, enabled = true }, action) {
  return (
    h_flex()
      .id(id)
      .h(CONTROL)
      .px(PAD)
      .flex_none()
      .items_center()
      .rounded(RADIUS_SM)
      .border_1()
      .border_color(primary ? t.solid : t.input)
      .bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground)
      .text_size(TEXT)
      .font_medium()
      // A press on a control must not start a drag of the floating card.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .when(!enabled, (el) => el.opacity(0.5))
      .when(enabled, (el) =>
        el
          .cursor_pointer()
          .hover((s) => s.opacity(0.88))
          .on_click(action),
      )
      .child(label)
  );
}

const heading = (text) => div().text_size(TITLE).font_semibold().child(text);
const prose = (t, text) => div().text_size(TEXT).text_color(t.muted).child(text);

const numbered = (t, number, text) =>
  h_flex()
    .gap(GAP)
    .items_center()
    .child(
      h_flex()
        .size(20)
        .flex_none()
        .items_center()
        .justify_center()
        .rounded(10)
        .bg(t.raised)
        .text_size(SMALL)
        .text_color(t.muted)
        .child(String(number)),
    )
    .child(div().text_size(TEXT).child(text));

// `stops`: the titles of the steps the tour walks through.
export function welcome(t, { stops, busy, error, handle, onKey, onStart, onClose }) {
  return v_flex()
    .id("tour-welcome")
    .track_focus(handle)
    .on_key_down(onKey)
    .size_full()
    .p(SECTION)
    .gap(SECTION)
    .bg(t.popover)
    .text_color(t.foreground)
    .child(
      v_flex()
        .gap(GAP)
        .child(heading("Welcome to lasso"))
        .child(
          prose(t, "Run a team of Claude Code agents from one window. See how in 90 seconds:"),
        ),
    )
    .child(
      v_flex()
        .gap(GAP)
        .children(stops.map((title, index) => numbered(t, index + 1, title))),
    )
    .child(
      div()
        .flex_1()
        .text_size(SMALL)
        .text_color(error ? t.blocked : t.dim)
        .child(
          error ??
            "The tour runs in a demo repo with scripted agents. It uses no tokens and leaves your repos alone.",
        ),
    )
    .child(
      h_flex()
        .flex_none()
        .gap(GAP)
        .justify_end()
        .child(button(t, "tour-later", "Not now", {}, onClose))
        .child(
          button(
            t,
            "tour-start",
            busy ? "Setting up…" : "Start the tour",
            { primary: true, enabled: !busy },
            onStart,
          ),
        ),
    );
}

const dots = (t, count, index) =>
  h_flex()
    .gap(4)
    .items_center()
    .children(
      Array.from({ length: count }, (_, i) =>
        div()
          .size(DOT)
          .rounded(DOT / 2)
          .bg(i === index ? t.accent : i < index ? t.muted : t.input),
      ),
    );

function mark(t, tone) {
  if (tone === "busy")
    return svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900);
  if (tone === "ok")
    return svg("mods/workspace-chrome/circle-check.svg").size(12).text_color(t.done);
  return div()
    .size(DOT)
    .rounded(DOT / 2)
    .bg(t.accent);
}

const progressLine = (t, { tone, text }) =>
  h_flex()
    .gap(GAP)
    .items_center()
    .text_size(SMALL)
    .text_color(tone === "busy" ? t.dim : t.foreground)
    .child(h_flex().w(16).flex_none().justify_center().child(mark(t, tone)))
    .child(div().flex_1().min_w(0).child(text));

// Herdr draws the frame around a window: this is only the content. A press that no control
// stops drags the window.
export function coach(t, { step, index, count, progress, last, onNext, onClose }) {
  const ready = !progress || progress.tone === "ok";
  return v_flex()
    .id("tour-coach")
    .w(CARD_WIDTH)
    .h(CARD_HEIGHT)
    .p(PAD)
    .gap(PAD)
    .text_color(t.foreground)
    .child(
      h_flex()
        .gap(GAP)
        .items_center()
        .child(div().text_size(SMALL).text_color(t.dim).child("Tour"))
        .child(dots(t, count, index))
        .child(div().flex_1())
        .child(
          h_flex()
            .id("tour-close")
            .size(20)
            .flex_none()
            .items_center()
            .justify_center()
            .rounded(RADIUS_SM)
            .text_color(t.dim)
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .tooltip("End the tour and remove the demo")
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click(onClose)
            .child(svg("mods/tasks-pane/close.svg").size(12)),
        ),
    )
    .child(v_flex().flex_1().gap(4).child(heading(step.title)).child(prose(t, step.body)))
    .child(
      h_flex()
        .gap(GAP)
        .items_center()
        .min_h(CONTROL)
        .child(progress ? progressLine(t, progress).flex_1().min_w(0) : div().flex_1())
        .when(!step.auto, (el) =>
          el.child(
            button(
              t,
              "tour-next",
              last ? "Finish" : "Next",
              { primary: true, enabled: ready },
              onNext,
            ),
          ),
        ),
    );
}

// The floating sparkle, in a see-through window just big enough for its flight. It springs
// from where it was to `to`, px inside that window. `shown` fades it in and out.
const SPRING = { response: 480, damping: 0.8 };
const FADE = 280;
export const flight = (t, { width, height, to, shown }) =>
  div()
    .id("tour-flight")
    .w(width)
    .h(height)
    // A press must not drag the window away.
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .child(
      div()
        .id("tour-star")
        .absolute()
        .left(to.x)
        .top(to.y)
        .size(SPARK)
        .spring("left", SPRING)
        .spring("top", SPRING)
        .child(
          div()
            .id("tour-glow")
            .opacity(shown ? 1 : 0)
            .transition("opacity", FADE)
            .child(spark(t)),
        ),
    );
