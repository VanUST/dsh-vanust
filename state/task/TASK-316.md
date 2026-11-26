---
id: TASK-316
kind: task
title: "Verify the state notification with an independent behavioural test"
status: review
revision: 3
createdAt: 2026-11-26T09:14:18.732Z
updatedAt: 2026-11-26T09:23:49.590Z
acceptance:
  - text: "a test file exists under a test root with its exact run command, and it asserts the plugin's behaviour through its public surface (the composed messages and the pre-step decision), not through private internals"
    done: false
  - text: "every property below has a named assertion: the first message carries the open-tasks block once; the delta carries it too; each number is a status count read from the board and not the length of the list; a task in status open and one in status active are both listed; more than twelve titles gives a '+N more' line; a board with nothing open says 'no open tasks'; the delta never exceeds the byte cap"
    done: false
  - text: "a wrong-product red is quoted: the same test against the previous build (0.1.6, where the count was the list length and status open was not listed) fails, and the failure names the property"
    done: false
  - text: "the green run on the current build (0.1.7) is quoted with the exact command and exit code"
    done: false
  - text: "the report says which properties could not be tested against the real product and why, and does not claim a live turn it did not observe"
    done: false
boardId: task-mwxc5sa7-mhya5k
chore: true
choreReason: "The owner asked for the state-feed plugin's behaviour to be verified with tests, and the implementer's own tests are not independent evidence."
nonScope: ["No product edit, no version bump, no repack", "No live server, no browser, no install", "No commit"]
owner:
  kind: agent
  label: TESTER
  sessionId: d900b3f7-4954-42d5-84f3-f595d19ad82d
preset: tester
role: TESTER
scope: ["a test file under a test root, with its run command", "the two builds from plugins/ used as the green and the wrong-product red"]
sessions:
  - sessionId: d900b3f7-4954-42d5-84f3-f595d19ad82d
    label: TESTER
    role: TESTER
    status: sleeping
---

Independently verify the state-feed plugin's behaviour with an executable test. The owner asked that the orchestrator's state notification name the active tasks and list the titles of open tasks; the message is delivered to a root session by this plugin. Write one test file with one run command that asserts the behaviour through the plugin's public surface: the first message and the delta both carry the open-tasks block exactly once, built from state/views/board.md; every number in the counts line is that status's own count rather than the length of the list; tasks in status open and active appear with their status; more than twelve titles collapse to '+N more'; a board with nothing open says so; the delta stays inside its byte cap; and the pre-step participant delivers the message through the step decision, never into the session inbox. Prove the test can fail by running it against the previous build, where the count was the list length and status open was not listed, and quote that red before the green on the current build.
