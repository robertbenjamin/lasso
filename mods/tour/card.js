// The tour's faces. The welcome dialog, the step card and the note are one design, `surface`:
//   header   where you are and how to leave
//   title    one line
//   body     what will happen. It hugs its text: no surface has a fixed height.
//   footer   always the last row. Left: what is true now (a status). Right: what you can do.
// A status has one of three marks: a spinner (it runs), a dot (your turn), a check (done).
// A tip, which asks nothing of you, has a small star.
// Motion: a surface fades in, a new status fades in, and a surface grows when it gets a footer.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  GAP,
  PAD,
  SECTION,
  LINE,
  CONTROL,
  RADIUS,
  RADIUS_SM,
  TEXT,
  SMALL,
  TITLE,
  VEIL,
  VEIL_FADE,
} from "./lib/shared.js";
import { SPARK, spark, ghost, star } from "./sparkle.js";

export const CARD_WIDTH = 320;
// About a card's height, until it has been laid out and says its own (main.js).
export const CARD_HEIGHT = 180;
const CLOSE = "mods/tasks-pane/close.svg";
const DIM = "#00000073"; // black at 45%
const GLASS = "f7"; // 97%, as hex alpha
const DOT = 6;
// A surface or a status fades in, a footer grows in.
export const FADE = 160;
const GROW = 220;

function button(t, { id, label, primary = false, enabled = true, onPress }) {
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
      // A press on a control must not start a drag of a floating surface.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .opacity(enabled ? 1 : 0.5)
      .transition("opacity", FADE)
      .when(enabled, (el) =>
        el
          .cursor_pointer()
          .hover((style) => style.opacity(0.88))
          .active((style) => style.opacity(0.7))
          .on_click(onPress),
      )
      .child(label)
  );
}

const heading = (text) => div().text_size(TITLE).font_semibold().child(text);
const prose = (t, text, color = t.foreground) =>
  div().text_size(TEXT).text_color(color).child(text);

// The current step's dot is a short pill. Each card is a new window, so the pill grows on
// this dot as the last one's shrinks: it looks as if it moved a step on.
const PILL = 14;
const dots = (t, count, at, shown) =>
  h_flex()
    .gap(4)
    .items_center()
    .children(
      Array.from({ length: count }, (_unused, index) =>
        div()
          .id(`tour-dot-${index}`)
          .h(DOT)
          .w(index === at ? (shown ? PILL : DOT) : index === at - 1 && !shown ? PILL : DOT)
          .transition("width", { duration: 240, easing: "ease-out" })
          .rounded(DOT / 2)
          .bg(index === at ? t.accent : index < at ? t.muted : t.input),
      ),
    );

// `shown`: the status has just come in, and its check pops.
function mark(t, tone, shown) {
  if (tone === "busy")
    return svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900);
  if (tone === "ok")
    return svg("mods/workspace-chrome/circle-check.svg")
      .id("tour-check")
      .size(shown ? 12 : 4)
      .spring("width", POP)
      .spring("height", POP)
      .text_color(t.done);
  if (tone === "tip") return star(12);
  return div()
    .size(DOT)
    .rounded(DOT / 2)
    .bg(t.accent);
}
const POP = { response: 320, damping: 0.55 };

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

// The close button, also shown inside a status that names it.
const closeMark = () =>
  h_flex()
    .size(20)
    .flex_none()
    .items_center()
    .justify_center()
    .rounded(RADIUS_SM)
    .child(svg(CLOSE).size(12));

// { tone: "busy" | "you" | "ok" | "tip" | "error", text }. `text`: a string, or parts where { chip }
// is a button's name and { close } the close button. `shown` fades a new status in.
const status = (t, { tone, text }, shown) =>
  h_flex()
    .id("tour-status")
    .flex_1()
    .min_w(0)
    .gap(GAP)
    .items_center()
    .text_size(SMALL)
    .text_color(tone === "busy" ? t.dim : tone === "error" ? t.blocked : t.foreground)
    .opacity(shown ? 1 : 0)
    .transition("opacity", FADE)
    .child(
      h_flex()
        .size(16)
        .flex_none()
        .items_center()
        .justify_center()
        .child(mark(t, tone, shown)),
    )
    .child(
      h_flex()
        .flex_1()
        .min_w(0)
        .gap(5)
        .items_center()
        .children(
          [text]
            .flat()
            .map((part) =>
              part.chip
                ? chip(t, part.chip)
                : part.close
                  ? closeMark().bg(t.hover)
                  : div().child(part),
            ),
        ),
    );

// `closing`: × was pressed once and asks again.
const header = (t, { count, at, closing, onClose }, shown) =>
  h_flex()
    .flex_none()
    .gap(GAP)
    .items_center()
    .child(div().text_size(SMALL).text_color(t.dim).child("Tour"))
    .when(count > 0, (el) => el.child(dots(t, count, at, shown)))
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
        .hover((style) => style.bg(t.hover).text_color(t.foreground))
        .tooltip("End the tour and remove the demo")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(onClose)
        .child(closing ? "End the tour?" : svg(CLOSE).size(12)),
    );

// The footer: as tall as a button when it has one, else as a line of text. With neither it
// is gone, and the surface grows when one arrives. `lead`: it has content above, and its
// height carries the gap to that, so the two grow as one.
function footer(t, { now, shown, actions, lead }) {
  const height = actions.length ? CONTROL : now ? LINE : 0,
    gap = lead ? PAD : 0;
  return div()
    .id("tour-footer")
    .flex_none()
    .h(height ? height + gap : 0)
    .transition("height", { duration: GROW, easing: "ease-out" })
    .overflow_hidden()
    .child(
      h_flex()
        .mt(gap)
        .h(height || LINE)
        .gap(GAP)
        .items_center()
        .child(now ? status(t, now, shown) : div().flex_1())
        .children(actions.map((action) => button(t, action))),
    );
}

// Every tour surface. `head`, `title` (text, or an element), `body` (text, or elements), `now`
// (the status) and `actions` (buttons, the primary one last) are each optional. `shown` fades
// it in, `fresh` the status. `fill`: it fills an overlay Herdr sized and framed (the welcome
// dialog).
function surface(
  t,
  { id, head, title, body, now, fresh = true, actions = [], shown = true, fill },
) {
  const framed = (el) =>
    fill
      ? el.size_full().p(SECTION).bg(t.popover)
      : // A touch see-through, in a soft shadow, with a focused pane's border: it stands out.
        el
          .w(CARD_WIDTH)
          .p(PAD)
          .bg(t.popover + GLASS)
          .border_1()
          .border_color(t.accent)
          .rounded(RADIUS)
          .shadow_2xl();
  const lead = Boolean(head) || Boolean(title);
  return framed(v_flex())
    .id(id)
    .text_color(t.foreground)
    .opacity(shown ? 1 : 0)
    .transition("opacity", { duration: FADE, easing: "ease-out" })
    .when(lead, (el) =>
      el.child(
        v_flex()
          .when(Boolean(fill), (content) => content.flex_1())
          .gap(PAD)
          .when(Boolean(head), (content) => content.child(header(t, head, shown)))
          .child(
            v_flex()
              .gap(4)
              .child(typeof title === "string" ? heading(title) : title)
              .children([body].flat().map((part) => (part?.child ? part : prose(t, part)))),
          ),
      ),
    )
    .child(footer(t, { now, shown: fresh, actions, lead }));
}

const numbered = (t, number, text) =>
  h_flex()
    .mt(4)
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
  return surface(t, {
    id: "tour-welcome",
    fill: true,
    // The guide says hello before it starts to point.
    title: h_flex().gap(GAP).items_center().child(heading("Welcome to lasso")).child(spark(t)),
    body: [
      "Run a whole team of Claude Code agents from one window. Give us two minutes and we'll show you around:",
      ...stops.map((title, index) => numbered(t, index + 1, title)),
      prose(
        t,
        "Nothing here is real: it's a demo repo with scripted agents, so it costs no tokens and your repos are safe.",
        t.dim,
      )
        .mt(PAD)
        .text_size(SMALL),
    ],
    now: error
      ? { tone: "error", text: error }
      : busy
        ? { tone: "busy", text: "Setting up the demo" }
        : null,
    actions: [
      // Closing mid-setup would cut the demo repo off half made.
      { id: "tour-later", label: "Not now", enabled: !busy, onPress: onClose },
      {
        id: "tour-start",
        label: "Show me around",
        primary: true,
        enabled: !busy,
        onPress: onStart,
      },
    ],
  })
    .track_focus(handle)
    .on_key_down(onKey);
}

// A step's card. `now`: its status, or null. `action`: its one button, or null.
export const coach = (
  t,
  { step, index, count, now, fresh, action, closing, shown, onClose, onSize },
) =>
  surface(t, {
    id: "tour-coach",
    head: { count, at: index, closing, onClose },
    title: step.title,
    body: step.body,
    now,
    fresh,
    actions: action ? [{ id: "tour-next", primary: true, ...action }] : [],
    shown,
  })
    // places.js needs the card's real height: the sparkle and the note sit against it.
    .on_size_change(onSize);

// A card with only a footer, below the step's card: a word from the tour. `text`: what it
// says. Without one: that the tour is on, with the button that ends it.
export const note = (t, shown, text) =>
  surface(t, {
    id: "tour-note",
    now: {
      tone: "you",
      text: text ?? ["The tour's still running. Close it any time with", { close: true }],
    },
    shown,
  }).on_mouse_down("left", (_e, cx) => cx.stop_propagation());

// A layer over the terminals, which only a window can fade: mods draw their own (lib/tour.js).
// `whole`: over the whole app, as dark as Herdr makes it under a dialog. `shown` fades it.
export const shade = (t, { width, height, whole, shown, onPress }) =>
  div()
    .id("tour-shade")
    .when(whole, (el) => el.size_full().bg(DIM))
    .when(!whole, (el) =>
      el
        .w(width)
        .h(height)
        .bg(t.background + VEIL),
    )
    .opacity(shown ? 1 : 0)
    .transition("opacity", { duration: VEIL_FADE, easing: "ease-out" })
    // A press must not drag the window away.
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click(onPress);

// The floating sparkles, in a see-through window just big enough for them. Each springs from
// where it was to its place in `stars`, px inside that window, a little later than the one
// before: they peel off one by one. `shown` fades them, `resting` lets them bloom.
// Sideways it arrives first and settles without a bounce, up and down it lags and dips a
// little: the path curves. A star that `travels` trails a short tail: smaller stars on slower
// springs, gone (`out` fades them) before it lands.
const TAIL = [
  { size: 13, opacity: 0.28, slower: 1.25 },
  { size: 9, opacity: 0.14, slower: 1.5 },
];
export const flight = (t, { width, height, stars, shown, resting, out }) =>
  div()
    .id("tour-flight")
    .w(width)
    .h(height)
    // A press must not drag the window away.
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .children(
      stars.flatMap(({ x, y, travels }, index) => {
        const at = (id, slower = 1, bounce = true) =>
          div()
            .id(id)
            .absolute()
            .left(x)
            .top(y)
            .size(SPARK)
            .spring("left", {
              response: (420 + index * 70) * slower,
              damping: bounce ? 0.86 : 1,
            })
            .spring("top", {
              response: (560 + index * 70) * slower,
              damping: bounce ? 0.78 : 1,
            });
        // One ghost each when several fly, so a split stays light.
        const tail = travels ? TAIL.slice(0, stars.length > 1 ? 1 : 2) : [];
        return [
          ...tail.map(({ size, opacity, slower }, link) =>
            at(`tour-tail-${index}-${link}`, slower, false).child(
              div()
                .id(`tour-ghost-${index}-${link}`)
                .opacity(out ? 0 : opacity)
                .transition("opacity", { duration: 200, delay: 280, easing: "ease-in" })
                .child(ghost(size)),
            ),
          ),
          at(`tour-star-${index}`).child(
            div()
              .id(`tour-glow-${index}`)
              .opacity(shown ? 1 : 0)
              .transition("opacity", { duration: FADE, delay: index * 60 })
              .child(spark(t, { resting, seed: index })),
          ),
        ];
      }),
    );
