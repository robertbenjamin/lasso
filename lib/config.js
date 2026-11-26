import { layout, readTextFile, appHome, run, shared, setShared } from "herdr";

export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export const boardShown = () => find(layout(), "work-stack")?.active === "board-page";
// The Spaces list folds to its header row, a collapsible section: Herdr's own layout.resize,
// kept per screen. Unfolded, it gets back the share it had.
const SPACES_HEADER = 36; // tasks-spaces' header height
export const spacesFolded = () => find(layout(), "spaces")?.size?.px === SPACES_HEADER;
export function toggleSpaces() {
  if (spacesFolded())
    return run("layout.resize", { id: "spaces", weight: shared("spaces.weight") ?? 1 });
  setShared("spaces.weight", find(layout(), "spaces")?.size?.weight ?? 1);
  run("layout.resize", { id: "spaces", px: SPACES_HEADER });
}

let lassoConf = {};
export async function loadConf() {
  const text = await readTextFile(`${appHome()}/lasso.json`).catch(() => null);
  try {
    lassoConf = text ? JSON.parse(text) : {};
  } catch {}
  return lassoConf;
}
export const conf = () => lassoConf;
// A mod's own copy of lasso.json, read again every minute: mods share no memory.
export function keepConfFresh(cx) {
  cx.spawn(loadConf);
  cx.timer.every(60000, (cx) => cx.spawn(loadConf));
}
export const repoAlias = (repo) => conf().repoAliases?.[repo] ?? repo;
export const isAlias = (label) => Object.values(conf().repoAliases ?? {}).includes(label);

export const bin = (script) => `${appHome()}/bin/${script}`;
