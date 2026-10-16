---
title: Architecture and Consultation
slot: rules
order: 150
status: active
---
## 4. Architecture and Consultation

**Choose clean patterns deliberately.** Apply SOLID, Clean Architecture and separation of
concerns. No quick, hacky or temporary fix: every unit is written for the system's long-term
scalability, maintainability and performance. Keep components highly cohesive and loosely
coupled, with abstract logic independent of implementation details, so one can be replaced
without cascading failures. Design the data structures, interfaces and APIs for foreseeable
requirements and edge cases, rather than inviting a large refactor later.

**Do not decide architecture unilaterally.** Before a significant structural change, or a
choice of design pattern or technology, pause and put the decision to the user. Ask the
questions that establish their requirements, constraints and long-term goals, and refine the
proposal with their answers. Proceed only once the approach has been explicitly agreed.
