---
description: Review a diff against a base branch for bugs, security, and error handling
argument-hint: "[base-branch]"
---
Review the changes between `${1:-main}` and the working tree.

1. Run `git diff --stat ${1:-main}`, then `git diff ${1:-main}` to read the changes. If the working tree is clean, review the latest commit with `git show --stat HEAD`.
2. Focus on, in order: correctness bugs, security issues (injection, secrets, authz), error handling gaps, then style.
3. Report findings as a numbered list with `file:line` references, severity (blocker/major/minor), and a suggested fix for each. If nothing is wrong, say so plainly.

Do not modify any files.
