// The tour's faces: the welcome dialog, the coach card (a window over the work) and the
// floating sparkle.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  GAP,
  PAD,
  SECTION,
  CONTROL,
  RADIUS,
  RADIUS_SM,
  TEXT,
  SMALL,
  TITLE,
  VEIL,
  breathes,
} from "./lib/shared.js";
import { SPARK, spark } from "./sparkle.js";

export const CARD_WIDTH = 320;
// Header, title and text, and the button: the card without a line.
export const CARD_HEIGHT = 208;
const BODY = 112;
// What a line adds to the height, and how long the card takes to grow.
const LINE_ROW = 32;
const GROW = 220;
export const NOTE_HEIGHT = 36;
const CLOSE = "mods/tasks-pane/close.svg";
const DIM = "#00000073"; // black at 45%
const GLASS = "f7"; // 97%, as hex alpha
export const FADE = 280;
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
const prose = (t, text, color = t.muted) => div().text_size(TEXT).text_color(color).child(text);

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
          prose(
            t,
            "Run a whole team of Claude Code agents from one window. Give us two minutes and we'll show you around:",
          ),
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
            "Nothing here is real: it's a demo repo with scripted agents, so it costs no tokens and your repos are safe.",
        ),
    )
    .child(
      h_flex()
        .flex_none()
        .gap(GAP)
        .justify_end()
        // Closing mid-setup would cut the demo repo off half made.
        .child(button(t, "tour-later", "Not now", { enabled: !busy }, onClose))
        .child(
          button(
            t,
            "tour-start",
            busy ? "Setting up…" : "Show me around",
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

// A word shown as the button it names.
const chip = (t, label) =>
  h_flex()
    .h(18)
    .px(6)
    .flex_none()
    .items_center()
    .rounded(RADIUS_SM)
    .bg(t.solid)
    .text_color(t.solid_foreground)
    .text_size(11)
    .font_medium()
    .child(label);

// `text`: a string, or parts where { chip } is a button's name.
const progressLine = (t, { tone, text }) =>
  h_flex()
    .gap(GAP)
    .items_center()
    .text_size(SMALL)
    .text_color(tone === "busy" ? t.dim : t.foreground)
    .child(h_flex().w(16).flex_none().justify_center().child(mark(t, tone)))
    .child(
      h_flex()
        .flex_1()
        .min_w(0)
        .gap(5)
        .items_center()
        .children(
          [text].flat().map((part) => (part.chip ? chip(t, part.chip) : div().child(part))),
        ),
    );

// The card draws its own frame, with the accent border of a focused pane: it has to stand out,
// also under the dimming of a dialog. A press that no control stops drags the window.
// The card's frame: the accent border of a focused pane, so it stands out.
const framed = (t, el) =>
  // A touch see-through, in a wide soft shadow that darkens the app around it. Herdr cannot
  // blur what is behind a mod.
  el
    .bg(t.popover + GLASS)
    .border_1()
    .border_color(t.accent)
    .rounded(RADIUS)
    .shadow_2xl();

// A small note below the card, in the card's design: you clicked outside the tour, and this
// says why nothing happened. `shown` fades it in and out.
// `text`: what it says. Without one, it says that the tour is on and shows the close button.
export const note = (t, shown, text) =>
  framed(t, h_flex())
    .id("tour-note")
    .w(CARD_WIDTH)
    .h(NOTE_HEIGHT)
    .px(PAD)
    .gap(GAP)
    .items_center()
    .text_size(SMALL)
    .text_color(t.foreground)
    .opacity(shown ? 1 : 0)
    .transition("opacity", FADE)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .child(h_flex().w(16).flex_none().justify_center().child(mark(t, "you")))
    .child(text ?? "The tour's still running. Close it any time with")
    // The card's own close button, so you know which one.
    .when(!text, (el) =>
      el.child(
        h_flex()
          .size(20)
          .flex_none()
          .items_center()
          .justify_center()
          .rounded(RADIUS_SM)
          .bg(t.hover)
          .child(svg(CLOSE).size(12)),
      ),
    );

// A layer over the terminals, which only a window can fade: mods draw their own (lib/tour.js).
// `whole`: over the whole app, as dark as Herdr makes it under a dialog.
export const shade = (t, { width, height, whole, onPress }) =>
  breathes(
    div()
      .id("tour-shade")
      .when(whole, (el) => el.size_full().bg(DIM))
      .when(!whole, (el) =>
        el
          .w(width)
          .h(height)
          .bg(t.background + VEIL),
      )
      // A press must not drag the window away.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(onPress),
  );

// The card's height: its fixed part, plus the line and the button when it has them.
export const cardHeight = (line, action) =>
  CARD_HEIGHT + (line ? LINE_ROW : 0) - (action ? 0 : CONTROL + PAD);

// The card grows when it has something new to say and shrinks back, never all at once.
// `line`: what just happened or what to do now, or null. `action`: its button, or null.
// `closing`: × was pressed once and asks again. `shown` fades the card in.
export function coach(t, { step, index, count, line, action, closing, shown, onClose }) {
  return framed(t, v_flex())
    .id("tour-coach")
    .opacity(shown ? 1 : 0)
    .transition("opacity", 160)
    .w(CARD_WIDTH)
    .h(cardHeight(line, action))
    .transition("height", GROW)
    .overflow_hidden()
    .p(PAD)
    .gap(PAD)
    .text_color(t.foreground)
    .child(
      h_flex()
        .flex_none()
        .gap(GAP)
        .items_center()
        .child(div().text_size(SMALL).text_color(t.dim).child("Tour"))
        .child(dots(t, count, index))
        .child(div().flex_1())
        .child(
          h_flex()
            .id("tour-close")
            .h(20)
            .min_w(20)
            .px(closing ? GAP : 0)
            .flex_none()
            .items_center()
            .justify_center()
            .rounded(RADIUS_SM)
            .text_size(SMALL)
            .text_color(closing ? t.foreground : t.dim)
            .when(closing, (el) => el.bg(t.hover))
            .cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .tooltip("End the tour and remove the demo")
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click(onClose)
            .child(closing ? "End the tour?" : svg(CLOSE).size(12)),
        ),
    )
    .child(
      v_flex()
        .h(BODY)
        .flex_none()
        .gap(4)
        .child(heading(step.title))
        .child(prose(t, step.body, t.foreground)),
    )
    .child(
      div()
        .id("tour-line")
        .flex_none()
        .h(line ? LINE_ROW - PAD : 0)
        .opacity(line ? 1 : 0)
        .transition("opacity", { duration: GROW, delay: line ? GROW / 2 : 0 })
        .when(Boolean(line), (el) => el.child(progressLine(t, line))),
    )
    .when(Boolean(action), (el) =>
      el.child(
        h_flex()
          .flex_none()
          .h(CONTROL)
          .justify_end()
          .child(
            button(
              t,
              "tour-next",
              action.label,
              { primary: true, enabled: action.enabled },
              action.onPress,
            ),
          ),
      ),
    );
}

// The floating sparkle, in a see-through window just big enough for its flight. It springs
// from where it was to `to`, px inside that window. `shown` fades it in.
const SPRING = { response: 480, damping: 0.8 };
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
