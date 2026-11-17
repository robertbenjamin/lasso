// The New work dialog (cmd-shift-n, or the hover "+" on a space): paste a link or a note, and
// Claude starts in a new worktree.
//   GitHub PR      that PR's repo, a worktree on its branch, the "review" prompt
//   Linear ticket  a worktree on branch <ID>, the "implement" prompt
//   anything else  a worktree with a city name
// The repo is picked automatically unless you type one ("home": the work folder).
// The dialog only queues a job; the sidebar (mods/tasks-spaces) runs bin/herdr-open-work.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared } from "herdr";
import { conf, loadConf } from "./shared.js";

// From lasso.json (read each time the dialog opens): the task text for a ticket and a PR
// ({input} is the pasted text), and the work folder's name, which means "home" too.
const PROMPTS = { implement: "Implement {input}. Then open a draft PR.", review: "Review the PR {input}. Do not change code. Report the problems you find." };
const fill = (kind, text) => ({ ...PROMPTS, ...conf().prompts })[kind].replaceAll("{input}", text);
const workName = () => conf().workRoot?.replace(/\/+$/, "").split("/").pop() ?? null;

const PR = /https:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/;
const LINEAR = /linear\.app\/[\w-]+\/issue\/([A-Za-z]+-\d+)/;
// Capitals only, unlike shared.js's TICKET: in pasted prose, "covid-19" is no ticket.
const TICKET = /\b([A-Z]{2,6}-\d+)\b/;

export function plan(text, chosen) {
  const pr = text.match(PR);
  if (pr) return { what: `Review PR #${pr[2]}`, repo: pr[1], pr: pr[2],
    task: fill("review", text) };
  const id = (text.match(LINEAR)?.[1] ?? text.match(TICKET)?.[1])?.toUpperCase();
  // Your own words next to the links: then Claude picks the repo, not the ticket's label.
  const extra = /[A-Za-z]{2,}/.test(text.replace(/https?:\/\/\S+/g, " ").replace(TICKET, " "));
  if (id && chosen === "auto") return { what: `Make PR ${id}`, how: extra ? "repo picked from the ticket and your note" : "repo from the ticket's service label", repo: "auto", branch: id, linear: id, extra, task: fill("implement", text) };
  if (id) return { what: `Make PR ${id}`, repo: chosen, branch: id, task: fill("implement", text) };
  if (chosen === "auto") return { what: "Explore", how: "repo picked from the task, else the work folder", repo: "auto", task: text };
  return { what: "Explore", repo: chosen, task: text };
}

export default class NewWork extends View {
  init(_props, cx) {
    this.text = "";
    this.repo = "auto";
    this.error = "";
    this.busy = false;
    this.box = TextareaState.new({ placeholder: "Describe the work, or paste a Linear, GitHub PR or Slack link", });
    this.box.on("change", (_e, cx) => { this.text = this.box.value?.() ?? this.box.content?.().text ?? ""; this.error = ""; cx.notify(); });
    this.box.on?.("submit", (_e, cx) => this.go(cx));
    this.repoInput = InputState.new({ placeholder: "Detect automatically" });
    this.repoInput.on("change", (_e, cx) => { this.repo = this.repoInput.value().trim() || "auto"; this.error = ""; cx.notify(); });
    this.repoInput.on("submit", (_e, cx) => this.go(cx));
    this.focus = "box";
    for (const [name, s] of [["box", this.box], ["repo", this.repoInput]]) {
      s.on?.("focus", (_e, cx) => { this.focus = name; cx.notify(); });
      s.on?.("blur", (_e, cx) => { if (this.focus === name) this.focus = null; cx.notify(); });
    }
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => { await loadConf(); cx.notify(); });
    this.box.focus();
    cx.timer.after(300, () => this.box.focus());
  }

  close() { closeOverlay(props()?.overlay); }

  go(cx) {
    if (this.busy) return;
    const text = this.text.trim();
    if (!text) { this.error = "Describe the work or paste a link."; return cx.notify(); }
    const p = plan(text, this.repo);
    const args = ["--repo", p.repo, ...(p.branch ? ["--branch", p.branch] : []), ...(p.pr ? ["--pr", p.pr] : []), ...(p.linear ? ["--linear", p.linear] : []), ...(p.extra ? ["--extra"] : []),
      "--", p.task];
    this.busy = true;
    const label = p.branch ?? (p.pr ? `PR #${p.pr}` : text.replace(/https?:\/\/\S+/g, " ").match(/\S+/g)?.slice(0, 4).join(" ") ?? "New work");
    const job = { id: `nw${Date.now()}`, label, repo: p.repo, args, at: Date.now() };
    setShared("newwork.jobs", [...(shared("newwork.jobs") ?? []), job]);
    this.close();
  }

  key(e, cx) {
    if (e.key === "escape") { cx.stop_propagation(); return this.close(); }
    if (e.key === "enter" && e.modifiers?.platform) { cx.stop_propagation(); this.go(cx); }
  }

  // Styled like Herdr's own prompt dialog (mods/prompt).
  render() {
    const t = theme();
    const text = this.text.trim();
    const p = text ? plan(text, this.repo) : null;
    const icon = !p ? "layers" : p.pr ? "git-compare" : p.linear || p.branch ? "circle-check" : "search";
    const where = !p ? "" : p.repo === "auto" ? `${p.how} · ${p.branch ? `worktree ${p.branch}` : "worktree (a tab if not git)"}`
      : p.repo === "home" || p.repo === workName() ?"work folder · worktree (a tab if not git)"
      : `${p.repo} · new space · worktree ${p.branch ?? (p.pr ? "on the PR branch" : "with a city name")}`;
    const label = (s) => div().pt(16).pb(7).text_size(11.5).text_color(t.dim).child(s);
    const field = (el, on) => el.px(10).rounded(9).border_1().border_color(on ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground);
    const button = (id, s, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .when(primary && (this.busy || !text), (el) => el.opacity(0.5))
      .hover((s) => s.opacity(0.88)).on_click(action).child(s);
    const hint = (k, v) => h_flex().gap(5).items_center().child(div().text_color(t.muted).child(k)).child(div().text_color(t.dim).child(v));
    return v_flex()
      .id("new-work")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .min_h(0)
      .p(18)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child("New work"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(label("Task"))
      .child(field(Textarea.new(this.box).flex_1().min_h(72).py(8), this.focus === "box"))
      .child(label("Repo"))
      .child(field(Input.new(this.repoInput).h(36).items_center(), this.focus === "repo"))
      .child(h_flex().flex_none().mt(12).px(10).py(9).gap(10).rounded(9).bg(t.raised).items_center()
        .child(svg(`mods/workspace-chrome/${icon}.svg`).size(15).flex_none().text_color(p ? t.accent : t.dim))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .when(Boolean(p), (el) => el
            .child(div().truncate().text_size(12.8).font_medium().child(p.what))
            .child(div().truncate().text_size(11.5).text_color(t.dim).child(where)))
          .when(!p, (el) => el.child(h_flex().gap(14).text_size(11.5).flex_wrap()
            .child(hint("Linear", "make PR")).child(hint("GitHub PR", "review")).child(hint("Prompt or Slack", "explore"))))))
      .when(Boolean(this.error), (el) => el.child(div().pt(6).text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(h_flex().flex_none().pt(20).gap(8).items_center()
        .child(div().flex_1().text_size(11).text_color(t.dim).child("⌘↵ start"))
        .child(button("nw-cancel", "Cancel", false, () => this.close()))
        .child(button("nw-start", "Start", true, (_e, cx) => this.go(cx))));
  }
}
