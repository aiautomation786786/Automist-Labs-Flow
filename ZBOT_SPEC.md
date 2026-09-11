# zBot — Complete Build Specification

**Purpose of this file:** hand it to any capable AI or developer and they can rebuild
zBot from scratch. It describes what the tool is, every feature it has, how each part
behaves, the exact defaults, and the hard-won rules learned from real failures. Follow
it as written — where a rule says "never", a real bug is behind it.

---

## 1. What zBot is

zBot is a **Windows desktop app** (Electron) that turns a written script — or just a
video title — into a **finished faceless YouTube video**: AI images, AI voice-over,
burned subtitles, camera motion, background music, and a final rendered MP4, exported
into per-channel folders. Everything runs **locally on the user's machine** using the
user's **own free accounts** (Meta AI, Gemini) — there are no per-video costs and no
cloud rendering.

One sentence pitch: *Type a title. Get the whole video.*

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Shell | Electron 36 (Windows primary target) |
| Bundler | electron-vite (main → ONE bundled `out/main/index.js`) |
| UI | React 19 + TypeScript, Zustand for state |
| Styling | Single `main.css`, CSS custom-property tokens, dark-first |
| Video | ffmpeg + ffprobe (bundled binaries), invoked from main process |
| Local TTS | Kokoro (onnxruntime-node, runs offline) |
| PDF import | pdf-parse (lazy-required) |
| Packaging | electron-builder → NSIS installer (`build:win` script) |

**Process layout:** `src/main` (Node, all pipeline/provider/IPC code), `src/preload`
(typed `window.api` bridge), `src/renderer` (React pages), `src/shared/types`
(everything shared: types, constants, IPC channel names).

> **Rule (learned from a crash):** the main process is bundled into a single file, so
> **runtime relative `require()` calls fail** in production. Every import must be a
> static ES import. A `require('../ipc/settings.ipc')` at runtime killed image
> generation entirely once.

---

## 3. Core concepts

- **Project** — one video run. Lives in `userData/projects/<uuid>/` with
  `project.json` (config, stage progress, assets map), `story.json` (title, scenes),
  and subfolders `images/ audio/ clips/ subtitles/ exports/`.
- **Scene** — `{ sceneNumber, narration, imagePrompt, mood, durationSeconds }`.
  **The scene count always comes from the image-prompt count.** Durations start as
  word-count estimates and are **overwritten with the measured length of the
  synthesized audio** (ffprobe) once voice exists.
- **JobMode** — `video | images | audio`. Images/audio modes run a shortened pipeline
  (generate assets → export straight to a user-chosen folder; no clips/render).
- **Channel** — `{ id, name, skillId?, shortsOutputDir?, longsOutputDir? }`. Stored via
  its own IPC (`channel:list/save/update/delete`). A finished video auto-exports into
  the channel's Shorts or Longs folder based on orientation.
- **Skill** — a locked "channel rulebook" text (markdown) stored in
  `userData/skills/<id>.md`. Given a skill + a title, Script AI writes the complete
  video package.

---

## 4. UI — pages and design system

Top navbar (not a sidebar): **Create Video · Generation · Projects · History ·
Settings**, plus logo left and version chip right.

### Design system (exact values)
- Dark warm palette: bg `#1a1917`, card `#2b2a28`, accent `#c96442`, accent-hover
  `#e8916b`, borders `rgba(226,220,208,0.14)`. Light theme via
  `:root[data-theme='light']` token overrides.
- **Selected state pattern (used everywhere):**
  `background: color-mix(in srgb, var(--color-accent) ~20%, var(--color-bg-card))`,
  border `color-mix(accent 60%, transparent)`, **no glow/box-shadow**. On a dark UI a
  selected item must read *lighter* than its surroundings, never darker.
- Radius tokens: 8px controls, 12px cards. **No pill shapes.**
- Tab rows (navbar, TTS engine bar, mode cards) are CSS grids with
  `grid-auto-columns: minmax(0,1fr)` → **equal-width tabs**; every tab has the same
  border-box whether active or not; emoji icons in fixed 18px centred boxes so
  baselines align. Live badges (e.g. "LIVE 32%") are `position:absolute` so they
  can't resize the row.
- > **Rule:** never style with `rgba(255,255,255,…)` literals or hardcoded hues in
  > JSX inline styles — they break light mode and drift from the theme. Tokens only.
- > **Rule (layout):** any bounded flex column that scrolls must set
  > `> * { flex-shrink: 0 }` — otherwise flexbox crushes children before scrolling
  > and panels overlap. Footers in scrolling panels are static, not sticky.

### Create Video page
Four mode cards: **Full Video** (script in → video out), **From Skill** (title in →
AI writes everything), **Images Only**, **Audio Only**. Full Video opens a 5-step
wizard: **1 Script → 2 Format → 3 Subtitles → 4 Motion → 5 Voice**.

- Step 1 accepts: one file (.md/.txt/.json) · separate files (narration + prompts +
  optional thumbnail) · pasted text. After load it previews every scene and offers
  **"✨ Wrong count? Re-read with AI"** (see §8.4).
- Step 4 has a master **Motion on/off switch** (same pattern as Subtitles switch) —
  motion OFF means still frames + hard cuts (right for flat/whiteboard artwork).
- Pressing Generate asks which **channel** the video belongs to: existing channels are
  one-click chips, plus a text field for a new name, plus a save-as-default checkbox.
  (Free-text-only here stranded videos in "Unsorted" — don't repeat that.)

### Generation page
Overall % + per-stage chips (done ✓ / running ● / failed ✕ with **Retry Failed**),
counters (images n/n, voice n/n, elapsed), CPU/RAM/ping row, **Pause / Stop /
Project-folder** buttons, Auto-Render toggle, and a card per scene (image preview,
narration, prompt, Change Image, Edit Details, Regenerate Audio, per-scene chat
links for the browser providers).

- **Auto-retry:** on pipeline error, schedule retries with backoff, max 60 attempts,
  and **give up early if the identical error repeats** (~3×). Counter must persist
  across the retry (a `fromAutoRetry` flag — a manual Retry resets it, an automatic
  one must NOT, and `onClick={handleRetry}` must be wrapped because React's event
  object is truthy).
- > **Rule (Stop must stop):** user Stop cancels the pipeline, and the cancellation
  > itself emits a pipeline-error event. That event **must not re-arm auto-retry** —
  > guard with a `userCancelledRef` + skip errors matching /cancel/i. Without this,
  > Stop appears broken because the run restarts itself.

### Projects page
Channel grid (avatar, name, video counts, Open/edit/delete) + "New Channel" card
(name, skill picker with paste/upload, Shorts/Longs export folders) + an **Unsorted**
card for channel-less videos. Channel detail view: Short/Long tabs, sort, bulk
select, per-row actions (Regenerate / Open Folder / Export / Delete) via a shared
`ProjectRow` component. Unsorted rows additionally get a **"Move to…"** channel
dropdown. Channel rename migrates its projects' `channelName` (compare
case-insensitively). Non-video modes are excluded from the channel grid (they live
in History).

### History page
Flat list of every run, newest first, tabs All/Videos/Images/Audio with counts,
search, and the same `ProjectRow` actions.

### Performance rule (tab switching)
**All pages stay mounted**; switching tabs only toggles `display`. Pages that list
data refresh quietly on a `page-shown` event (no spinner if data already exists).
Mount-per-switch caused visible loading on every tab change. Voice lists are also
cached per engine in the renderer (module-level Map) — refetch only via Refresh.

---

## 5. Pipeline (orchestrator)

Stage order for video mode:
`story → images ∥ voice ∥ thumbnail → clips → review → subtitles → rendering → export`
(images/voice/thumbnail run in parallel via `Promise.all`). Images/audio job modes
short-circuit: generate the one asset type, then export to the user's chosen folder.

Key behaviors (each is a fix for a real failure):

- **Cancellation:** a single `isCancelled` flag checked at every loop boundary; the
  browser providers keep their own static `isCancelled` and the orchestrator adopts
  it (`MetaAIProvider.isCancelled || GeminiProvider.isCancelled → this.isCancelled`).
  The provider flag must be **read inside every retry loop** — setting it while loops
  reopen browser tabs looks like Stop doing nothing.
- **Image fill-in:** an image that fails all retries on both providers is **copied
  from the nearest neighbouring scene** rather than failing the run.
- **Thumbnail:** skipped cleanly when the script has no thumbnail prompt; otherwise
  preferred provider then the other, 3 attempts each, **non-fatal** if both fail
  (log it loudly — never silently green).
- **Clip render:** per-attempt temp files; attempt 3 falls back to
  `{ animationStyle:'none', transitionStyle:'hard-cut' }` with an 8-minute watchdog.
- **Clip cache:** clips carry a `clipMotionKey`
  (`on|<animationStyle>|<transitionStyle>` or `off`) plus a `CLIP_RENDER_VERSION`
  int; changing motion settings or the renderer **must invalidate cached clips** —
  bump the version when render logic changes.
- **Voice resolution:** `resolveVoiceCharacter(id, engine)` returns a synthetic
  character for unknown remote ids, and for an **empty id returns a "Default
  narrator"** (edge `en-US-ChristopherNeural` / kokoro `am_eric`) instead of
  `undefined`. An unpicked voice must cost the run its preferred voice, **never the
  run** (this exact crash shipped once: engine selected, voice list rate-limited,
  empty voice → whole run died after images).
- Stage failures are retried by the UI's auto-retry; **completed work is always kept**
  — Retry continues from the failed stage, never from scratch.

---

## 6. Image providers (browser automation)

Both drive the real web apps in Electron `WebContentsView`s using the user's own
logged-in sessions (persistent partitions `persist:metaai`, `persist:gemini`).

- **Meta AI** (primary) and **Google Gemini** (fallback/choice). Prompt → wait for
  composer → send → wait for image → download via the page.
- **Parallelism:** up to `imageConcurrency` tabs (default **20**; RAM ladder: <8GB→4,
  <16GB→10; user max 30). Both providers must respect the same setting.
- Views call `view.setBackgroundColor('#1a1917')` — a WebContentsView paints **white**
  until its page renders, and it composites **above all HTML** (no z-index can cover
  it), so an unpainted view looks like a hole in the UI.
- Send-button matching must be strict — a loose `label.includes('up')` once matched
  "Sign up". Distinguish *signed-out* from *slow-loading* when waiting for the
  composer, and validate downloaded bytes (non-empty, http status).
- Every send/wait/download loop checks the provider's `isCancelled` static
  (`throwIfCancelled(where)`), ~15 checkpoints per provider.

> These providers WILL break when Meta/Google change their UI. Design for it: the
> other provider is always the fallback, and fixes ship via updates.

## 7. Voice engines

`TtsProvider = 'edge-tts' | 'kokoro' | 'azure' | 'ai33' | 'famespeak'`, registered in
a `TTS_ENGINES` metadata array (name, badge LOCAL/FREE/API KEY, audio extension).

| Engine | Nature | Notes |
|---|---|---|
| Kokoro | local onnx, wav | no key, offline |
| Edge TTS | free, mp3 | returns **word timings** → exact subtitles |
| Azure Speech | key+region | REST, HD voices, remote voice list |
| ai33.pro | key | async: POST task (multipart) → poll `/v1/task/:id` → download `metadata.audio_url`; SRT transcript → cue timings; voice library split by upstream provider (elevenlabs/minimax/fishaudio/edge/kokoro/vbee/**clone**) |
| FameSpeak | bearer key | async REST: `POST /api/v1/tts/generations` `{text, voice}` + `Idempotency-Key` → 202 `{id,status}` → poll `GET .../generations/:id` (status `completed`, failures in `failureMessage`) → `GET .../:id/audio` (mp3). Voices: `GET /api/v1/voices?page=N&limit=200` → `{items,totalPages}`, fields `id, displayName, locale, gender, tier(free/premium), audioUrl` |

**TtsSwitcher rules:**
- `withFallback`: chosen engine → one immediate retry → Kokoro → Edge. A video never
  ships silent; API failures (bad key, quota) downgrade the voice, not the run.
- Voice previews do NOT fall back across engines (a preview in another engine's voice
  is a lie).
- Mood shapes delivery where the engine allows (speed for ai33 within 0.5–1.5;
  SSML-ish controls for edge/azure). Engines with no documented controls (FameSpeak)
  get **only documented fields** — unknown fields on strict APIs fail every request.
- **FameSpeak voice list caching (mandatory):** its API rate-limits tiny bursts — the
  6-page voice walk itself can trip it. Cache the full list **in memory AND on disk**
  (`userData/famespeak-voices.json`, ~7-day TTL, keyed by key-tail), pace pages
  ~700ms apart, retry 429 mid-walk with backoff, and **serve the stale disk cache when
  the walk fails**. `await` the cache write (a fire-and-forget write raced app quit
  and produced a 0-byte file).

## 8. Script import (no AI, deterministic — the user's words pass through untouched)

### 8.1 Accepted layouts
1. **Marked single file** — `## SCENE 3` style markers (SCENE/SHOT/PART/SECTION), with
   `NARRATION:` / `IMAGE:` / `MOOD:` / `TITLE:` / `THUMBNAIL:` labels (many aliases;
   markdown bold around labels tolerated). Bare numbered headings only if no word
   markers exist.
2. **Asset-block prompt files** — headers `ASSET|IMG|IMAGE|PROMPT|VISUAL|PIC|PICTURE|
   SCENE|SHOT|PANEL + number`, optional slug (≤40 chars) or inline prompt on the
   header line. Rules (`----`/`====`) are decoration. A header remainder starting
   with `|` or `,` is a **metadata row** (timings, "character", "bg …") — never part
   of the prompt. A trailing `BONUS/APPENDIX/THUMBNAIL` section belongs to **no
   scene**.
3. **Sectioned AI packages** — `=== 1. TITLES === … === 5. IMAGE PROMPTS ===` etc.;
   scene lists as `001 | 0-6 | IMG 001 | first words…` rows. Bookkeeping cells =
   `mm:ss(-mm:ss)`, plain second-ranges `12-19`, `IMG n`, and `reuse IMG n`.
   The thumbnail section is looked up separately from the titles section (first-match
   once hid it).
4. **Separate files** — narration (+optional prompts, +optional thumbnail), matched
   by position; count mismatch is a warning listing both counts, extra prompts become
   scenes.
5. **JSON** — the app's own story.json or plain `{title, scenes[]}`.

### 8.2 Narration distribution (when narration isn't pre-split per scene)
Split into sentences; if sentences ≥ scenes, **merge the smallest adjacent pairs**
until counts match (that's what a writer does by hand — even boundaries degenerate).
If sentences < scenes, split by **even word counts** (equal scene durations). A
comma-based splitter was tried and **reverted by the owner**: pause-based cuts make
wildly uneven chunks (a 2-word scene = a 1-second image flash). Keep even word
counts.

### 8.3 Validation
Mode-aware: video needs narration+prompt per scene; images mode needs prompts only;
audio mode narration only. Skipped asset numbers (151 prompts numbered to 182) are a
**warning explaining reuse**, not an error.

### 8.4 AI Re-read (fallback for unknown layouts)
One-click, never automatic. Send the model a **numbered skeleton** (each line
truncated to ~90 chars, cap 4000 lines) and ask for **line-number ranges** per scene
(JSON: `{scenes:[{n,prompt:[a,b],narration:[c,d]}],thumbnail:[e,f]}`, temperature 0).
Slice the ORIGINAL file locally. **The model never returns text** — asked for text it
paraphrases, drops hex codes, truncates; line numbers can't be rephrased. Reject
out-of-range/imagined ranges; on any doubt return null and keep the deterministic
result.

## 9. Script AI (skills → full package)

- Endpoint: Gemini via its **OpenAI-compatible** chat-completions URL
  (`https://generativelanguage.googleapis.com/v1beta/openai`), SSE streaming.
  Default model **`gemini-flash-latest`** — an alias on purpose: pinned ids get
  retired (`gemini-2.5-flash-lite` died mid-life with 404 "no longer available") and
  a pinned default silently breaks everything.
- **Key pool:** `scriptAiKeys` = one key per line (+ single `scriptAiKey`). Rotate on
  quota (429/RESOURCE_EXHAUSTED) mid-conversation — the transcript lives client-side
  so the model never notices the handover. Honour Google's `retryDelay` on 429; short
  waits for 5xx; ≥15s between request starts (free tier = 5 req/min).
- **Batching:** skills end batches with markers like `SAY CONTINUE` / `BATCH n
  COMPLETE` → send "CONTINUE". Hard cap ~40 rounds.
- **Truncation resume (critical):** a reply that hits the output-token limit ends
  mid-sentence with NO marker. Detect it (tail lacks terminal punctuation, or the
  package has no image-prompt section / <3 numbered blocks) and push *"Your output
  was cut off. CONTINUE from exactly where you stopped — do not repeat anything"*, up
  to ~10 nudges. Without this, a 10KB fragment gets saved as a "finished" package and
  import fails with "Scene 1 has no image prompt".
- Retired-model 404s: retry once on the default alias and **memoize** the dead id for
  the session.
- Generated packages are written to `userData/generated-scripts/<title>.md`, then fed
  through the **same importer** as user files.
- Progress streams to the UI (round, chars, tail) and generation is cancellable.

### Skills UI
`Create Video → From Skill`: skill dropdown + **Paste skill** + **Upload** accepting
`.md/.txt/.pdf` **and `.skill`/`.zip`** (a .skill is a ZIP holding `SKILL.md` — walk
the ZIP central directory with zlib `inflateRawSync`, prefer SKILL.md, else the
largest text entry; no zip dependency needed). Name from frontmatter or filename.

## 10. Rendering (ffmpeg)

- **Per-scene clips:** still image + `zoompan` camera motion, duration = measured
  audio length. ~20 motion styles in three tiers (ULTRA: crash-zoom, bullet-time,
  ken-burns, zoom in/out…; PRO: pans, parallax, cinematic dolly, drift, **breathe**;
  AUTO mixes; plus **AI Director** = per-scene by mood).
- **Defaults (owner-chosen, subtle):** motion ON with **`breathe`** (Organic Breathe)
  and transition **`hard-cut`**. Note: `dark-fade` transition tints frame edges — it
  reads as an unwanted vignette on bright artwork (measured: source corners were
  *brighter* than centre; the fade caused it).
- **Subtitles:** built from engine word timings when available (edge/ai33), else
  estimated; burned via libass with style presets (bottom bar, neon, glass…);
  master on/off switch.
- **Audio:** background music mixed under narration at user volume; master
  `loudnorm=I=-14:TP=-1.5:LRA=11` (YouTube standard); verify with `ebur128` when
  debugging.
- **Concat** clips → final MP4. Shorts (9:16, short duration) re-render scene 1 with
  a 2-second thumbnail overlay.
- **Export:** video + thumbnail + (audio) into the channel's Shorts/Longs dir;
  History can re-export anywhere.

## 11. Settings & storage

- `userData/settings.json`. **Secrets pattern:** every secret has a `<name>` /
  `<name>Enc` pair — encrypt with Electron `safeStorage` on save (delete the plain
  field), decrypt on load in memory only. Never return `*Enc` fields to the
  renderer.
- **Write safety:** a single async **write lock**, unique temp filenames per write,
  rename-into-place, and a strict `loadSettingsForWrite()` that **throws** instead of
  returning defaults (per-keystroke saves sharing one `.tmp` once wiped the whole
  settings file, losing every key). Prefer save-on-blur over per-keystroke.
- Login checks (Meta/Gemini) probe the **live session** (load a page in the
  partition), not cookie counts — counting cookies said "connected" while the
  browser was signed out.
- **Profile migration:** on rename, carry over old userData dirs (list previous app
  names) INCLUDING **`Local State`** — on Windows it holds the safeStorage master
  key; without it every encrypted secret becomes undecryptable.
- Settings page sections: Accounts (Meta/Gemini login + Test), Images (provider,
  Parallel generations 1–30), Script AI (Gemini keys textarea + file import + Test),
  Voice engines (Azure key+region, ai33 key, FameSpeak key, each with Test),
  Audio (music dir, loudness), General (theme, version).
- App identity: `setAppUserModelId` must equal electron-builder `appId`, or Windows
  won't match the taskbar icon to the shortcut.

## 12. IPC surface (shape, not exhaustive)

All via typed `window.api.*` in preload; channel names in one shared
`IPC_CHANNELS` map. Groups: settings get/set + login/test; script pick/parse
(single/multi/text/single-purpose/**analyze-ai**); skills list/save/delete/import +
**SCRIPT_AI_GENERATE** (streams progress events); channels CRUD; projects
list/delete/export/open-folder/reset-to-review/update-config; pipeline
start/cancel/pause/resume/retry/regenerate-image/regenerate-audio + progress/
complete/error events; TTS list-voices/test-key/preview; music list.

## 13. Defaults summary

| Setting | Default |
|---|---|
| Motion | ON, `breathe`, transition `hard-cut` |
| Image provider | Meta AI (Gemini fallback) |
| imageConcurrency | 20 (RAM ladder 4/10/20, max 30) |
| Script AI model | `gemini-flash-latest` |
| TTS | edge-tts, no key needed |
| Loudness | −14 LUFS / −1.5 dBTP / LRA 11 |
| Auto-retry | max 60, identical-error stop ~3 |

## 14. Golden rules (each paid for with a real bug)

1. Static imports only in the bundled main process.
2. The scene count comes from the prompts; measured audio overwrites estimated
   durations.
3. An AI may FIND structure (line numbers) but never REWRITE user prompts.
4. A missing voice/key/quota downgrades the voice — it never kills the run.
5. Stop must defeat auto-retry (cancellation errors don't re-arm it).
6. Cache remote voice lists on disk; pace paginated walks; serve stale on failure.
7. Detect truncated model replies and ask the model to continue — silence ≠ done.
8. Settings writes: lock + unique temps + strict reads; blur-save, not keystroke-save.
9. Carry `Local State` across profile renames or lose every secret.
10. WebContentsViews paint above HTML and start white — set their background color.
11. Selected UI state = lighter tint on card surface, equal-size tabs, no glows,
    no hardcoded colors outside the token system.
12. Bounded flex columns that scroll need `> * { flex-shrink: 0 }`.
13. Everything the pipeline makes is kept; Retry resumes, never restarts.
14. Never build the installer unprompted (owner's standing instruction) — dev
    bundles freely, `.exe` only on explicit request.

---
*Spec derived from zBot v5.8.1 source, September 2026. Owner: Zakariya.*
