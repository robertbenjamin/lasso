// New work, as in Conductor: paste a Linear, GitHub PR or Slack link and a note, and Claude
// starts with sane defaults. Opened by cmd-shift-n (keys.json: mod.open:new-work) and by the
// hover "+" on a space (mods/tasks-spaces, props { space }).
//   GitHub PR    -> that PR's repo, a worktree on its branch, the "review" prompt
//   Linear       -> repo chosen: a worktree on branch <ID>, the "implement" prompt
//                   home: Claude in the work folder finds the repo
//   anything else -> explore: repo chosen: a worktree with a city name; home: no worktree
// The repo is "auto" (PR: from the link; Linear: its label or Claude; other: Claude, else home).
// Type a repo name to force one ("home" or "meta": the work folder).
// The sidebar (mods/tasks-spaces) runs bin/herdr-open-work (worktree, space, Claude).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { props, closeOverlay, theme, shared, setShared, readTextFile, appHome } from "herdr";

// The task text for a ticket and a PR: "prompts" in lasso.json; {input} is the pasted text.
const PROMPTS = { implement: "Implement {input}. Then open a draft PR.", review: "Review the PR {input}. Do not change code. Report the problems you find." };
let prompts = PROMPTS;
readTextFile(`${appHome()}/lasso.json`).then((t) => { prompts = { ...PROMPTS, ...JSON.parse(t).prompts }; }).catch(() => {});
const fill = (kind, text) => prompts[kind].replaceAll("{input}", text);

const PR = /https:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/;
const LINEAR = /linear\.app\/[\w-]+\/issue\/([A-Za-z]+-\d+)/;
const TICKET = /\b([A-Z]{2,5}-\d+)\b/;

export function plan(text, chosen) {
  const pr = text.match(PR);
  if (pr) return { what: `Review PR #${pr[2]}`, repo: pr[1], pr: pr[2],
    task: fill("review", text) };
  const id = (text.match(LINEAR)?.[1] ?? text.match(TICKET)?.[1])?.toUpperCase();
  // Your own words next to the links (maybe instructions): then an LLM picks the repo.
  const extra = /[A-Za-z]{2,}/.test(text.replace(/https?:\/\/\S+/g, " ").replace(TICKET, " "));
  // auto (herdr-open-work): a ticket alone goes by its service label, at once; with your
  // words, or no mapped label, an LLM picks. Not sure: home.
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
    // The sidebar (mods/tasks-spaces) shows the job as a row at once and runs
    // herdr-open-work: it finds the repo, makes the worktree and opens the real space.
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

  // Styled like Herdr's own prompt dialog (mods/prompt): title + Esc, small labels, rounded
  // fields with an accent border on focus, Cancel and a solid primary button.
  render() {
    const t = theme();
    const text = this.text.trim();
    const p = text ? plan(text, this.repo) : null;
    const icon = !p ? "layers" : p.pr ? "git-compare" : p.linear || p.branch ? "circle-check" : "search";
    const where = !p ? "" : p.repo === "auto" ? `${p.how} · ${p.branch ? `worktree ${p.branch}` : "worktree with a city name, or a tab in the work folder"}`
      : p.repo === "home" || p.repo === "meta" ? "work folder · new tab, no worktree"
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
