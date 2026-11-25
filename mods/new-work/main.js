// The dialog only queues a job; the sidebar (mods/tasks-spaces) runs bin/herdr-open-work.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, Popup } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared, exec } from "herdr";
import {
  conf,
  loadConf,
  GAP,
  PAD,
  SECTION,
  CONTROL,
  RADIUS,
  RADIUS_SM,
  ROW,
  TEXT,
  SMALL,
  TITLE,
  tourNote,
  bin,
  NEW_WORK_SIZE,
} from "./lib/shared.js";
import { MODELS, detectModel, withoutModel } from "./models.js";
import { keys } from "./typing.js";
import { held, openLit, behind, reopen } from "./tour.js";

// The work folder's name means "home" too.
const PROMPTS = {
  implement: "Implement {input}. Then open a draft PR.",
  review: "Review the PR {input}. Do not change code. Report the problems you find.",
};
// A slash command goes through as typed, so Claude runs the skill (the ticket still picks repo and branch).
const fill = (kind, text) =>
  text.startsWith("/") ? text : { ...PROMPTS, ...conf().prompts }[kind].replaceAll("{input}", text);
const workName = () => conf().workRoot?.replace(/\/+$/, "").split("/").pop() ?? null;
// A repo given as a folder path shows as its folder's name.
const repoName = (repo) => repo.replace(/\/+$/, "").split("/").pop();

const PR = /https:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/;
const LINEAR = /linear\.app\/[\w-]+\/issue\/([A-Za-z]+-\d+)/;
// Capitals only, unlike shared.js's TICKET: in pasted prose, "covid-19" is no ticket.
const TICKET = /\b([A-Z]{2,6}-\d+)\b/;

export function plan(text, chosen) {
  const pr = text.match(PR);
  if (pr)
    return { what: `Review PR #${pr[2]}`, repo: pr[1], pr: pr[2], task: fill("review", text) };
  const id = (text.match(LINEAR)?.[1] ?? text.match(TICKET)?.[1])?.toUpperCase();
  // Your own words next to the links: then Claude picks the repo, not the ticket's label.
  const extra = /[A-Za-z]{2,}/.test(text.replace(/https?:\/\/\S+/g, " ").replace(TICKET, " "));
  if (id && chosen === "auto")
    return {
      what: `Make PR ${id}`,
      how: extra ? "Claude picks the repo" : "Repo from the ticket",
      repo: "auto",
      branch: id,
      linear: id,
      extra,
      task: fill("implement", text),
    };
  if (id) return { what: `Make PR ${id}`, repo: chosen, branch: id, task: fill("implement", text) };
  if (chosen === "auto")
    return {
      what: "Explore",
      how: "Claude picks the repo",
      repo: "auto",
      task: text,
    };
  return { what: "Explore", repo: chosen, task: text };
}

export default class NewWork extends View {
  init(_props, cx) {
    // A dialog dims all under it, the tour's card too. A draft that asks for `lit` (the tour,
    // which dims the app itself and takes the clicks beside this) gets the same view as a
    // window, which does not dim.
    this.moved = Boolean(shared("newwork.draft")?.lit) && !props()?.lit;
    // ⌘⇧N again: the tour holds its lit window open, and its card says so. Only the tour
    // drafts with `lit`, so a lit draft means a tour runs.
    if (this.moved && shared("newwork.open")) {
      tourNote();
      return closeOverlay(props().overlay);
    }
    // The tour reads this: its sparkle moves to the Start button, its card comes to the top.
    setShared("newwork.open", true);
    if (this.moved) {
      openLit();
      return closeOverlay(props().overlay);
    }
    if (props()?.lit)
      cx.timer.after(30, (cx) => {
        this.shown = true;
        cx.notify();
      });
    this.text = "";
    this.repo = "auto";
    this.pickedModel = null;
    this.claudeModel = "opus";
    this.busy = false;
    this.box = TextareaState.new({
      placeholder: "Describe the work, or paste a Linear, GitHub PR or Slack link",
    });
    this.box.on("change", (_e, cx) => {
      this.text = this.box.value?.() ?? this.box.content?.().text ?? "";
      cx.notify();
    });
    this.box.on?.("submit", () => this.go());
    this.repoInput = InputState.new({ placeholder: "Detect automatically" });
    this.repoInput.on("change", (_e, cx) => {
      this.repo = this.repoInput.value().trim() || "auto";
      cx.notify();
    });
    this.repoInput.on("submit", () => this.go());
    // newwork.draft { text, repo, agent?, script?, lit? }: another mod (the tour) fills the dialog
    // in. `agent` runs in Claude's place while the repo stays the draft's. `script` types
    // itself after `text` (typing.js).
    this.draft = shared("newwork.draft") ?? null;
    // This window opened again on top (render): it carries on where the last one was.
    const resume = shared("newwork.resume");
    if (resume) setShared("newwork.resume", null);
    if (this.draft) {
      this.repo = resume?.repo ?? this.draft.repo;
      this.repoInput.set_value(this.repo);
      this.text = resume?.text ?? this.draft.text ?? "";
      this.box.set_value(this.text);
      this.pickedModel = resume?.picked ?? null;
      this.play(cx, resume?.keys ?? keys(this.draft.script ?? [], this.text));
    }
    this.focus = "box";
    for (const [name, s] of [
      ["box", this.box],
      ["repo", this.repoInput],
    ]) {
      s.on?.("focus", (_e, cx) => {
        this.focus = name;
        cx.notify();
      });
      s.on?.("blur", (_e, cx) => {
        if (this.focus === name) this.focus = null;
        cx.notify();
      });
    }
    this.handle = cx.focus_handle();
    this.skills = [];
    cx.spawn(async (cx) => {
      await loadConf();
      cx.notify();
    });
    cx.spawn(async (cx) => {
      const out = (await exec(bin("lasso-skills"), [])).stdout ?? "";
      this.skills = out
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("\t"));
      cx.notify();
    });
    this.box.focus();
    cx.timer.after(300, () => this.box.focus());
  }

  // Presses the keys one by one at the cursor, as typing does, so the cursor follows. It
  // stops for good when the field holds something else: you typed.
  play(cx, [key, ...rest], expected = this.text) {
    this.pending = key ? [key, ...rest] : [];
    if (!key) return;
    cx.timer.after(key.after, (cx) => {
      if (this.box.value() !== expected) return;
      const end = expected.length;
      this.box.set_selected_range({ start: key.paste ? 0 : key.erase ? end - 1 : end, end });
      this.box.replace(key.paste ?? key.insert ?? "");
      // The tour shows this beside its card.
      if (key.say) setShared("newwork.say", key.say);
      this.text = this.box.value();
      cx.notify();
      this.play(cx, rest, key.text);
    });
  }

  // Esc, Cancel and a click beside it. A running tour holds its lit window open and says so:
  // the way out is the × on the tour's card.
  leave() {
    if (props()?.lit && held()) return tourNote();
    this.close();
  }

  // Herdr calls this too, once, however the dialog goes.
  close() {
    // Not the dialog that became a window, nor a lit window that opened again on top.
    if (!this.moved && !behind(props())) setShared("newwork.open", null);
    setShared("newwork.say", null);
    closeOverlay(props()?.overlay);
  }

  // A click beats the text, the text beats the default (the repo's repoModel, else Opus).
  model(repo) {
    if (this.pickedModel) return { model: this.pickedModel, chosen: true };
    const found = detectModel(this.text);
    if (found) return { model: found.model, found, chosen: true };
    return { model: conf().repoModel?.[repo] ?? this.claudeModel, chosen: false };
  }

  go() {
    if (this.busy) return;
    const { model, found, chosen } = this.model(this.repo);
    const text = withoutModel(this.text, found).trim();
    if (!text) return;
    const planned = plan(text, this.repo);
    const args = [
      "--repo",
      planned.repo,
      ...(planned.branch ? ["--branch", planned.branch] : []),
      ...(planned.pr ? ["--pr", planned.pr] : []),
      ...(planned.linear ? ["--linear", planned.linear] : []),
      ...(planned.extra ? ["--extra"] : []),
      ...(chosen ? ["--model", model] : []),
      ...(this.draft?.agent && this.repo === this.draft.repo ? ["--agent", this.draft.agent] : []),
      "--",
      planned.task,
    ];
    this.busy = true;
    const label =
      planned.branch ??
      (planned.pr
        ? `PR #${planned.pr}`
        : (text
            .replace(/https?:\/\/\S+/g, " ")
            .match(/\S+/g)
            ?.slice(0, 4)
            .join(" ") ?? "New work"));
    const job = {
      id: `nw${Date.now()}`,
      label,
      repo: repoName(planned.repo),
      args,
      at: Date.now(),
    };
    setShared("newwork.jobs", [...(shared("newwork.jobs") ?? []), job]);
    if (this.draft) setShared("newwork.draft", null);
    this.close();
  }

  key(e, cx) {
    if (e.key === "escape") {
      cx.stop_propagation();
      return this.leave();
    }
    if (e.key === "enter" && e.modifiers?.platform) {
      cx.stop_propagation();
      this.go();
    }
  }

  render() {
    if (this.moved) return div();
    if (props()?.lit && !shared("newwork.open")) return closeOverlay(props().overlay) ?? div();
    // A press on the tour's dimmer brought that to the front: open again on top of it, with
    // what is typed and what is still to type.
    if (behind(props())) {
      reopen(this);
      return closeOverlay(props().overlay) ?? div();
    }
    // Another mod presses Start by setting this (the tour's Next key). Not a mod command:
    // those do not reach this window.
    if (shared("newwork.start")) {
      setShared("newwork.start", null);
      return this.go() ?? div();
    }
    const t = theme();
    // While the last word is "/name", the skills that match float under the Task field, as a menu.
    const typed = this.text.match(/(?:^|\s)\/([\w:-]*)$/)?.[1];
    const matches =
      typed === undefined ? [] : this.skills.filter(([n]) => n.includes(typed)).slice(0, 4);
    const skill = ([name, about]) =>
      h_flex()
        .id(`nw-skill-${name}`)
        .h(ROW)
        .px(GAP)
        .gap(GAP)
        .items_center()
        .rounded(RADIUS_SM)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          this.text = this.text.replace(/\/[\w:-]*$/, `/${name} `);
          this.box.set_value(this.text);
          this.box.focus();
          cx.notify();
        })
        .child(div().flex_none().text_size(TEXT).text_color(t.foreground).child(`/${name}`))
        .child(div().flex_1().min_w(0).truncate().text_size(SMALL).text_color(t.dim).child(about));
    const text = this.text.trim();
    const planned = text ? plan(text, this.repo) : null;
    const chosen = this.model(planned?.repo ?? this.repo);
    const named = MODELS.find((m) => m.id === chosen.model);
    const icon = !planned
      ? "layers"
      : planned.pr
        ? "git-compare"
        : planned.linear || planned.branch
          ? "circle-check"
          : "search";
    const where = !planned
      ? ""
      : planned.repo === "auto"
        ? planned.how + (planned.branch ? ` · branch ${planned.branch}` : "")
        : planned.repo === "home" || planned.repo === workName()
          ? "Your work folder"
          : `${repoName(planned.repo)} · ${planned.branch ? `branch ${planned.branch}` : planned.pr ? "the PR's branch" : "new branch"}`;
    const modelNote = chosen.found
      ? `${named.name} from “${this.text.slice(chosen.found.start, chosen.found.end)}”`
      : "";
    // A key as a chip: an icon (svg) or a word, so ⌘ and ↵ don't fall back to odd font glyphs.
    const key = (k) =>
      h_flex()
        .h(20)
        .min_w(20)
        .px(k.endsWith(".svg") ? 0 : 6)
        .justify_center()
        .items_center()
        .rounded(RADIUS_SM)
        .border_1()
        .border_color(t.border)
        .text_size(SMALL)
        .text_color(t.muted)
        .child(k.endsWith(".svg") ? svg(`mods/new-work/${k}`).size(SMALL).text_color(t.muted) : k);
    const segment = ({ id, name, version }) => {
      const on = chosen.model === id;
      return h_flex()
        .id(`nw-model-${id}`)
        .h_full()
        .justify_center()
        .items_center()
        .rounded(RADIUS_SM)
        .border_1()
        .px(8)
        .border_color(on ? t.border : t.background)
        .bg(on ? t.raised : t.background)
        .text_size(TEXT)
        .text_color(on ? t.foreground : t.dim)
        .when(!on, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .on_click((_e, cx) => {
          this.pickedModel = id;
          cx.notify();
        })
        .gap(4)
        .child(name)
        .child(
          div()
            .text_size(SMALL)
            .text_color(on ? t.muted : t.dim)
            .opacity(on ? 1 : 0.7)
            .child(version),
        );
    };
    const keys = (...ks) => h_flex().gap(4).items_center().children(ks.map(key));
    const group = (name, ...children) =>
      v_flex()
        .gap(GAP)
        // The cap sits 1.5 below its line box: pulled up so every section starts SECTION below the last one's ink.
        .child(
          div().mt(-1.5).text_size(SMALL).line_height(`${SMALL}px`).text_color(t.dim).child(name),
        )
        .children(children);
    const field = (el, on) =>
      el
        .px(PAD)
        .rounded(RADIUS)
        .border_1()
        .border_color(on ? t.accent : t.input)
        .bg(t.background)
        .text_size(TEXT)
        .text_color(t.foreground);
    const button = (id, s, primary, action) =>
      h_flex()
        .id(id)
        .h(CONTROL)
        .px(PAD)
        .items_center()
        .rounded(RADIUS_SM)
        .border_1()
        .border_color(primary ? t.solid : t.input)
        .bg(primary ? t.solid : t.raised)
        .text_color(primary ? t.solid_foreground : t.foreground)
        .text_size(TEXT)
        .font_medium()
        .when(primary && (this.busy || !text), (el) => el.opacity(0.5))
        .when(!primary || (!this.busy && Boolean(text)), (el) =>
          el
            .cursor_pointer()
            .hover((s) => s.opacity(0.88))
            .on_click(action),
        )
        .child(s);
    const hint = (k, v) =>
      h_flex()
        .gap(4)
        .items_center()
        .child(div().text_color(t.muted).child(k))
        .child(div().text_color(t.dim).child(v));
    return (
      v_flex()
        .id("new-work")
        .track_focus(this.handle)
        .on_key_down((e, cx) => this.key(e, cx))
        // As a window it stays put: a press would drag it.
        .when(Boolean(props()?.lit), (el) =>
          el
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            // A dialog comes with Herdr's own entrance. As a window it fades in.
            .opacity(this.shown ? 1 : 0)
            .transition("opacity", 160),
        )
        .size_full()
        .min_h(0)
        .p(SECTION)
        .gap(SECTION)
        .bg(t.popover)
        .text_color(t.foreground)
        .child(
          h_flex()
            .h(20)
            .flex_none()
            .items_center()
            .child(div().flex_1().text_size(TITLE).font_semibold().child("New work"))
            .child(key("Esc")),
        )
        .child(
          group(
            "Task",
            Popup.new(
              "nw-skills",
              field(Textarea.new(this.box).size_full().min_h(72).py(GAP), this.focus === "box"),
            )
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
                    .children(matches.map(skill)),
                ),
              ),
          )
            .flex_1()
            .min_h(0),
        )
        .child(
          group(
            "Repo",
            field(Input.new(this.repoInput).h(CONTROL).items_center(), this.focus === "repo"),
            h_flex()
              .flex_none()
              .p(PAD)
              .gap(PAD)
              .rounded(RADIUS)
              .bg(t.raised)
              .items_center()
              .child(
                // Our own search icon: the stock one is smaller and thinner than the others.
                svg(`mods/${icon === "search" ? "new-work" : "workspace-chrome"}/${icon}.svg`)
                  .size(16)
                  .flex_none()
                  .text_color(planned ? t.accent : t.dim),
              )
              .child(
                v_flex()
                  .flex_1()
                  .min_w(0)
                  .gap(2)
                  // Always the same two lines, so the dialog doesn't jump when you start typing.
                  .child(
                    div()
                      .truncate()
                      .text_size(TEXT)
                      .font_medium()
                      .child(planned?.what ?? "What happens"),
                  )
                  .child(
                    planned
                      ? div()
                          .truncate()
                          .text_size(SMALL)
                          .text_color(t.dim)
                          .child([where, modelNote].filter(Boolean).join(" · "))
                      : h_flex()
                          .gap(PAD)
                          .text_size(SMALL)
                          .overflow_hidden()
                          .child(hint("Linear", "make PR"))
                          .child(hint("GitHub PR", "review"))
                          .child(hint("Prompt or Slack", "explore")),
                  ),
              ),
          ).flex_none(),
        )
        .child(
          h_flex()
            .flex_none()
            .gap(GAP)
            .items_center()
            .child(
              h_flex()
                .h(CONTROL)
                .p(2)
                .gap(2)
                .rounded(RADIUS)
                .border_1()
                .border_color(t.input)
                .bg(t.background)
                .children(MODELS.map(segment)),
            )
            .child(div().flex_1())
            .child(keys("command.svg", "corner-down-left.svg"))
            .child(button("nw-cancel", "Cancel", false, () => this.leave()))
            .child(button("nw-start", "Start", true, () => this.go())),
        )
    );
  }
}
