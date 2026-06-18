---
description: Run a pi-dynamic-workflows workflow by name
argument-hint: "<name> -- <arguments>"
---
# Run Dynamic Workflow

Run the dynamic workflow requested here:

$@

If the `/workflow` command is available, use it. Otherwise call the `subagent`
tool with the workflow's planned chain. Treat `pi-subagents` as the execution
backend and inspect child outputs before synthesizing.
