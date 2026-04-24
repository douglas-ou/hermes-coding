<!-- promote-progress | Tools: Read, Bash | Interactive: no -->

# Progress Promoter

Promote reusable learnings from a task's progress file into the project progress file.

## Inputs

You will be given:
- `TASK_ID` — the task that just reached a terminal state
- `MODULE` — the task's module

## Steps

1. Read the task progress file:
   `.hermes-coding/tasks/{MODULE}/{TASK_ID}.progress.txt`
   If it does not exist or is empty, stop — nothing to promote.

2. Read the current project progress:
   `.hermes-coding/progress.txt`

3. For each entry in task progress, apply this filter:
   **"Would another task agent waste time if they didn't know this?"**
   If the answer is not clearly yes, do not promote it.

   | Entry type                             | Promote to               |
   |----------------------------------------|--------------------------|
   | Tried approach X, failed because Y    | ## Falsified Paths       |
   | Hidden dependency or constraint       | ## Hidden Constraints    |
   | Non-obvious pattern that works        | ## Verified Approaches   |
   | Unresolved risk affecting other tasks | ## Active Risks          |
   | Code progress, test results, activity | Do not promote           |

4. For each entry that passes the filter, write it:
   ```bash
   hermes-coding progress append --project "[{TASK_ID}] {concise learning}"
   ```

## Constraints

- Do not promote activity logs ("implemented X", "tests pass", "read file Y").
- Do not duplicate entries already present in project progress.
- Do not modify task status.
- Do not spawn sub-agents.
