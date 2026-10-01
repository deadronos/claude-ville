# Superpowers plans and specs

`plans/` and `specs/` hold execution artifacts written by the
[superpowers](https://github.com/obra/superpowers) workflow — implementation
plans and their upstream design specs. They are committed so the reasoning behind
a change outlives the branch that carried it.

## How to read a plan's checkboxes

**Unchecked boxes are not a status report.** A plan is written before the work
starts, and most are committed with every box unchecked — including plans whose
work is long since merged. Across this directory that is ~380 unchecked boxes,
and only 3 of 14 plan files have any checked box at all.

Do not mass-check them. Doing so would assert hundreds of completions that
nobody verified, which is the same defect class as a comment claiming a caller
that does not exist: a source of truth that is confidently wrong is worse than
one that is merely incomplete.

**The authoritative status of a change is the GitHub issue that tracks it**, not
the plan file. If you need to know whether a plan's work landed, look at the
linked issue and the commits it closed.

If you are executing a plan right now, tick boxes as you go — that is what they
are for. The inconsistency above is only a problem for plans being read
*after* the fact.

## Related repo docs

- [`docs/architecture/`](../architecture/) — the durable description of how the
  system works today. Update this, not the plan, when behaviour changes.
- [`CLAUDE.md`](../../CLAUDE.md) and [`AGENTS.md`](../../AGENTS.md) — agent
  entry points.
