import { focused, panes, terminals } from "herdr";

// The focused terminal, or null. A focused pane gives only its pane id.
export function focusedTerminal() {
  const focus = focused();
  const paneTerminal = focus?.pane
    ? panes().find((pane) => pane.pane === focus.pane)?.terminal
    : null;
  const address = focus?.terminal ?? paneTerminal ?? focus?.agent;
  return address ? (terminals().find((terminal) => terminal.address === address) ?? null) : null;
}
