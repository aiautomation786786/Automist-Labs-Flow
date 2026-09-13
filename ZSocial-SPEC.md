# ZSocial — Build Specification

A complete specification for rebuilding this application from scratch.

Hand this file to any capable AI coding tool. It describes **what** to build, **how** the
pieces fit together, and — most importantly — **the non-obvious problems that will be hit
along the way**. The last section is worth more than the rest: every item in it is a bug
that shipped and had to be diagnosed from real failures.

---

## 1. What the product is

A **Windows desktop application** that automates reposting short-form video to YouTube.

It downloads a video from TikTok, Instagram, YouTube, a watched folder on the PC, or a
Google Drive folder; optionally rewrites and re-voices it with AI; renders it at up to 2K;
and uploads it to one or more YouTube channels on a daily schedule — unattended.

**Design constraints that shaped everything:**

- Runs entirely on the user's own PC. No server, no backend, no accounts.
- Must work with **no GPU**.
- Must handle **many channels** (tens to hundreds), each independently configured.
- Must survive being left alone for months — expiring tokens, expiring cookies, missed
  schedule slots, and a machine that reboots.

---

## 2. Architecture

Three processes:

```
┌──────────────────────────────────────────────────────────────┐
│ Electron main  (Node/TypeScript)                             │
│   · window, tray, auto-start, file pickers, clipboard        │
│   · spawns and supervises the Python worker                  │
│   · relays messages between renderer and worker              │
└───────────────┬──────────────────────────┬───────────────────┘
                │ contextBridge (preload)  │ stdin/stdout pipe
┌───────────────▼──────────────┐  ┌────────▼───────────────────┐
│ Renderer (React/TypeScript)  │  │ Python worker              │
│   · all UI                   │  │   · download, edit, render │
│   · holds no business logic  │  │   · upload, schedule       │
└──────────────────────────────┘  └────────────────────────────┘
```

**The renderer never talks to Python directly.** It sends a command through the preload
bridge to the main process, which writes one line of JSON to the worker's stdin. The worker
writes newline-delimited JSON back on stdout; main forwards each parsed message to the
renderer as a `python-event`.

### Why a separate Python process rather than doing it in Node

The video and AI ecosystem is Python: `yt-dlp`, Whisper, `edge-tts`, the Google API client.
Reimplementing those in Node is not viable. The worker is frozen with PyInstaller and
shipped inside the installer, so the end user installs nothing.

---

## 3. Stack

| Layer | Choice |
|---|---|
| Shell | Electron |
| UI | React 18 + TypeScript + Vite + Tailwind |
| Icons | lucide-react |
| Worker | Python 3.11+ |
| Packaging | electron-builder (NSIS) + PyInstaller (onedir) |

**Python runtime dependencies** (all imported lazily, inside functions, so the app starts
fast and a missing optional library degrades instead of crashing):

```
yt-dlp                    # all downloads, every site
curl_cffi                 # TLS impersonation — mandatory, see §9.1
faster-whisper            # transcription (frozen build)
openai-whisper            # transcription (dev)
edge-tts                  # neural text-to-speech
google-api-python-client  # YouTube Data API v3, Drive API
google-auth-oauthlib      # OAuth installed-app flow
httplib2                  # proxy transport for uploads
requests                  # Claude API calls
numpy
```

**Bundled binaries:** `ffmpeg.exe` and `ffprobe.exe` ship in `resources/bin` and are put on
the worker's `PATH` at spawn time.

---

## 4. File layout

```
src/
  main/
    main.ts            Electron main: window, tray, IPC handlers, file pickers
    pythonManager.ts   Spawns/supervises the worker, parses its stdout
    ffprobe.ts         Locates the bundled binaries
  preload/
    preload.ts         contextBridge surface (see §9.2 — subtle)
  renderer/
    components/
      AutomationTab.tsx   The main screen: pairs, settings, cookies, history
      SettingsPanel.tsx   Editing options, shared and per-channel
      VideoQueue.tsx      Manual one-off editing queue
      Titlebar.tsx
    hooks/
      useQueueStore.ts    Renderer state + the python-event listener
  types/
    index.ts, electron.d.ts

python_backend/
  app.py              IPC loop, job pipeline, command handlers
  scheduler.py        Config, daily schedule, the automation run
  sources.py          Provider abstraction: which site/folder/Drive
  tiktok_downloader.py  yt-dlp wrapper, per-site quirks
  tiktok_cookies.py   Per-platform cookie jars (name is historical)
  youtube_uploader.py OAuth, accounts, upload, proxy, setup links
  drive_account.py    Separate Drive OAuth
  video_editor.py     ffmpeg filter graph and render
  transcriber.py      Whisper
  script_rewriter.py  Claude API rewrite + SEO title
  align.py            TTS and timing
  captions.py         ASS subtitle generation
  secure_store.py     Windows DPAPI encryption
  ffmpeg_utils.py     Safe subprocess wrappers
  assets/
    client_secret.json   OAuth client — supply your own, see §11
  tests/
    test_automation.py   ~277 tests
```

---

## 5. Data storage

Everything lives in `%APPDATA%\<AppFolder>\`. No database — JSON files, encrypted at rest.

| File | Contents |
|---|---|
| `automation_config.json` | Pairs, schedules, presets, history, processed ids |
| `automation_config.json.bak` | Previous version, written before every save |
| `youtube_accounts.json` | Linked channels + OAuth tokens (encrypted) |
| `client_secret.json` | User-supplied OAuth client |
| `client_secret_<accountId>.json` | Per-channel OAuth client |
| `tiktok_cookies.json` | TikTok cookies (encrypted) |
| `instagram_cookies.json`, `youtube_cookies.json` | Per-site cookies |
| `drive_account.json` | Drive OAuth (encrypted) |
| `errors.log` | Tracebacks — kept out of the user-facing console |

### Encryption

`secure_store.py` wraps **Windows DPAPI** through `ctypes` (`CryptProtectData` /
`CryptUnprotectData`). Values are stored as `dpapi:<base64>`; whole files as
`{"__dpapi__": "<base64>"}`. Reads must accept legacy plaintext so an upgrade does not lose
data. On non-Windows it degrades to plaintext — acceptable only because the product is
Windows-only.

### Config schema (the parts that matter)

```jsonc
{
  "enabled": false,
  "schedule_time": "18:00",          // shared daily slot, 24h local
  "videos_per_run": 1,
  "privacy_status": "private",       // private | unlisted | public
  "publish_delay_hours": 0,
  "proxy_url": "",                   // shared, encrypted
  "channel_proxies": {},             // { accountId: url }, encrypted
  "youtube_account_ids": [],         // ticked = runs in the daily schedule
  "youtube_selection_explicit": false,
  "channel_sources":   {},           // { accountId: "tiktok url | path | drive:id" }
  "channel_schedules": {},           // { accountId: "HH:MM" }
  "channel_presets":   {},           // { accountId: { partial ProcessingOptions } }
  "preset": { /* full ProcessingOptions */ },
  "processed_video_ids": [],         // "accountId:videoId" — the re-upload guard
  "history": [],                     // capped at 50
  "last_run_date": "",
  "last_run_dates": {}               // per channel
}
```

**Critical rule:** the UI must never be able to overwrite server-owned state. Define an
explicit `USER_EDITABLE_KEYS` allowlist and merge only those on save. Without it, a UI that
holds a stale copy will wipe `history` and `processed_video_ids` — and the re-upload guard
with them.

---

## 6. IPC contract

### Commands (renderer → worker)

```
Jobs         start_job · cancel_job · probe · ping
Automation   get_automation_config · save_automation_config · run_automation_now
             clear_automation_history · set_api_key
YouTube      start_youtube_oauth · save_youtube_tokens · disconnect_youtube
             refresh_channel_info · import_client_secret · open_setup_page
             set_channel_profile · import_channel_credentials
             clear_channel_credentials · relink_channel · clear_verification
Sources      download_tiktok
Cookies      import_tiktok_cookies · clear_tiktok_cookies · verify_tiktok_cookies
Drive        connect_drive · disconnect_drive · get_drive_folders
Network      test_proxy
```

### Events (worker → renderer)

```
progress · log · completed · failed · cancelled · preview_ready
transcript_ready · script_ready · probe_result · worker_info
automation_config · automation_config_saved · automation_config_invalid
automation_completed
youtube_connected · youtube_tokens_saved · youtube_disconnected
channel_info_refreshed · client_secret_imported · client_secret_invalid
channel_credentials_invalid
tiktok_downloaded · tiktok_download_failed
tiktok_cookies_saved · tiktok_cookies_invalid · tiktok_cookies_verified
drive_status · drive_folders · drive_failed
proxy_tested
```

Every message has the same shape:

```json
{ "type": "...", "jobId": "...", "progress": 0, "step": "", "data": null, "error": null, "message": "" }
```

**Rules learned the hard way:**

- Any command that touches the network or takes more than a moment **must run on a thread**.
  The main loop reads stdin; blocking it freezes every other command.
- A worker thread **must always send a terminal event**, including on exception. A thread
  that dies silently leaves the UI spinning forever.
- Worker threads share stdout — hold a lock around the write, or interleaved partial writes
  corrupt the JSON stream.

---

## 7. The processing pipeline

`run_job_pipeline(job_id, payload)` — used by both the manual queue and automation.

```
 5%  Probe (ffprobe: dimensions, duration, has_audio)
       └─ Raw mode short-circuits here → §7.1
10%  Extract audio
20%  Transcribe (Whisper, local)
35%  Rewrite script (Claude API, optional)
50%  Synthesise voiceover (edge-tts)
65%  Build caption timing
75%  Render (ffmpeg)
97%  Generate translated SEO title (optional)
100% Complete
```

### 7.1 Raw mode ("upload as-is")

When enabled, skip everything after the probe. Only conform the resolution:

- If the target size equals the source, **remux with `-c copy`** — no re-encode at all.
- Otherwise scale with lanczos and re-encode video only, `-c:a copy`.

Run it through the same ffmpeg runner as the main render so it gets live progress, a stall
watchdog, a timeout and a working Stop button.

### 7.2 The render filter chain

Order matters:

```
hqdn3d (denoise)  →  crop/pad  →  scale=lanczos  →  unsharp (only when upscaling)  →  subtitles
```

Denoise **before** upscaling (upscaling amplifies noise); sharpen **after**.

### 7.3 Output sizing

```python
RENDER_SHORT_SIDE = {"1080p": 1080, "1440p": 1440}
```

Compute the target from the aspect ratio and quality. Two absolute rules:

- **Every dimension must be even.** x264 in yuv420p refuses odd sizes.
- The **caption canvas must equal the render size**. If the subtitle generator is told
  1080p while ffmpeg scales to 1440p, every overlay lands in the wrong place.

Scale the caption font with the frame: `font_size * short_side / 1080`, or captions are
visibly smaller at 2K than at 1080p.

---

## 8. Feature specification

### 8.1 Sources

One string per pair decides the provider. Detection order:

1. Starts with `drive:` or contains `drive.google.com` → **Drive**
2. Matches `^[a-zA-Z]:[\\/]`, or starts with `\\` or `/` → **folder**
3. Contains `tiktok.com` / `instagram.com` / `youtube.com` / `youtu.be` → that site
4. Otherwise → **TikTok** (a bare `@handle` has always meant TikTok)

Validation must reject a URL that looks like a link but matches no known site — otherwise
a Vimeo link is silently stored as a "TikTok" source and fails hours later, mid-run.

Every provider returns the same shape from `list_candidates()` and `fetch()`, so nothing
downstream knows which kind of source it came from.

**Watched folder specifics:**
- Serve **oldest first** — a drop folder is a queue.
- Skip files modified in the last ~20 seconds (still being copied). Do **not** use a size
  floor: a genuinely short clip is small forever and would never upload.
- **Copy** into the work dir, never move. The pipeline deletes its inputs.
- Id from `sha1(abspath + size)`, so replacing a file with a different clip of the same name
  is not mistaken for one already uploaded.

### 8.2 Multi-channel model

Each pair holds: source · schedule · editing preset overrides · upload proxy · Chrome
profile · Google OAuth client (project) · verification state.

- Ticking a channel controls **only** whether it runs in the daily schedule.
- Clicking a row selects it and opens its settings. These are different actions and must
  not be conflated.
- Per-channel presets merge over the shared preset: `{**shared, **override}`.

### 8.3 YouTube quota — the defining constraint

Google grants **10,000 units per project per day**. `videos.insert` costs **1,600**.
That is **≈6 uploads per project per day**, shared by every channel on that project.

Therefore the app must support **one OAuth client (project) per channel**. The token stores
its own `client_id`/`client_secret`, so uploads are automatically charged to the right
project once a channel is linked with its own client.

### 8.4 Cookies

Separate jar per site. Accept three input shapes:

1. Netscape `cookies.txt`
2. The browser-extension **JSON array** (`[{domain, name, value, expirationDate, hostOnly, …}]`)
3. A raw `Cookie:` header

Rules:
- Write each cookie under **that site's domain**. Filing an Instagram cookie under
  `.tiktok.com` sends it to the wrong site and never to the right one.
- Preserve `hostOnly` — a host-only cookie must not be marked as covering subdomains.
- A session cookie (no expiry) gets `0`, not an invented date.
- The login cookie differs per site: `sessionid` for TikTok and Instagram, **`SAPISID`** for
  Google/YouTube.
- Only cookies.txt and the JSON carry real dates. A pasted header has none — say "expiry
  unknown" rather than inventing one.
- Verification must make a **real request**, not just parse.

### 8.5 Scheduling

- One shared daily slot, overridable per channel.
- A missed slot (PC off) is caught up on next start — never silently skipped.
- Track `last_run_dates` **per channel**, so one channel finishing does not mark the rest done.
- Only one pipeline run at a time — guard with a non-blocking lock.

### 8.6 Proxies

Per channel, for the upload leg only. Accept all three shapes sellers hand out:

```
ip:port
ip:port:user:pass          ← the common one, and not a URL
user:pass@ip:port
```

Normalise to a proper URL with the scheme chosen from a dropdown. **`urlparse(...).port`
raises** on `ip:port:user:pass` — catch it, or the exception escapes the worker thread and
the Test button spins forever.

Test by fetching an IP-echo endpoint through the proxy and reporting the exit IP. A bad
proxy must **fail the run**, never fall back silently to the home connection.

---

## 9. Non-obvious problems you will hit

This is the section that matters. Each of these shipped as a bug.

### 9.1 TikTok serves silent video at high resolution

TikTok exposes `h264_540p` and several `bytevc1` (HEVC) renditions at 720p/1080p. **Every
bytevc1 rendition arrives with no audio packets while its metadata claims `acodec: aac`.**
There is no audio-only format to fall back on.

- `bestvideo[ext=mp4]` → 576×1024 with audio (skips HEVC entirely)
- `bv*+ba/b` → 1080×1920, **completely silent**

The fix names the audio source separately:

```python
"format": "bv*+ba*[vcodec*=avc]/bv*+ba/b"
```

Apply this to **TikTok only** — forcing h264 audio on YouTube picks a worse stream.

Also: `curl_cffi` TLS impersonation (`ImpersonateTarget("chrome")`) is **mandatory**.
Without it TikTok answers "Unexpected response from webpage request" for every download,
while profile listing still works — a confusing half-failure.

### 9.2 A callback's identity does not survive `contextBridge`

This one caused days of confusion. In the preload:

```ts
// BROKEN — the map never matches
const map = new WeakMap<Fn, Wrapped>();
onPythonEvent: (cb) => { map.set(cb, wrap(cb)); ipcRenderer.on('python-event', wrap(cb)); }
offPythonEvent: (cb) => { ipcRenderer.removeListener('python-event', map.get(cb)); }
```

Every crossing of the context bridge wraps the function in a **fresh proxy object**, so
`map.get(cb)` never finds what `map.set(cb, …)` stored. `off` removes nothing, listeners
accumulate, and **every log line appears twice, then four times, then six**.

Fix: track by token.

```ts
const listeners = new Map<number, Fn>();
let nextId = 1;
ipcRenderer.on('python-event', (_e, m) => listeners.forEach(cb => { try { cb(m); } catch {} }));
onPythonEvent:  (cb) => { const id = nextId++; listeners.set(id, cb); return id; },
offPythonEvent: (id) => { listeners.delete(id); }
```

### 9.3 A restart spawns two workers

```ts
restart() { this.stop(); this.stopping = false; this.spawnWorker(); }
```

`stop()` kills the old process, but its `exit` event fires **later** — by which time
`this.pythonProcess` is the new worker. The handler then nulls the live worker's reference
and starts a third. Result: two schedulers, two of every log line, two pipelines over one
temp folder.

Fix: capture the child in a local and guard every handler with
`if (this.pythonProcess !== child) return;`.

### 9.4 `hash()` is salted per process

Fallback video ids built from Python's `hash()` change on every restart, so the
"already uploaded" check never matches and **the same clip re-uploads daily**. Use sha1.

### 9.5 `build()` rejects `credentials` and `http` together

```python
build("youtube", "v3", credentials=creds, http=http)   # raises
```

Every proxied upload crashed. Use `google_auth_httplib2.AuthorizedHttp(creds, http)` and
pass only `http`.

### 9.6 A sign-in rebuilds the account record

If `_upsert_account` constructs a fresh dict, re-linking a channel **drops fields that were
not part of the sign-in** — the per-channel project, the Chrome profile. The channel moves
onto its own project and the UI immediately reports it as shared.

Fix: derive `project_id` from the credentials file on disk (the source of truth), and carry
forward anything the sign-in did not supply.

### 9.7 The YouTube scopes never reveal the signed-in Gmail

`channels.list(mine=True)` returns the channel, not the account. There is **no way** to
work out which Gmail a channel was linked from. Record the Chrome profile at link time or
ask the user; it cannot be derived later.

Related: `channels.list` returning **empty items is not an error** — it means that Google
account has no YouTube channel. Say exactly that.

### 9.8 An unpublished consent screen expires in 7 days

A Google Cloud OAuth consent screen left in **Testing** invalidates refresh tokens after
seven days. Every channel silently dies a week after setup. Push the user to publish, and
detect the failure as "re-link needed" rather than a generic error.

### 9.9 Reading Chrome's cookie store is a dead end

Chrome 127+ uses App-Bound Encryption; `cookiesfrombrowser` fails with "Failed to decrypt
with DPAPI". Do not build on it. Accept pasted cookies instead.

Note also: the cookie-fallback retry must not match on the string `"cookie"` — Chrome's
error does not contain it.

### 9.10 ffmpeg progress and stdin

- Parse `-progress pipe:1` (clean `key=value` lines). The human-readable stderr stats line
  is carriage-return separated and yields nothing usable — the bar sits at its start value
  for the whole render.
- Pass `-nostdin` and close stdin. Children inherit the worker's stdin, which is the
  Electron IPC pipe; ffmpeg would otherwise consume the JSON commands meant for the worker.
- Every ffmpeg call needs a timeout and a **stall watchdog** — a silent ffmpeg otherwise
  hangs the job forever with no error and no way out.

### 9.11 Atomic writes are not enough

`os.replace()` fails with `PermissionError` on Windows when another process holds the file.
Retry briefly. And **copy the previous version to `.bak` before every write** — the upload
history exists nowhere else, and one bad write ends it permanently. On read, fall back to
the backup when the main file will not parse.

### 9.12 Frozen-build traps (PyInstaller)

- `yt-dlp` resolves extractors **by name at runtime** → `--collect-submodules yt_dlp`, or
  the exe downloads nothing.
- `curl_cffi` ships compiled libraries and its own CA bundle → `--collect-all curl_cffi`.
- `googleapiclient` reads `youtube.v3.json` from its discovery cache →
  `--collect-data googleapiclient`, or `build("youtube","v3")` fails **only in the exe**.
- Bundled assets live next to `sys._MEIPASS`, not `__file__`. Check both.
- Do not replace stdio at import time — do it inside `main()`, or `import app` in a test
  run hijacks the test runner's output capture.

### 9.13 Error messages

yt-dlp's own text ends with three lines telling the user to file a GitHub issue. Never show
it. Map failures to one actionable sentence, and make the advice depend on state — telling
someone to "add cookies" when they saved cookies an hour ago reads as the app not noticing.

Write tracebacks to a log file, never to the user-facing console.

---

## 10. Testing

~277 tests, all against real behaviour rather than implementation detail. The valuable ones
assert the bugs above cannot return:

- Config save must not wipe history or processed ids
- Ids must be stable across processes
- Every computed output dimension is even
- Caption size keeps its proportion between 1080p and 2K
- The download selector names an h264 audio source
- Cookies are filed under the correct domain per site
- A tick records which project earned it
- Re-linking keeps the channel on its own project
- Clearing the log does not clear the uploaded-id list
- A malformed proxy answers instead of hanging

Patch at the seam the code actually calls. When the pipeline moved to a provider
abstraction, tests still patching the old TikTok functions silently made **real network
calls** — the suite went from 4 seconds to 118.

---

## 11. Packaging and distribution

```
npm run dist   →   test → build renderer → PyInstaller → electron-builder (NSIS)
```

Ship `ffmpeg.exe` and `ffprobe.exe` in `resources/bin`; add that directory to the worker's
`PATH` at spawn.

**Do not ship your own OAuth client.** A bundled `client_secret.json` means every install
shares one 10,000-unit daily quota — around six uploads a day across all users combined —
and the secret can be extracted from the installer. Make each user supply their own Google
Cloud project during setup.

**Not built here, needed to sell it:** licence key, activation server, machine binding,
and feature gating per tier. There is currently nothing preventing copying.

---

## 12. Legal and policy notes

Anyone building this should know:

- Re-uploading third-party video is exactly what YouTube's reused-content policy and
  Content ID target, and both act automatically.
- Automated downloading sits against TikTok's and Instagram's terms of service.
- Using Google account cookies with yt-dlp can get that account flagged — never the account
  that owns the upload channels.
- Many Google Cloud projects to multiply quota may be read as circumvention and suspended.

These are the user's risks to accept, and they can only accept them if they are told.
