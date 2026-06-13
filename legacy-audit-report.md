# FLUX Legacy API & Dead Logic Audit

## Executive Summary

This report details the findings of a comprehensive static analysis of the FLUX codebase to identify unused APIs, dead logic, and legacy artifacts. Key findings include fully orphaned frontend API wrappers (`live.js`, `profile.js`), an unused React component (`Player.jsx`), and a duplicate state management layer (`apiContext.jsx`) masking TanStack Query functionality. The backend is relatively clean with no completely orphaned controllers or routers.

## API Usage Matrix

| Endpoint               | Used | Called By                                     | Status |
| ---------------------- | ---- | --------------------------------------------- | ------ |
| `/api/library`         | Yes  | `web/src/hooks/useLibrary.js`                 | Active |
| `/api/media`           | Yes  | `web/src/hooks/useMedia.js`                   | Active |
| `/api/metadata`        | Yes  | `web/src/api/metadata.js`                     | Active |
| `/api/history`         | Yes  | `web/src/hooks/useHistory.js`                 | Active |
| `/api/categories`      | Yes  | `web/src/hooks/useCategories.js`              | Active |
| `/api/user`            | Yes  | `web/src/hooks/useUser.js`, `useWatchlist.js` | Active |
| `/api/admin-dashboard` | Yes  | `web/src/dashboard/api/dashboardApi.js`       | Active |
| `/stream`              | Yes  | `web/src/api/stream.js`                       | Active |
| `/api/live`            | No   | `web/src/api/live.js` (Dead)                  | Unused |
| `/api/profile`         | No   | `web/src/api/profile.js` (Dead)               | Unused |

## Dead Logic Findings

### `web/src/api/live.js`

- **Functionality:** Live TV API wrapper containing endpoints for channels, categories, and status.
- **Why it appears unused:** There is no corresponding `/api/live` router registered in the backend (`server.js`). A global codebase search confirms this file is never imported by any frontend component or context.
- **Confidence Level:** High

### `web/src/api/profile.js`

- **Functionality:** Profile CRUD operations and ImgBB avatar upload logic.
- **Why it appears unused:** The backend `/api/profile` endpoint was never implemented. Comments in `Settings.jsx` explicitly state `// TODO: call PATCH /api/profile when profile edit API is wired`. Avatar uploads are currently handled inline within `ProfileSection.jsx`, and this API file is completely unreferenced.
- **Confidence Level:** High

### `web/src/Pages/Player/Player.jsx`

- **Functionality:** An older, monolithic iteration of the media player UI.
- **Why it appears unused:** `Routes.jsx` maps `/player/:id` to `PlayerPage.jsx` and `/player-test` to `TestPlayerPage.jsx`. While `Player.jsx` is imported at the top of `Routes.jsx`, it is never assigned to a route array or rendered anywhere in the DOM tree.
- **Confidence Level:** High

## Duplicate Logic Findings

### `web/src/Context/apiContext.jsx` (Duplicate State Management)

- **What is duplicated:** Loading and error state mapping.
- **Details:** Following the TanStack Query migration, this context acts as a legacy compatibility bridge. It manually aggregates `isLoading` and `error` states from the TanStack hooks into a monolithic map. This recreates the exact state management problems TanStack Query solves, as mutating the context forces full application re-renders rather than isolated component updates.

### `server/utils/streamingEngine.js` (Legacy Streaming Logic)

- **What is duplicated:** Playback decision and stream info extraction.
- **Details:** The app ported core HLS streaming execution to `transcoderService.js` (which manages FFmpeg processes and the HLS daemon). However, `streamingEngine.js` is still kept alive strictly for the `decidePlayback` routing logic (choosing Direct Play vs Transcode). This splits the streaming pipeline across two distinct paradigms.

## Frontend Findings

- **Unused API Wrappers:** `api/live.js`, `api/profile.js`
- **Unused Pages/Components:** `Player.jsx`
- **Legacy Contexts:** `apiContext.jsx` (Architecturally redundant, but currently required for legacy `useApi()` consumers).

## Backend Findings

- **Controllers:** All controllers in `server/controllers/` are actively mapped to routes.
- **Utilities:** Core utilities (`scanner.js`, `metadataStore.js`, `userStore.js`) are all actively imported and utilized by the controllers. The backend has minimal dead logic.

## Risk Assessment

| Candidate                         | Assessment             | Recommendation                                                                                                        |
| :-------------------------------- | :--------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| `web/src/api/live.js`             | **Safe to remove**     | Delete file. No dependencies exist.                                                                                   |
| `web/src/api/profile.js`          | **Safe to remove**     | Delete file. No dependencies exist.                                                                                   |
| `web/src/Pages/Player/Player.jsx` | **Safe to remove**     | Delete file and remove unused import from `Routes.jsx`.                                                               |
| `web/src/Context/apiContext.jsx`  | **Do not remove**      | Required by legacy components (`MyLibrary`, `Navbar`, etc.). Needs methodical component-by-component migration first. |
| `server/utils/streamingEngine.js` | **Needs verification** | Do not remove yet. Logic is still used for media probing.                                                             |

## Cleanup Candidates

**Priority 1 (Safe & High Confidence):**

1. Delete `web/src/api/live.js`
2. Delete `web/src/api/profile.js`
3. Delete `web/src/Pages/Player/Player.jsx`
4. Remove `import Player from "../Pages/Player/Player";` from `web/src/Routes/Routes.jsx`
5. Remove exports for `live` and `profile` from `web/src/api/index.js` (if they existed).

**Priority 2 (Likely Unused / Minor Refactor):**

1. Consolidate `streamingEngine.js` logic into `transcoderService.js` to unify the streaming architecture and remove the legacy file.

**Priority 3 (Requires manual verification / Major Refactor):**

1. Systematically replace all `useApi()` calls in frontend components with direct imports of `useMedia()`, `useLibrary()`, etc., to eventually decommission `apiContext.jsx`.
