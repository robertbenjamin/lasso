// Node has no Herdr modules. The tests import the mods' pure rules, which load modules that
// import Herdr, so each Herdr module resolves to a stub of no-op functions.
import { registerHooks } from "node:module";

const STUBS = {
  herdr: [
    "agents",
    "appHome",
    "checking",
    "closeOverlay",
    "exec",
    "focused",
    "knownAgents",
    "layout",
    "nextCommand",
    "notify",
    "openOverlay",
    "panes",
    "props",
    "readTextFile",
    "run",
    "setAgentOrder",
    "setBadge",
    "setShared",
    "shared",
    "spaces",
    "terminals",
    "theme",
    "updates",
    "window",
  ],
  "gpui-kit": ["Background", "PathBuilder", "View", "div", "image", "svg"],
  "gpui-base": ["Input", "InputState", "Popup", "Textarea", "TextareaState", "h_flex", "v_flex"],
};

registerHooks({
  resolve(specifier, context, next) {
    if (!(specifier in STUBS)) return next(specifier, context);
    const source = STUBS[specifier].map((name) => `export const ${name} = () => {};`).join("\n");
    return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
  },
});
