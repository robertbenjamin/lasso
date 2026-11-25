// Types into a demo agent's terminal a key at a time, as a person would, then tells the card.
import { exec } from "herdr";

// exec stops a command after 30 s unless told otherwise, and a held prompt waits for you.
const TYPE_LIMIT = 600000;
// $1 the terminal, $5 on its keys, each one `hc` call (that is the pace). Then a pause to read
// it, and Enter. `hc keys` has no "?": a last character it cannot press comes in $4, and
// `hc send` pastes it and presses Enter in one go.
// With $3 it leaves the Enter to you, tells the card (tour.typed) and waits for it: $3 is
// what the agent prints once it has the prompt.
// With a step in $2 it then waits until that agent has answered and tells the card (tour.ready).
const TYPE = `terminal=$1; step=$2; hold=$3; last=$4; shift 4; sleep 1.5
for key in "$@"; do hc keys $terminal $key >/dev/null || exit; done
if [[ -n $hold ]]; then
  herdr-app do tour.typed-$step >/dev/null
  hc wait $terminal --output "$hold" --timeout 540 >/dev/null
elif [[ -n $last ]]; then
  hc send $terminal "$last" >/dev/null
else
  sleep 0.7; hc keys $terminal enter >/dev/null
fi
[[ -n $step ]] || exit 0
sleep 1.5; hc wait $terminal >/dev/null; herdr-app do tour.ready-$step >/dev/null`;

// Types `text` into a terminal and presses Enter. With `hold` it leaves the Enter to you, and
// knows you pressed it when the agent prints that. One shell command does it all: a command
// that runs is not cut off when the card that started it closes.
export function type(terminal, text, step = "", hold = "") {
  if (!terminal) return;
  const chars = [...text],
    last = /[a-z0-9 ,.'-]$/i.test(text) ? "" : chars.pop(),
    keys = chars.map((char) => (char === " " ? "space" : char));
  const args = ["-c", TYPE, "tour-type", terminal, step, hold, last, ...keys];
  exec("zsh", args, { timeout: TYPE_LIMIT }).catch(() => null);
}
