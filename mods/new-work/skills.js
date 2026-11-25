// The skill picker: while the Task field's last word is "/name", the matching skills
// (bin/lasso-skills) float under it as a menu. ↑ ↓ move, ↵ or ⇥ pick, Esc closes, a click picks.
import { div } from "gpui-kit";
import { v_flex, h_flex, Popup } from "gpui-base";
import { exec } from "herdr";
import {
  bin,
  GAP,
  ROW,
  SECTION,
  RADIUS,
  RADIUS_SM,
  TEXT,
  SMALL,
  NEW_WORK_SIZE,
} from "./lib/shared.js";

const LIMIT = 4;
const NAME = /(?:^|\s)\/([\w:-]*)$/;
const CONTEXT = "NwSkills";
const ACTIONS = {
  up: "nw_skill_up",
  down: "nw_skill_down",
  pick: "nw_skill_pick",
  close: "nw_skill_close",
};

// "name<TAB>about" lines, as bin/lasso-skills prints them.
export const parseSkills = (out) =>
  out
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));

export function skillMatches(text, skills) {
  const typed = text.match(NAME)?.[1];
  return typed === undefined ? [] : skills.filter(([name]) => name.includes(typed)).slice(0, LIMIT);
}

export const withSkill = (text, name) => text.replace(/\/[\w:-]*$/, `/${name} `);

export class SkillPicker {
  constructor(box, cx) {
    this.box = box;
    this.skills = [];
    this.at = 0;
    this.closed = null; // the text Esc closed the menu on; it opens again once that changes
    // The text box binds these keys itself, in its "Input" context. A binding inside our
    // context, installed later, comes first, and only while the menu is open.
    cx.bind_keys(
      [
        ["up", ACTIONS.up],
        ["down", ACTIONS.down],
        ["enter", ACTIONS.pick],
        ["tab", ACTIONS.pick],
        ["escape", ACTIONS.close],
      ].map(([keystroke, action]) => ({ keystroke, action, context: `${CONTEXT} > Input` })),
    );
    cx.spawn(async (cx) => {
      this.skills = parseSkills((await exec(bin("lasso-skills"), [])).stdout ?? "");
      cx.notify();
    });
  }

  // Call on every edit: the menu starts again at the top.
  changed() {
    this.at = 0;
    this.closed = null;
  }

  matches(text) {
    return text === this.closed ? [] : skillMatches(text, this.skills);
  }

  // Fills the skill in and returns the new text.
  pick(name) {
    const text = withSkill(this.box.value(), name);
    this.box.set_value(text);
    this.box.set_selected_range({ start: text.length, end: text.length });
    this.box.focus();
    return text;
  }

  // The Task field with the menu under it. `onPick(text, cx)` gets the text after a pick.
  field(trigger, text, t, onPick) {
    const matches = this.matches(text);
    const choose = (name, cx) => onPick(this.pick(name), cx);
    const step = (by) => (_e, cx) => {
      this.at = (this.at + by + matches.length) % matches.length;
      cx.notify();
    };
    const row = ([name, about], i) =>
      h_flex()
        .id(`nw-skill-${name}`)
        .h(ROW)
        .px(GAP)
        .gap(GAP)
        .items_center()
        .rounded(RADIUS_SM)
        .cursor_pointer()
        .when(i === this.at, (el) => el.bg(t.selected))
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => choose(name, cx))
        .child(div().flex_none().text_size(TEXT).text_color(t.foreground).child(`/${name}`))
        .child(div().flex_1().min_w(0).truncate().text_size(SMALL).text_color(t.dim).child(about));
    const popup = Popup.new("nw-skills", trigger)
      .anchor("top_left")
      .flex_1()
      .min_h(0)
      .when(matches.length > 0, (el) =>
        el.content(
          v_flex()
            .w(NEW_WORK_SIZE.width - 2 * SECTION)
            .mt(4)
            .p(4)
            .rounded(RADIUS)
            .border_1()
            .border_color(t.border)
            .bg(t.popover)
            .shadow_md()
            .children(matches.map(row)),
        ),
      );
    // key_context and on_action are wired on v_flex, not on Popup.
    return v_flex()
      .flex_1()
      .min_h(0)
      .when(matches.length > 0, (el) =>
        el
          .key_context(CONTEXT)
          .on_action(ACTIONS.up, step(-1))
          .on_action(ACTIONS.down, step(1))
          .on_action(ACTIONS.pick, (_e, cx) => choose(matches[this.at][0], cx))
          .on_action(ACTIONS.close, (_e, cx) => {
            this.closed = text;
            cx.notify();
          }),
      )
      .child(popup);
  }
}
