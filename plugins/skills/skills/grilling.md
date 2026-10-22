# Grilling

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask now without guessing at answers you have not heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like this:

```
Q1 - <question title>: <question body, including multiple choices>

> <your recommended answer>

---

Q2 - <question title>: <question body>

> <your recommended answer>
```

Word each question so "yes" accepts your recommended answer.

Each answer reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a later round, not this one.

Finding facts is your job, never the user's. When a frontier question needs a fact from the environment, dispatch a subagent to find it; do not ask the user for anything you can look up yourself. Do not block on it: ask the rest of the frontier now, and let only the downstream questions wait.

The session is done when the frontier is empty: every branch visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
