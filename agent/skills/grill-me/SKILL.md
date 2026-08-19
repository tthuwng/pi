---
name: grill-me
description: A relentless interview to sharpen a plan or design.
disable-model-invocation: true
---

Interview the user relentlessly until you reach a shared understanding. Map
the work as a design tree. Every decision branches into decisions that depend
on it.

Work in rounds. The frontier is every decision whose prerequisites are settled.
Ask the whole frontier in one round. Number each question and recommend an
answer.

Format each question like this:

```text
❓ **Q1** - **<question title>**: <question body>
➡️ <your recommended answer>
```

Each answer reshapes the tree. Recompute the frontier before the next round.
Do not ask a question whose answer depends on another open question.

Find facts yourself. Use files and tools instead of asking the user for facts.
The user owns the decisions. Ask those decisions and wait.

End only when every branch is resolved and no assumption remains. Do not act
until the user confirms the shared understanding.
