// The dialog only queues a job; the sidebar (mods/tasks-spaces) runs bin/herdr-open-work.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared } from "herdr";
import {
  conf,
  loadConf,
  GAP,
  PAD,
  SECTION,
  CONTROL,
  RADIUS,
  RADIUS_SM,
  TEXT,
  SMALL,
  TITLE,
} from "./lib/shared.js";

// The work folder's name means "home" too.
const PROMPTS = {
  implement: "Implement {input}. Then open a draft PR.",
  review: "Review the PR {input}. Do not change code. Report the problems you find.",
};
const fill = (kind, text) => ({ ...PROMPTS, ...conf().prompts })[kind].replaceAll("{input}", text);
const workName = () => conf().workRoot?.replace(/\/+$/, "").split("/").pop() ?? null;

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
      how: extra
        ? "repo picked from the ticket and your note"
        : "repo from the ticket's service label",
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
      how: "repo picked from the task, else the work folder",
      repo: "auto",
      task: text,
    };
  return { what: "Explore", repo: chosen, task: text };
}

export default class NewWork extends View {
  init(_props, cx) {
    this.text = "";
    this.repo = "auto";
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
    cx.spawn(async (cx) => {
      await loadConf();
      cx.notify();
    });
    this.box.focus();
    cx.timer.after(300, () => this.box.focus());
  }

  close() {
    closeOverlay(props()?.overlay);
  }

  go() {
    if (this.busy) return;
    const text = this.text.trim();
    if (!text) return;
    const planned = plan(text, this.repo);
    const args = [
      "--repo",
      planned.repo,
      ...(planned.branch ? ["--branch", planned.branch] : []),
      ...(planned.pr ? ["--pr", planned.pr] : []),
      ...(planned.linear ? ["--linear", planned.linear] : []),
      ...(planned.extra ? ["--extra"] : []),
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
    const job = { id: `nw${Date.now()}`, label, repo: planned.repo, args, at: Date.now() };
    setShared("newwork.jobs", [...(shared("newwork.jobs") ?? []), job]);
    this.close();
  }

  key(e, cx) {
    if (e.key === "escape") {
      cx.stop_propagation();
      return this.close();
    }
    if (e.key === "enter" && e.modifiers?.platform) {
      cx.stop_propagation();
      this.go();
    }
  }

  render() {
    const t = theme();
    const text = this.text.trim();
    const planned = text ? plan(text, this.repo) : null;
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
        ? `${planned.how} · ${planned.branch ? `worktree ${planned.branch}` : "worktree (a tab if not git)"}`
        : planned.repo === "home" || planned.repo === workName()
          ? "work folder · worktree (a tab if not git)"
          : `${planned.repo} · new space · worktree ${planned.branch ?? (planned.pr ? "on the PR branch" : "with a city name")}`;
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
    const keys = (...ks) => h_flex().gap(4).items_center().children(ks.map(key));
    const group = (name, ...children) =>
      v_flex()
        .gap(GAP)
        .child(div().text_size(SMALL).text_color(t.dim).child(name))
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
    return v_flex()
      .id("new-work")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .min_h(0)
      .p(SECTION)
      .gap(SECTION)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(
        h_flex()
          .items_center()
          .child(div().flex_1().text_size(TITLE).font_semibold().child("New work"))
          .child(key("Esc")),
      )
      .child(
        group(
          "Task",
          field(Textarea.new(this.box).flex_1().min_h(72).py(GAP), this.focus === "box"),
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
              svg(`mods/workspace-chrome/${icon}.svg`)
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
                    .when(!planned, (el) => el.text_color(t.dim))
                    .child(planned?.what ?? "What happens"),
                )
                .child(
                  planned
                    ? div().truncate().text_size(SMALL).text_color(t.dim).child(where)
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
            keys("command.svg", "corner-down-left.svg")
              .flex_1()
              .child(div().text_size(SMALL).text_color(t.dim).child("to start")),
          )
          .child(button("nw-cancel", "Cancel", false, () => this.close()))
          .child(button("nw-start", "Start", true, () => this.go())),
      );
  }
}
