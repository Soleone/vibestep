## Review

- **Blocker, persistence/API safety:** `songId` is used as an unchecked filesystem path segment in every song-scoped route. For example, `listBeatmaps` joins it at `server/index.js:169-180`, and the PATCH, DELETE, and POST handlers join it at `server/index.js:225-277`. Unlike `mapId`, which is normalized at `server/index.js:242`, `songId` has no allowlist or resolved-path containment check. A request whose decoded parameter is `..` can resolve outside `public/imports`, allowing reads, directory creation, or writes/deletes relative to the repository. Validate `songId` against the generated ID format and verify resolved paths remain under `importsDir` before filesystem access.

- **High, persistence/API safety and type safety:** Beatmap saves accept any truthy `incoming.notes` value and then persist the unvalidated client object (`server/index.js:262-278`). There is no validation of note array shape, lane, finite timestamps/durations, size, title, difficulty, or version. Invalid saved JSON is subsequently treated as a typed beatmap by `normalizeBeatmap`, which unconditionally calls `beatmap.notes.map` (`src/game/model.ts:75-77`), so one malformed request or hand-edited file can make a song unloadable. The two canonical copies are also written independently with `writeFile` (`server/index.js:276-277`), with no temporary-file rename or per-song serialization, so an interruption or concurrent saves can leave `beatmaps/<id>.json` and legacy `beatmap.json` inconsistent. Add a shared runtime schema, bounds, atomic writes, and conflict/version handling.

- **High, performance:** While playback is active, `src/App.tsx:335-386` wakes every 10 ms, writes `songTimeMs` state, scans every beatmap note with `flatMap`, sorts all due notes, and may update attack state. The server permits up to 2,500 auto-generated notes (`server/index.js:143-155`), and manual maps are not capped by note count. This creates frequent whole-`App` rerenders and allocation/sorting work during the timing-sensitive play path. Use audio/time events or `requestAnimationFrame` for display updates, maintain a time-indexed note cursor/queue, and schedule only the next relevant notes.

- **High, test coverage:** There are no tracked test/spec files, and `package.json:6-13` defines build and lint scripts but no test script. The untested code includes pure timing logic (`src/game/timing.ts:18-45`), destructive persistence routes (`server/index.js:225-279`), and editor transformations such as copy/paste/move (`src/App.tsx:637-719`). Add unit tests for timing and editor transforms plus integration tests in a temporary imports directory for traversal rejection, validation, save/history/delete behavior, and interrupted-write recovery.

- **Medium, modularity:** `src/App.tsx` is a 902-line, roughly 67 KB component that owns API loading/saving, local persistence, audio transport, gamepad polling, gameplay scheduling/scoring, recording, editor mutations, and nearly all UI. The editor toolbar alone is a single dense JSX line at `src/App.tsx:866`, while the API behavior is interwoven with state transitions across `src/App.tsx:121-203` and `src/App.tsx:434-536`. This makes features hard to isolate and difficult to test. Split transport/playback scheduling, import/beatmap API client, editor state transforms, and tab views into typed modules/components before further feature work.

- **Medium, client error handling:** Several async UI actions throw or parse responses without a caller-visible error path. `saveBeatmap` throws on an unsuccessful response (`src/App.tsx:434-440`) but its button discards the promise with `void saveBeatmap(false)` (`src/App.tsx:855`); the duplicate and delete actions do the same. `loadBeatmap` parses without checking `response.ok` (`src/App.tsx:450-456`), and deletion fetches the replacement map without checking status (`src/App.tsx:472-487`). These failures become unhandled rejections or leave partial/stale UI state instead of reporting an actionable error. Centralize checked JSON requests and surface failures in `importStatus` or dedicated save/load state.

- **Note, performance:** Production build succeeds but emits one 1,309.40 kB minified JavaScript entry, 373.68 kB gzip, and Vite's chunk-size warning. `Canvas`/Three dependencies are statically imported at `src/App.tsx:2` even when using the editor/config tabs. Lazy-load the play scene or split the gameplay tab if initial editor/import load is important. README acknowledges this is acceptable for the prototype, so this is a measured residual risk rather than a blocker.

- **Note:** `npm run lint` also reports an unused `makeAnalyzedBeatmap` implementation at `server/index.js:73` and a missing `useCallback` dependency at `src/App.tsx:465`. The latter can preserve stale imported BPM/offset values when the callback is reused; resolve the lint findings or document why the dependency is intentionally omitted.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Eight concrete prioritized findings cite server/index.js, src/App.tsx, src/game/model.ts, src/game/timing.ts, and package.json locations, including severities and verified validation evidence."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "npm run build",
      "result": "passed",
      "summary": "TypeScript build and Vite production build completed; Vite reported a 1,309.40 kB minified entry warning."
    },
    {
      "command": "npm run lint",
      "result": "passed with warnings",
      "summary": "Reported three Fast Refresh warnings, unused makeAnalyzedBeatmap, and a missing useCallback dependency."
    },
    {
      "command": "git diff --check && git diff --stat && git status --short",
      "result": "passed",
      "summary": "No tracked source diff or staged files; only the required untracked .pi-subagents artifact directory is present."
    },
    {
      "command": "git ls-files | grep -E '(^|/).*(test|spec)\\.(ts|tsx|js|jsx)$'",
      "result": "passed",
      "summary": "No tracked test/spec files found."
    }
  ],
  "validationOutput": [
    "Production build completed successfully.",
    "No source tests exist to execute.",
    "Read-only audit made no project source changes."
  ],
  "residualRisks": [
    "Filesystem traversal, unvalidated/nonatomic beatmap persistence, and playback scheduling performance remain unresolved.",
    "The production entry remains 1,309.40 kB minified until gameplay code is split."
  ],
  "noStagedFiles": true,
  "diffSummary": "No tracked project files were modified; only the required audit artifact was written outside the tracked source set.",
  "reviewFindings": [
    "blocker: server/index.js:169-277 - unvalidated songId is joined into filesystem paths.",
    "high: server/index.js:262-278 and src/game/model.ts:75-77 - beatmap payloads lack runtime validation and writes are non-atomic.",
    "high: src/App.tsx:335-386 - 10 ms full-note scan/sort and state updates are in the playback hot path.",
    "high: package.json:6-13 - no test script or tracked test files cover timing, persistence, or editor transformations.",
    "medium: src/App.tsx:49-902 - one component owns most application behavior and UI.",
    "medium: src/App.tsx:434-487 and 855 - save/load/delete failures can be unhandled or silently parsed.",
    "note: production build has a 1,309.40 kB minified entry and lint reports unused/stale-dependency warnings."
  ],
  "manualNotes": "Audit was read-only. Findings are based on inspected source and the commands listed above."
}
```