import { shared, spaces } from "herdr";
import { repoSpace, worktreeRepo } from "./git.js";

// The color says whose turn it is. No fill: nothing for you to do.
const REVIEW = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "in review" };
const CI_WORD = { FAILURE: "failed", ERROR: "failed", PENDING: "running", EXPECTED: "running" };
export function prLook(t, pr) {
  const state = pr.merged ? "merged" : pr.draft ? "draft" : (REVIEW[pr.review] ?? "open");
  const ci = pr.merged ? null : CI_WORD[pr.ci];
  const color = pr.merged
    ? "ansi5"
    : state === "changes" || ci === "failed"
      ? "ansi3"
      : state === "approved"
        ? "ansi2"
        : null;
  return { label: `${state}${ci ? `, CI ${ci}` : ""}`, fill: color && pastelFill(t, color) };
}

// Radix Colors v3: [light fill, light text, dark fill, dark text].
const PASTEL = {
  ansi6: ["#ccf3ea", "#008573", "#084843", "#0bd8b6"], // teal
  ansi3: ["#ffdfb5", "#cc4e00", "#562800", "#ffa057"], // orange
  ansi4: ["#d5efff", "#0d74ce", "#004074", "#70b8ff"], // blue
  ansi5: ["#ebe4ff", "#6550b9", "#3c2e69", "#baa7ff"], // violet
  ansi2: ["#daf1db", "#2a7e3b", "#25482d", "#71d083"], // grass
  ansi1: ["#fbdcef", "#c2298a", "#591c47", "#ff8dcc"], // pink
};
const channel = (hex, i) => parseInt(hex.slice(i, i + 2), 16);
export const isDark = (t) => {
  const chrome = t.chrome ?? "#ffffff";
  return channel(chrome, 1) * 0.3 + channel(chrome, 3) * 0.59 + channel(chrome, 5) * 0.11 < 128;
};

export function pastelFill(t, color) {
  if (color.startsWith("#")) return { bg: color, fg: "#ffffff" };
  const [lightBg, lightFg, darkBg, darkFg] = PASTEL[color] ?? PASTEL.ansi6;
  return isDark(t) ? { bg: darkBg, fg: darkFg } : { bg: lightBg, fg: lightFg };
}
export const spaceFill = (t, id) => pastelFill(t, (shared("space.colors") ?? {})[id] ?? "ansi6");

export function tintOf(t, cwd, space) {
  const all = spaces(),
    repo = worktreeRepo(cwd);
  const id = repoSpace(all, repo, space) ?? all.find((s) => s.active)?.id;
  const color = (shared("space.colors") ?? {})[id] ?? "ansi6";
  return color.startsWith("#") ? color : pastelFill(t, color).fg;
}

// A #rrggbbaa color made opaque over `base`.
export function solid(color, base) {
  if (!/^#[0-9a-f]{8}$/i.test(color ?? "") || !/^#[0-9a-f]{6}/i.test(base ?? ""))
    return (color ?? "").slice(0, 7);
  const alpha = channel(color, 7) / 255;
  const mix = (i) => Math.round(channel(color, i) * alpha + channel(base, i) * (1 - alpha));
  return "#" + [1, 3, 5].map((i) => mix(i).toString(16).padStart(2, "0")).join("");
}
