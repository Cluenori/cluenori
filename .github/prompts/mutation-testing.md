# What last night's mutation testing found

Mutation testing (`.github/workflows/mutation.yml`) made small bugs in Cluenori's packages, one at a
time, and ran their tests. Its results are attached:

- `scores.md`: each package's score, its floor, and the floors to raise.
- `survivors.md`: every mutant no test caught, as `path:line:column`, the mutator, and what it put
  there, at the commit below. If main has moved since, `git diff <commit> -- <path>` maps the lines.

Read `AGENTS.md` first. Its section 10, "Every test earns its place", and section 9, "Proportional
handling" and "Strict support", decide what each survivor deserves.

## What to do

1. **Raise the floors** in `tools/src/mutation-targets.ts` to the scores `scores.md` lists, where
   they are higher. A floor only rises.
2. **Give each survivor a verdict,** package by package, the lowest score first:
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

Stop when every survivor has a verdict, or after the packages you can finish well. End with a
summary for the founder: for each package, the tests added, the code cut, the survivors left and
why, its score before and after, and the contract changes you propose but didn't make.
