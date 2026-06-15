# Subtitle System File Discovery Audit

## 1. Backend Files

| File | Purpose | Why Change Needed |
| ---- | ------- | ----------------- |
| `server/utils/fileHelpers.js` | Defines supported file extensions (`SUBTITLE_EXTENSIONS`). | Needs updated logic/regex to identify language tags in filenames (e.g., `Movie.en.srt`, `Movie.bn.ass`). |
| `server/controllers/mediaController.js` | API logic for media metadata (`getMediaSubtitles`). | Currently only matches exact base names. Must be modified to find language-suffixed files, extract embedded tracks from `ffprobe` data, and handle OpenSubtitles search/upload. |
| `server/controllers/streamController.js` | Subtitle streaming and on-the-fly conversion (`streamSubtitle`). | Must be modified to support extracting embedded MKV/MP4 tracks on-the-fly via FFmpeg (`-map 0:s:0 -f webvtt pipe:1`) and converting `.ass`/`.ssa`. |
| `server/utils/transcoderService.js` | Manages FFmpeg lifecycle and HLS encoding arguments. | Currently hardcodes `-sn` (strip subtitles). Must be modified to accept subtitle track selection and apply subtitle burn-in (`-vf subtitles=...`) or HLS embedded subtitles (`-scodec webvtt`). |
| `server/utils/streamingEngine.js` | Playback decision engine and FFprobe parsing. | Needs to pass the selected subtitle track index to the transcoder and decide if burn-in is required based on client capabilities. |
| `server/routes/media.js` | Express router for media endpoints. | Requires new routes: `POST /api/media/:id/subtitle/upload` and `GET /api/media/:id/subtitle/search`. |

---

## 2. Frontend Files

| File | Purpose | Why Change Needed |
| ---- | ------- | ----------------- |
| `web/src/Pages/Player/PlayerPage.jsx` | Container managing media data, session, and player state. | Needs to fetch the unified subtitle list (embedded + external) and manage OpenSubtitles API calls and upload handlers. |
| `web/src/Pages/Player/VideoCore.jsx` | Core `<video>` element and HLS.js logic. | Needs dynamic `<track>` injection for embedded/external VTT streams and logic to toggle tracks without full transcode restarts if supported. |
| `web/src/Pages/Player/PlayerControls.jsx` | UI overlay, menus, and subtitle settings (`SubtitlePicker`). | Must be extended to categorize tracks (Embedded, External, Online), show language tags, and include an "Upload" button/dropzone. |
| `web/src/api/media.js` | API integration layer for media requests. | Needs new wrapper functions for the backend subtitle upload and search endpoints. |

---

## 3. Android Files

| File | Purpose | Why Change Needed |
| ---- | ------- | ----------------- |
| N/A | No Android or React Native client files were found in the `e:\Projects\Player` repository. | If an Android client exists in a separate repository, it will require integration with ExoPlayer/VLC track selection APIs to consume the unified backend subtitle API. |

---

## 4. Existing Subtitle Support

The codebase already contains a foundation for subtitle support:
* **FFprobe Extraction:** `extractMediaInfo` in `server/utils/streamingEngine.js` successfully parses `subtitleStreams`, capturing the `index`, `codec`, `language`, and `forced` properties of embedded tracks.
* **External File Detection:** `getMediaSubtitles` in `server/controllers/mediaController.js` scans the media directory and successfully discovers `.srt` and `.vtt` files that exactly match the video's base filename.
* **On-the-Fly Conversion:** `streamSubtitle` in `server/controllers/streamController.js` automatically converts `.srt` files to `.vtt` format during playback.
* **Frontend Player UI:** `web/src/Pages/Player/PlayerControls.jsx` includes a `SubtitlePicker` menu and a `SubtitleSettings` panel allowing the user to configure font size and sync delay.

---

## 5. Missing Infrastructure

The following systems and components must be built to achieve full subtitle support:

* **Embedded Subtitles:** 
  * Backend FFmpeg pipeline to extract a specific internal track index and pipe it directly to the client as a VTT stream.
  * Transcoder argument logic to handle subtitle burn-in (`-vf subtitles=...`) for clients that do not support external text tracks.
* **External Subtitles:** 
  * Advanced regex scanning to map complex naming conventions (e.g., `Movie (2024).en-US.forced.srt`) to clean language labels.
  * Conversion infrastructure for `.ass` and `.ssa` files (which lose styling when converted to standard VTT).
* **Online Subtitles:** 
  * A dedicated service integration with the OpenSubtitles REST API.
  * A backend caching layer to download, format, and store requested online subtitles alongside the local media file.
* **Uploaded Subtitles:** 
  * A `POST` endpoint with `multer` (or equivalent) for multipart form data.
  * A secure file handler to save uploaded subtitles to the correct media directory.
  * Frontend file picker integration inside the video player controls.

---

## 6. Recommended Modification Order

To safely implement the subtitle system, changes should follow this dependency-aware order:

1. **Backend Discovery (Low Risk):** Update `fileHelpers.js` and `mediaController.js` to parse language suffixes and expose existing embedded tracks from the `ffprobe` cache.
2. **Backend Extraction Pipeline (Medium Risk):** Modify `streamController.js` to support extracting embedded MKV/MP4 tracks to VTT on-the-fly.
3. **Frontend Unified UI (Medium Risk):** Update `PlayerPage.jsx` and `PlayerControls.jsx` to render the newly exposed embedded and external tracks in the menu.
4. **Video Core Integration (High Risk):** Update `VideoCore.jsx` to dynamically load and switch the `<track>` elements based on user selection.
5. **Transcoder Burn-in Support (High Risk):** Modify `transcoderService.js` to support hardware-accelerated subtitle burn-in for incompatible clients.
6. **User Uploads (Low Risk):** Add the upload endpoint, file handling logic, and frontend file picker.
7. **Online Search (Low Risk):** Implement the OpenSubtitles integration layer and search UI.

---

## 7. Risk Assessment

| File | Risk Level | Reasoning |
| ---- | ---------- | --------- |
| `server/utils/transcoderService.js` | **High Risk** | Modifying core FFmpeg arguments (like replacing `-sn` with complex filter graphs) can cause muxer crashes, out-of-sync audio, or completely break video playback across all devices. |
| `web/src/Pages/Player/VideoCore.jsx` | **High Risk** | Video playback is the most critical feature. Dynamically injecting tracks, managing HLS.js instances, and handling subtitle sync can cause playback stutter or crashes on older browsers. |
| `server/controllers/streamController.js` | **Medium Risk** | Adding on-the-fly track extraction requires careful FFmpeg subprocess piping and error handling to prevent memory leaks or zombie processes when clients disconnect. |
| `web/src/Pages/Player/PlayerPage.jsx` | **Medium Risk** | Introducing complex state management for multiple subtitle sources requires careful `useEffect` synchronization to prevent race conditions during media load. |
| `server/controllers/mediaController.js` | **Low Risk** | Modifying directory scanning and metadata payloads is isolated and unlikely to break streaming logic. |
| `web/src/Pages/Player/PlayerControls.jsx` | **Low Risk** | Adding UI buttons for upload/search is purely visual and does not interact with the underlying video decoding pipeline. |
