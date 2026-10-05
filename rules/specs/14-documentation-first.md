---
title: Documentation-First Coding
slot: rules
order: 140
status: active
---
## 2. Documentation-First Coding
You must define the contract and purpose of every class and function *before/above declaration and the implementation*. This separates the high-level intent from the low-level mechanical execution.

* **Pre-Implementation Block:** Immediately preceding the class or function definition, you must include a structured comment block containing:
    * **PURPOSE:** What specific business or system task does this solve?
    * **INPUTS:** Detailed description of expected inputs, including their types.
    * **OUTPUTS:** Detailed description of the expected outputs, including types and potential null states.
    * **KEYWORDS:** Contextually fitting keywords to aid in repository search and agent context retrieval.
* **Mechanical Docstrings:** Inside the function/class definition, use standard docstrings to describe *what the code actually does mechanically* under the hood, which is distinct from its overarching purpose.
* **Self-Contained, Factual Inline Documentation:** Inline documentation — the PURPOSE/INPUTS/OUTPUTS/KEYWORDS header, block comments, and docstrings — must be self-contained and purely factual. It must NEVER reference external documentation files (this rules file, any `AGENTS.md`, a `README`, or prose under `docs/`) as the source of a code element's contract, behavior, or motivation. Everything a reader needs to understand the code — including its rationale — must live inside the inline documentation itself, so the inline text stays consistent on its own. Cross-references are allowed ONLY to other code parts/functions (e.g. "see `resolve()`"), never to documentation files.
* **Handling Edge Cases:** Explicitly document how the function behaves when given edge-case inputs (e.g., empty arrays, null pointers, negative integers) in both the OUTPUTS section and the internal docstring.
* **`.md` Documentation = Decisions, Not Implementation:** Markdown files (README, `docs/*`, decision records) must NEVER describe what is implemented — the question of WHAT (and the per-unit part of WHY) is answered by inline documentation next to the code. A `.md` file exists to answer WHY only at the project/architecture scope, never per class/function. It should capture the decisions made and their motivation, issues encountered and how they were resolved, and the experience/lessons gained from alternatives that were explored and rejected. Do not let a doc file become a prose mirror of the implementation.
* **Documentation Is Part of the Change (No Drift):** Every code change MUST update the inline documentation it invalidates, in the SAME change — never as a follow-up. Any edit to a function's behavior, contract, inputs, outputs, edge cases, assumptions, or rationale updates the corresponding PURPOSE/INPUTS/OUTPUTS/KEYWORDS block and docstring before the change is considered complete. A diff that alters code while leaving its inline documentation stale is an INCOMPLETE change and must be treated as a defect (this is the concrete form of §1's "don't forget to change the docs"). When code is deleted, its orphaned inline documentation goes with it.

### Example Standard:

```python
# PURPOSE: Authenticate a user session to grant access to protected API routes.
# INPUTS: user_id (str), auth_token (str)
# OUTPUTS: Boolean indicating valid session. Returns False if token is expired or malformed.
# KEYWORDS: authentication, security, session, api, validation
def validate_user_session(user_id: str, auth_token: str) -> bool:
    """
    Queries the Redis cache using the user_id as the key. Compares the stored 
    hashed token against the provided auth_token using a constant-time comparison 
    to prevent timing attacks. Checks the TTL of the Redis key to ensure the 
    session has not timed out.
    """
    # Implementation follows, including rigorous LDD logging...
```
