# What last night's mutation testing found

Mutation testing (`.github/workflows/mutation.yml`) made small bugs in Cluenori's packages, one at a
time, and ran their tests. Its results are attached:

- `scores.md`: each package's score, its floor, and the floors to raise.
- `survivors.md`: every mutant no test caught, as `path:line:column`, the mutator, and what it put
  there, at the commit below. If main has moved since, `git diff <commit> -- <path>` maps the lines.

Read `AGENTS.md` first. Its section 10, "Every test earns its place", and section 9, "Proportional
handling" and "Strict support", decide what each survivor deserves.

## What to do

Work in bounded, well-verified slices, not an obligation to solve all survivors tonight. Prioritize
the lowest scores and aim to finish the analysis, follow-up verification and closure by
04:00–05:00 Europe/Warsaw (CET in winter, CEST in summer). Reserve time for CI and targeted mutation
runs before starting another package. This is a planning target, never permission to skip proof or
land failing work. If the handoff is late or a run is slow, finish the safe slice and explicitly
defer the rest; do not silently leave a running job or unfinished branch as completed work.

1. **Raise the floors** in `tools/src/mutation-targets.ts` to the scores `scores.md` lists, where
   they are higher. A floor only rises.
2. **Triage survivors in the selected packages,** the lowest score first. For each one examined:
   - **A test that catches it,** when it changes what a caller can see. Test through the package's
     contract, as its tests do; a row in an existing table of cases beats a new test.
   - **Cut the code,** when nothing observes it: a check another check already makes, a branch no
     input reaches. A cut that changes what a caller can observe is a contract change: don't make
     it; propose it in your summary.
   - **Leave it,** when no input tells the two apart: `<=` for `<` where the values never meet, a
     message's wording, a span's name. Say why in your summary; no test for it.
3. **Prove each change** with the package's own tests, `bun run test <folder>`, and its types,
   `bun run --cwd <folder> typecheck`. Don't run all of `bun run test` or Stryker here: an orb's
   memory isn't enough. CI runs everything on push, and mutation testing on what you ask it to:
   push your work to a branch, then
   `gh workflow run mutation.yml --ref <branch> -f folders=<folder>,<folder>`; its run's summary
   has the scores, and its `mutation-results` artifact the survivors
   (`gh run download <run> -n mutation-results`).
4. **Land each package's work on main** as its own commit, with its proof, as `AGENTS.md` says,
   once its checks and its mutation run pass. Before pushing, `git pull --rebase`: an earlier
   night's orb may be landing too.

Stop after the packages you can finish well. Unexamined survivors are deferred, not equivalent or
solved. A verified partial improvement is a useful outcome; do not claim the whole campaign is
complete merely because your selected packages passed.

## Required final closure summary

Every mutation orb must end its final response with a prominent **Closure summary** section, even
if it made no changes, could not finish, or hit a blocker. Put the facts here, not only in a linked
artifact or progress update. Include all of the following:

- **Changes and delivery:** explicitly say whether changes were made, what tests were added or code
  cut, and whether the changes are committed, pushed, and landed. Name the repository, branch(es),
  and landing destination (or say not landed). Link every resulting commit on GitHub; for unpushed
  commits give SHAs and say local only. Say "none" when there are no commits. Account for any
  uncommitted changes or work left on a branch.
- **Behavior and contracts:** say whether production behavior changed, independently of tests or
  floor changes. Describe any change, or explicitly say none; list proposed contract changes that
  were not made.
- **Verification:** list the checks actually run and their results, with CI and targeted mutation
  run links and the commits measured. Distinguish passed, failed, pending and not run, including
  post-landing CI. Never call a pending run passed or reuse an older commit's result as fresh proof.
- **Mutation results:** include a before/after table with one row per package in the supplied
  `scores.md`, including untouched/deferred packages. Use these columns:

  | Package | Score before → after | Floor before → after | Caught/total before → after | Status |
  | --- | --- | --- | --- | --- |

  Use measured values and identify the baseline and after commits/runs. If not remeasured, say
  "not remeasured", not an inferred score; missing data is "unknown", never zero. Mark untouched
  floors as unchanged. Quantify newly caught mutants where comparable, or another measured
  improvement (for example score percentage points or a raised floor). If the mutant set or total
  changed, show both totals and don't describe a raw count difference as newly caught mutants. Say
  explicitly when no improvement was measured.
- **Remaining/deferred work:** name packages and survivors not examined, survivors deliberately
  left with their reasons, proposed work, and any blockers or required human actions. Quantify the
  remaining work when the report supports it. If none remains in this run's scope, say so.
- **Deployment:** explicitly say whether anything was deployed, what and where, or "not deployed".
  A push or passing CI is not a deployment; do not deploy merely to close the mutation task.

Finish the section with exactly one of these recommendations, copied verbatim, followed by a brief
reason:

- **Safe to archive — completed**: all supplied packages and survivors have been addressed or
  explicitly judged safe to leave, delivery and required verification are complete, and no deferred
  work, action or blocker remains. Say if no changes were needed.
- **Safe to archive — partial improvement landed**: a verified improvement landed, the remaining
  campaign work is explicitly deferred, and no active job, unfinished delivery or blocker needs
  attention. This does not mean all survivors were solved.
- **Keep open — action/blocker remains**: state the concrete next action and its owner, such as
  landing unpushed work, waiting for verification, or addressing a failed run. Use this when delivery
  or required verification remains incomplete, rather than calling the thread safe to archive.
