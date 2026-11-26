import { layout, readTextFile, appHome } from "herdr";

export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export const boardShown = () => find(layout(), "work-stack")?.active === "board-page";
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
