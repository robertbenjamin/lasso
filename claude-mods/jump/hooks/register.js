// A Claude Code mod (not a Herdr mod): scrolls the chat to the message bin/lasso-reveal names.
// Claude Code scrolls the chat for a mod only inside a key press or click, so lasso-reveal
// presses a key that this hidden button takes.
// Shared with bin/lasso-reveal: the folder, the file names, and the key of ACTION (Ctrl+Up by
// default, and free in the chat: Claude Code uses it only while its diff panel is open).
const DIR = "/tmp/lasso-jump";
const ACTION = "app:diffFileListUp";

export function register(on) {
  // The footer's mode label is always drawn, and the user cannot collapse it.
  on("ui.render", { component: "SessionMode" }, async ($, e, next) => {
    const { Box, Button } = $.ui.resolve(e);
    const button = Button({
      key: "lasso-jump",
      label: "",
      plain: true,
      action: ACTION,
      onPress: async () => {
        const file = `${DIR}/${await $.session.id()}`;
        const requestId = (await $.fs.read(file)).trim();
        const result = await $.ui.scroll({ to: { requestId }, block: "start" });
        await $.fs.write(`${file}.result`, result.deny ?? "ok");
      },
    });
    return Box({
      flexDirection: "row",
      children: [await next(e), Box({ display: "none", children: [button] })],
    });
  });
}
