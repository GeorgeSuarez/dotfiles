---
description: Open a GitHub PR with a generated title and body for the current branch
argument-hint: "[base-branch]"
---
1. Determine the current branch and diff it against `${1:-main}` (`git log`, `git diff`) to understand the change.
2. Write a PR title (conventional-commit style) and a body with: a summary of the change, the motivation, key implementation points, and a "Verification" section listing what was tested or run.
3. Push the branch if needed, then open the PR with `gh pr create`. Show me the URL.
