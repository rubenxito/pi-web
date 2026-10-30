# PI understanding

Notes I keep to myself while learning how Pi and my extensions behave.

## Branch vs worktree

**Branch** — a fork of the *conversation*. Going back and taking another path
changes what the agent remembers, not what is on disk. Every branch and every
session fork edits the same files. No protection.

**Worktree** — a real second copy of the repo on disk, on its own git branch.
Pi Web puts it next to the repo (`<repo>-worktrees/<name>`) and sessions started
there use that folder as their working directory. Writes land there, not in my
checkout, and throwing the worktree away discards them safely.

What a worktree does not do: same user, same home directory. `~/.ssh`, `~/.aws`,
a global `pip install`, a `git push` all still reach the real machine. It
isolates *which checkout gets dirtied*, not *what the process can reach*.

Rule I follow: worktree per risky task, `config.json` for anything that escapes
the repo, and neither is a sandbox — only the OS is (container, VM, other user).
