---
description: Write a conventional commit message for the staged changes and commit them
---
1. Run `git diff --cached --stat` and `git diff --cached` to see the staged changes. If nothing is staged, say so and stop.
2. Write a conventional commit message (`type(scope): summary` in imperative mood, subject ≤ 72 chars) with a body explaining the why for non-trivial changes.
3. Commit with that message using a heredoc. Do not stage additional files beyond what is already staged.
