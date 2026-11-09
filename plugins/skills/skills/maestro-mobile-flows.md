# Mobile flows with Maestro

Maestro drives a real phone or emulator from YAML. It reads the view hierarchy,
taps by id or visible text, and retries until the element appears, which removes
most of the sleep-and-pray code that makes mobile tests expensive. For an MVP it
covers launch, sign-in, navigation, input and screenshots without an Appium
server.

It does not remove the hard part: knowing what is on screen and which selector
will survive a redesign. This is the device layer; `ui-testing` is the browser.

## First, prove the target is a phone

Before blaming the flow, check the device:

```bash
adb devices -l
adb shell getprop ro.build.version.sdk   # must print a number
adb shell pm list packages              # must print packages
```

An `adb` target that answers `echo` but has no `/system/bin`, no `pm` and no
`getprop` is not an Android runtime with a UI to drive. Maestro will time out on
the first command; that is the device, not the flow.

Maestro 2.x needs **Java 17 or newer**. The launcher fails with
`ERROR: Java 17 or higher is required` before it looks at a flow.

## Install and verify

macOS, Linux and WSL2:

```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
export PATH="$PATH:$HOME/.maestro/bin"
maestro --version
maestro --help
```

Windows (PowerShell) is supported natively — no bash and no WSL needed. Download
`maestro.zip` from the latest GitHub release and extract it to your home folder;
the archive already contains a top-level `maestro` directory, so this leaves
`%USERPROFILE%\maestro\bin` in place. Add that `bin` folder to the **user** PATH:

```powershell
Expand-Archive "$HOME\Downloads\maestro.zip" -DestinationPath "$HOME" -Force
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
[Environment]::SetEnvironmentVariable("Path", "$userPath;$HOME\maestro\bin", "User")
# open a NEW terminal, then:
maestro --version
```

`maestro.bat` is the launcher Windows uses. Do not use `setx PATH "%PATH%;..."`:
it copies system entries into the user PATH and truncates past 1024 characters.
On Unix the installer appends the PATH line to `~/.bashrc`/`~/.zshrc`; open a new
shell either way. For iOS the host also needs a usable Xcode simulator (macOS).

## A flow

```yaml
appId: com.example.jazz
tags:
  - smoke
---
- launchApp:
    clearState: true
- assertVisible: "My charts"
- tapOn:
    id: "new-chart"
- inputText: "Autumn Leaves"
- tapOn:
    text: "Create"
- assertVisible:
    text: "Autumn Leaves"
- takeScreenshot: artifacts/chart-created
```

Run it:

```bash
maestro test .maestro/create-chart.yaml
maestro test .maestro/                 # every flow in the directory
maestro test --udid emulator-5554 .maestro/create-chart.yaml
maestro hierarchy                      # dump the current screen to choose selectors
```

`maestro studio` is the interactive inspector; `maestro hierarchy` is the
scriptable one and often the faster way to find the resource id you are missing.

## Selectors that survive

- Prefer `id:` (Android `resource-id`, iOS accessibility identifier). Ask the app
  team to set stable ids on every control a flow touches; a text selector breaks
  on translation and on a copy edit.
- Use text for assertions about what the user sees, not for finding controls when
  an id exists.
- `index` and coordinates are last resorts: they encode today's layout.
- Assert the state after every mutation, not only at the end. A flow that ends
  green after doing nothing is the mobile version of a test that cannot fail.

## Determinism

- Start each flow with `launchApp: { clearState: true }` unless the flow is
  explicitly about a returning user; then write a second flow for that path.
- Seed the backend or stub it. A flow that depends on a developer's account data
  rots by Friday.
- Let Maestro wait: `assertVisible` retries. Do not add `sleep`.
- `waitForAnimationToEnd` after a navigation that animates a list into place.
- Put the shared launch and sign-in in a `runFlow:` subflow so a UI change is one
  edit, not twenty.

## In CI

- Android: boot an emulator (KVM if available), wait for `adb wait-for-device`,
  then `maestro test`. Install the app under test first; Maestro launches by
  `appId`, it does not build.
- Keep Java 17+ on the runner and cache Maestro's home between runs: `$HOME/.maestro`
  on macOS/Linux, `%USERPROFILE%\.maestro` on Windows.
- Publish the artifacts Maestro writes under that home's `tests/` directory
  (screenshots and the HTML report) when a flow fails. A YAML diff alone will not
  explain it.
- Tag the smoke flow (`tags: [smoke]` in its header) and run it by directory:
  `maestro test --include-tags smoke .maestro/`. The filter only applies to a
  directory scan; passing one flow file path runs it even when its tags do not
  match (verified: `--include-tags nightly smoke.yaml` still ran the flow).

## What this skill does not cover

Gestures on a canvas (pinch, drag on a custom view), performance, and iOS
permissions. Those need `adb`-level or platform tests; Maestro sees the
accessibility tree, not the pixels.

## Report

- device or emulator id and Android/iOS version;
- the flow file and the command;
- pass/fail per flow, with the failing step and its screenshot path;
- what was stubbed or seeded, and what was left real.

## Sources

Maestro [documentation](https://docs.maestro.dev/), the
[install script](https://get.maestro.mobile.dev), the
[Windows install guide](https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli),
and [Mobile Dev's flow reference](https://docs.maestro.dev/api-reference/commands).
Verified in this deployment: installer completes and Maestro 2.12.1 starts under
a locally extracted OpenJDK 17. The attached `adb` target is an appliance shell,
not Android: the CLI's own device probe fails at `pm list packages`, so the flow
run was blocked by the target — recorded rather than hidden.
