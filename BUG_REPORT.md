# Bug Report

Bugs filed from Debug Mode in Madison AI Suite.

## [x] Bug — 2026-04-02 12:44:00 (page: character, element: "1804 x 112952 x 160937 x 1351147 x 871148 x 892007 x 1132013" [Main content] (page: character))

Art table postes images in twice when i poaste

**FIXED:** All pages are mounted simultaneously (hidden via `display:none`), so multiple `ArtboardCanvas` instances each registered global `paste` event listeners on `window`. When Ctrl+V was pressed, every mounted instance's handler fired, calling `ingestImage` on the shared artboard context multiple times. Fixed by adding a visibility check (`el.offsetParent === null`) at the top of the paste, keyboard shortcut, and space-bar pan handlers so only the actually-visible ArtboardCanvas processes global events.

---

## [x] Bug — 2026-04-02 12:57:36 (page: uilab, element: Button: "Mainstage" [Main content] (page: uilab))

when i generate multiple images it doesnt show them in mainstage until i click grid or animation first - then go back to mainstage and they show up for me to click through (Im in UI mode but check all)

**FIXED:** The `ImageViewer` component wasn't properly re-rendering when `mainstageSrc` changed rapidly during batched generation. Added a `key={mainstageHistoryActiveId}` prop to force the viewer to remount with each new image (same effect as a tab switch). Also wired up `imageCount`/`imageIndex`/`onPrevImage`/`onNextImage` so users can navigate between generated images directly in the mainstage viewer.

---

## [x] Bug — 2026-04-02 13:06:32 (page: gemini, element: Button: "Default Gemini" [Menu bar] (page: gemini))

make sure images are generated cuncurrently in default gemini

**ALREADY WORKING:** Gemini page already generates concurrently — `handleGenerate` creates `batchCount` parallel `apiFetch` calls using `Promise.all`, with per-promise `.catch` so failures don't block others. Backend uses `ThreadPoolExecutor(max_workers=16)`. No change needed.

---

## [x] Bug — 2026-04-02 13:11:01 (page: gemini, element: Button: "Default Gemini" [Menu bar] (page: gemini))

Add "Clear images" button to default gemini and clears all main stage and refs

**FIXED:** Added `handleClearAllImages` callback that clears `gallery` and `imageIdx` for all tabs. Added a "Clear Images" button in the Input section alongside the existing "Reset All" button. Also wired `onClearAllImages` prop to `ImageViewer` so "Clear All Generated" appears in the right-click context menu.

---

## [x] Bug — 2026-04-02 13:11:27 (page: gemini, element: Button: "Default Gemini" [Menu bar] (page: gemini))

right cvlick clear image not working in default gemini - maybe others

**FIXED:** `onClearImage` was only passed for ref tabs (`isRefTab ? handleClearRef : undefined`), so on the main tab it was `undefined` — the context menu "Clear" item closed the menu but did nothing. Added `handleClearImage` that removes the current image from the active tab's gallery and now passes it for all tabs: `onClearImage={isRefTab ? handleClearRef : handleClearImage}`.

---

## [x] Bug — 2026-04-02 13:29:20 (page: uilab, element: Button (unlabeled) [Sidebar options] (page: uilab))

the left button for changing the number of images generated is being confused in placement with the "health bar 2x8" dropdown

**FIXED:** The grid layout dropdown (Square 4×4, Wide 4×5, etc.) and the generation count NumberStepper were crammed into the same row, causing visual confusion. Moved the grid layout dropdown to its own dedicated row labeled "Layout" beneath the View row, so the count stepper and layout selector are clearly separated.

---

## [x] Bug — 2026-04-02 16:01:00 (page: uilab, element: Button: "Default Gemini" [Menu bar] (page: uilab))

When a tool has an active API call generating - like if i click generate image in Default Gemini - there should be a small red tick to the right of the tool in the left menu - and when the image is finished it turns to green to let the user know its ready to look at - when user clicks the tab it goes away. SAME for the project tabs on the top of each tool - have each show red tick when generating something - and green when done, When user clicks the project tab it clears the tick mark.

**FIXED:** Created `GenerationStatusContext` — a shared React context that tracks per-page generation status (idle/generating/done). Each tool page (UILab, Gemini, Character, Weapon, Prop, Environment, Multiview) syncs its local `busy` state to the global context. The Sidebar renders a red pulsing dot while generating and a green dot when done (auto-clears after 30s or when user clicks the tool). `GroupedTabBar` gained a new `tabStatuses` prop for the same red/green dot behavior on project tabs.

---

## [x] Bug — 2026-04-02 16:03:50 (page: uilab, element: Button (unlabeled) [Main content] (page: uilab))

when i generate multiple images in mainstage - i need to click left arrow to see them. Instead, one should already be showing on the mainstage view once they generate.

**FIXED:** Refactored the multi-image generation to use a new `setMainstageBatch` function that collects all successful results, adds them all to history in one React update, and sets the FIRST generated image as the visible mainstage image (with its history entry active). Previously, each result called `setMainstageImage` in a loop causing React to batch and only show the last image, requiring arrow navigation.

---

## [x] Bug — 2026-04-02 16:22:48 (page: uilab, element: Button: "WebM" [Main content] (page: uilab))

Need better export options that regular windows media player can play.

**FIXED:** Added GIF export as a new option in the Animation panel. The GIF encoder is built from scratch (no external dependencies) with full GIF89a support: 256-color local palettes per frame, LZW compression, transparency, Netscape looping extension. GIF plays in Windows Media Player, all browsers, image viewers, Discord, Slack, etc. The button appears first in the export row for easy access.

---

## [x] Bug — 2026-04-02 16:24:15 (page: uilab, element: Button: "File" (page: uilab))

tried to save and it "failed to save" - large file but still it should save

**FIXED:** Two issues: (1) The Electron `session:save` handler used synchronous `fs.writeFileSync` with no try/catch — if the write failed (large file, disk full, permissions), the error was unhandled. Replaced with async `fs.promises.writeFile` wrapped in try/catch with proper error logging. (2) The renderer showed no feedback when save returned `false` (cancel or failure). Now shows an explicit error toast: "Save cancelled or failed — file may be too large".

---

