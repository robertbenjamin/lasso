// The tour's demo repo: an empty git repo in ~/.herdr/tour. New work makes its worktrees in
// ~/.herdr/worktrees/<TOUR_REPO>, as for any repo.
import { exec, home, run, spaces, terminals } from "herdr";
import { TOUR_REPO } from "./lib/shared.js";

const roots = () => [`${home()}/.herdr/tour`, `${home()}/.herdr/worktrees/${TOUR_REPO}`];
const inDemo = (folder) => roots().some((root) => folder?.startsWith(`${root}/`));
export const demoRepo = () => `${roots()[0]}/${TOUR_REPO}`;

// The commit needs an author, and a new machine may have none set.
const AUTHOR = ["-c", "user.name=lasso tour", "-c", "user.email=tour@lasso.invalid"];

export async function up() {
  await exec("git", ["init", "-q", "-b", "main", demoRepo()]);
  const args = ["-C", demoRepo(), ...AUTHOR, "commit", "-q", "--allow-empty", "-m", "Start"];
  const commit = await exec("git", args);
  if (commit.code !== 0)
    throw new Error(commit.stderr.trim() || "git could not make the demo repo");
}

// Terminals first: Herdr shows a closed space again while its terminals still run.
// Nothing is awaited before the `rm` starts: the tour runs this from a card that is closing,
// and only a command that already runs survives that.
export async function down() {
  for (const terminal of terminals())
    if (inDemo(terminal.cwd)) run("terminal.kill", { terminal: terminal.address });
  for (const space of spaces())
    if (inDemo(space.folder)) run("space.close", { id: space.id, confirmed: true });
  await exec("rm", ["-rf", ...roots()]);
}
