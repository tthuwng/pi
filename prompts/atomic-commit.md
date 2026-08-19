Create atomic commits for the current repository changes.

1. Inspect the working tree. Preserve unrelated user changes.
2. Run `omp commit --dry-run --no-changelog`.
3. Review the proposed split and messages.
4. If the split is safe, run `omp commit --no-changelog`.
5. Report each commit hash and message.

Do not push. Do not commit secrets, generated files, or unrelated changes.
