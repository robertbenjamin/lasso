// New work jobs, queued by mods/new-work. Each runs bin/herdr-open-work here, not in a
// sidebar mod, so New work keeps working with the Spaces list hidden.
import { run, exec, shared, setShared } from "herdr";
import { bin } from "./lib/shared.js";

const jobs = () => shared("newwork.jobs") ?? [];
// `change: null` removes the job.
const saveJob = (id, change) =>
  setShared(
    "newwork.jobs",
    jobs().flatMap((j) => (j.id !== id ? [j] : change ? [{ ...j, ...change }] : [])),
  );

// A failure also opens a background space with the command and its stderr.
function fail(job, error, stderr = "") {
  saveJob(job.id, { error });
  const text = `New work failed: ${job.label}\n$ herdr-open-work ${job.args.join(" ")}\n\n${stderr.trim() || error}\n`;
  run("space.new", {
    name: "New work failed",
    argv: ["zsh", "-c", 'print -r -- "$1"; exec "${SHELL:-/bin/zsh}" -l', "nw", text],
    focus: false,
  });
}

// `running`: ids of the jobs this Herdr runs now. A started job missing from it outlived a restart.
export function runJobs(running, cx) {
  const now = Date.now();
  for (const job of jobs()) {
    // The Spaces list hides a done row once its space shows; this cap clears it either way.
    if (job.dir) {
      if (now - job.done > 5000) saveJob(job.id, null);
    } else if (job.started && !job.error && !running.has(job.id)) {
      fail(job, "Stopped: Herdr restarted while it ran.");
    } else if (!job.started) {
      running.add(job.id);
      saveJob(job.id, { started: now });
      cx.spawn(async () => {
        // The repo pick and the fetch can take longer than exec's 30 s default.
        const result = await exec(bin("herdr-open-work"), job.args, { timeout: 120000 }).catch(
          (e) => ({ code: 1, stdout: "", stderr: String(e) }),
        );
        running.delete(job.id);
        const dir = result.code === 0 && result.stdout.trim().split("\n").pop();
        if (dir) saveJob(job.id, { dir, done: Date.now() });
        else
          fail(
            job,
            result.stderr.trim().split("\n").pop() || `Failed (exit ${result.code}).`,
            result.stderr,
          );
      });
    }
  }
}
