# FLUX Data Fetching & Broken CRUD Report

## 1. Data Fetching Architecture

The FLUX frontend application has undergone a migration from direct context-based polling to TanStack Query for remote data fetching. 

### How Data is Fetched
1. **API Clients (`web/src/api/*.js`)**: The fundamental HTTP requests are still defined in the legacy API wrapper files (e.g., `media.js`, `library.js`, `user.js`). These wrappers utilize a common `api.get`, `api.post` interface powered by `fetch`.
2. **TanStack Hooks (`web/src/hooks/*.js`)**: The application wraps these legacy API clients inside TanStack Query hooks (`useQuery`, `useMutation`). This provides modern features like request deduplication, cache invalidation, and background refetching. 
    - For example, `useLibrary.js` exports `useAddFolder()` which calls `useMutation({ mutationFn: addFolder })`.
3. **Legacy Bridge (`apiContext.jsx`)**: To maintain compatibility with older React components that haven't been fully migrated, `apiContext.jsx` imports the TanStack hooks, triggers them, and maps their `isLoading` / `error` states into monolithic maps (`loadingMap`, `errorMap`) that can be consumed by older components using `const { useApi } = useApiContext()`.

All active CRUD operations (creating folders, updating watchlists, syncing playback progress) successfully utilize TanStack Query.

---

## 2. Broken CRUD Operations

While the core functionality of the media player is intact, static analysis reveals two critical areas where frontend API wrappers attempt CRUD operations against non-existent backend endpoints.

### A. Profile Management (`web/src/api/profile.js`)
**Status: Completely Broken (404)**

**Root Cause:** The backend Express server does not register any router for `/api/profile`.

**Failing Operations:**
- `GET /api/profile` (Get all profiles)
- `POST /api/profile` (Create new profile)
- `PATCH /api/profile/:id` (Update profile name, avatar, age restrictions)
- `DELETE /api/profile/:id` (Remove profile)

**Impact:** The `ProfileSwitcher.jsx` and `ProfileSection.jsx` components contain UI logic for modifying user profiles, but any attempt to execute these mutations will result in network errors. The feature was seemingly abandoned mid-implementation, evidenced by comments in `Settings.jsx` (`// TODO: call PATCH /api/profile when profile edit API is wired`).

### B. Live TV (`web/src/api/live.js`)
**Status: Completely Broken (404)**

**Root Cause:** The backend Express server does not register any router for `/api/live`.

**Failing Operations:**
- `GET /api/live/channels` (List all IPTV channels)
- `GET /api/live/categories` (List IPTV categories)
- `POST /api/live/refresh` (Trigger background IPTV synchronization)

**Impact:** The Live TV functionality appears to be a stub or deprecated feature. The `live.js` API client is fully orphaned and unimported by any frontend component, meaning users cannot actively trigger these failing requests in the current UI state.
