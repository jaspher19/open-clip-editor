# Editing contract (moments, VFX, engagement)

Shared data model for the editing batches added on 2026-11-04. The renderer, the API,
the editor UI and publishing all read and write these fields; change this file first
if a field has to change.

All times are **source seconds** (the long video's clock) unless a field says otherwise,
so edits survive re-trimming. The renderer maps them to output time through the EDL and
drops anything that lands inside a removed range.

## Clip fields (saved with `PATCH /api/jobs/:id/clips/:clipId`)

| Field | Type | Meaning |
|---|---|---|
| `cuts` | `{start,end}[]`, at most 40 | Ranges removed from inside the clip ("cut out the middle"). Each inside `[clip.start, clip.end]`, at least 0.1 s, non-overlapping. |
| `parts` | `{start,end}[]`, at most 3 | Extra source ranges played after the main range, in order (combine a setup and a payoff). Each 2–30 s. Total output must stay within 60 s for Shorts. |
| `effects` | `Effect[]`, at most 40 | Manual effects, see below. |
| `titleOptions` | `string[]`, at most 3 | Alternative titles written by the AI; the editor lets the owner pick one. |

`Effect`:

```ts
type Effect = {
  id: string;            // client-generated, unique within the clip
  type: 'zoom' | 'shake' | 'flash' | 'freeze' | 'replay' | 'sfx' | 'pop';
  at: number;            // source seconds
  duration?: number;     // freeze 0.4–2 (default 0.9), replay = length of the replayed window 1–4 (default 2), shake/flash/zoom 0.15–1.5
  sound?: string;        // sound id from GET /api/sounds, e.g. "meme/boom"; '' = none. Any effect may carry one.
  text?: string;         // pop: the word or short phrase (≤ 24 chars); freeze: optional label, default "WAIT FOR IT…"; replay: label, default "REPLAY"
  emoji?: string;        // pop only, optional single emoji
};
```

- `zoom`: quick punch-in to 1.18× and back over `duration`.
- `shake`: camera shake over `duration`.
- `flash`: white flash fading out over `duration`.
- `freeze`: holds the frame at `at` for `duration`, with label text; audio pauses (silence plus the sound, if any).
- `replay`: after the moment ends, replays `[at - duration*0.75, at + duration*0.25]` in slow motion (0.6×) with a "REPLAY" label, then continues.
- `sfx`: just the sound.
- `pop`: big emphasis text (and emoji) popping in at `at` for about 0.9 s.

## New clip settings (in `clip.settings`, validated by `validateOptions`)

| Setting | Type, default | Meaning |
|---|---|---|
| `autoEffects` | boolean, `true` | Keep the automatic speech-beat zooms and accents. Off = only manual effects. |
| `coldOpen` | boolean, `false` | Start with the payoff, then rewind to the setup. |
| `coldOpenSeconds` | number 1–3, `1.6` | Length of the cold-open teaser. |
| `coldOpenAt` | number or `null`, `null` | Source time of the payoff. `null` = first `replay` effect, else `clip.peakAt`, else 65 % through the clip. |
| `loopEnding` | boolean, `false` | End tight on the last word so the Short loops cleanly. |
| `profanityAudio` | `'keep'`, `'beep'`, `'mute'`; `'keep'` | What to do with swear words in the audio (captions are masked separately). |
| `cropX` | number 0–1 or `null`, `null` | Manual horizontal crop centre for 9:16 (overrides face tracking). |
| `musicTrack` | string, `''` | File name from the music library (`GET /api/music`); `''` = the project's uploaded track, if any. |

## API

| Route | Owner | Purpose |
|---|---|---|
| `GET /api/sounds` | render | `[{id,name,group}]`, bundled sounds, e.g. `soft/plop_01`, `impact/hit_01`, `meme/boom`. |
| `GET /api/sounds/:group/:name` | render | The WAV, for previews in the editor. |
| `GET /api/jobs/:id/timeline` | moments | `{duration, buckets:[{t,loud,laugh,hype,cue}], candidates:[{start,end,score,category,title,used}]}`, buckets of about 5 s across the whole stream. |
| `POST /api/jobs/:id/clips` | moments | `{start,end}` adds a new clip (titled like the others, `dirty: true`). |
| `POST /api/jobs/:id/clips/:clipId/swap` | moments | Replaces the clip with the best unused moment that doesn't overlap any other clip. |
| `GET /api/music`, `POST /api/music` | moments | Music library under `work/music-library/` (list, upload). |
| `POST /api/jobs/:id/clips/:clipId/hook/ai` | publishing | `{hook, titleOptions}` for one clip, nothing saved. |
| `POST /api/posting/:id/thumbnail` | publishing | `{time, text}` renders a custom thumbnail for a post; it's uploaded after the video (failure is non-fatal). |

## Front-end modules

| File | Owner | Exports |
|---|---|---|
| `web/src/readiness.mjs` | moments | `readiness(clip, job, exportInfo?)` → `{ok, checks:[{id,label,pass,fix}]}` |
| `web/src/ReadyCheck.tsx` | moments | `ReadyCheck({clip, job, compact?})` |
| `web/src/StreamTimeline.tsx` | moments | `StreamTimeline({job, onAdded, onOpenClip})` for the project page |
| `web/src/EffectsLane.tsx` | editor | `EffectsLane(...)` inside the clip editor |
| `web/src/ThumbnailPicker.tsx` | publishing | `ThumbnailPicker({post, onSaved})` for the Edit post dialog |

## Reference template contract (2026-11-04)

Templates are replicated from measured viral references; see `.cache/references/<id>/analysis/spec.json` and `presets/edits.json` → `referenceUrl`.

### Clip settings (validated in `server/options.mjs`)
| Key | Values | Meaning |
|---|---|---|
| `captionPosition` | `lower` · `middle` · `center` · `upper` | `middle` = caption block's vertical centre at 50% of the frame (y 960 of 1920; 540 of 1080 wide). |
| `framing` | `center` · `face` · `fit` · `editorial` · `letterbox` | `letterbox` = full-width black bars around a band of `letterboxAspect`, the subject cropped into it (face-tracked when face data exists). |
| `letterboxAspect` | `3:4` · `4:5` | Band shape for `letterbox`: 3:4 → 1080×1440 at y 240; 4:5 → 1080×1350 at y 285. |
| `watermark` | string ≤ 32, `''` = off | Faded channel handle (e.g. `@ClippingIRL`), white ~45% opacity, ~38 px, centred horizontally. |
| `watermarkY` | 0.5–0.95 | Vertical centre of the watermark as a fraction of frame height. |
| `flashColor` | `auto` · `#rrggbb` | Colour of auto/manual flash effects (`auto` = white). Reference reds are `#ff2020`. |
| `grade` | `none` · `vivid` · `mono-peaks` | `vivid`: saturation/contrast lift for the whole clip. `mono-peaks`: black-and-white on reaction peaks (auto-effect beats), colour elsewhere. |

Caption fonts add `montserrat` (Montserrat ExtraBold) and `montserrat-black` (Montserrat Black); files are in `assets/fonts`.

### Caption style fields (`presets/captions.json`)
Existing: `font,size,maxWords,maxChars,uppercase,outline,active,inactive,box,pop`. New optional fields:
- `case`: `upper` · `lower` · `none` (overrides `uppercase`).
- `colorRule`: `active` (default: spoken word in `active`) · `alternate` (word i takes `palette[i % n]`, counted across the clip) · `cycle` (same as alternate but skips repeats of the previous colour; used with long palettes) · `keywords` (base `inactive`, emphasis words — longest content word per phrase, or words ending in `!`/`?` — take the phrase's palette colour, rotating per phrase).
- `palette`: list of ASS colours (`&H00BBGGRR&`).
- `boxStyle`: `solid` → opaque rectangle behind the text (`boxColor`, default black; `boxPad` px).
- `shadow`: hard drop-shadow depth px (`shadowColor`).
- `glow`: px of soft glow (blurred copy in the text colour behind the text).
- `spacing`: letter spacing px (`\fsp`).
- `lines`: max caption lines (default 1; phrase styles use 2).
- `minSize`: smallest font size the auto-fit may use (allows small Montserrat captions).

### Template metadata (`presets/edits.json` → `metadata`)
`{ "titleGuide": "abstract title pattern", "emoji": ["😭","💀"], "emojiCount": 2, "case": "title|upper|sentence", "maxLength": 60, "hashtags": ["#shorts", ...], "descriptionTemplate": "uses {title} {context} {source} {hashtags}" }`. Applied to local and AI titles, descriptions and tags when the clip's `editTemplate` has it. Never reuse a reference's actual title text.

## Meme edit (automatic)

Replicated from two reference Shorts: Meme Reveal (`eUFkorW-1kk`) and Skull Ending (`B4Xh4PzRtJM`). `server/meme-edit.mjs` places every effect from the transcript, the picker's `peakAt` and the clocked edit list. Nothing is placed by hand.

| Setting | Effect |
|---|---|
| `revealFx` | Measured on eUFkorW-1kk. The edit list holds the frame before the jump cut nearest the peak (±1.5 s; else before the word nearest it) for 0.53 s (`freeze` segment with `reveal: true`). The voice fades to silence over the 0.3 s before the hold and stays silent through it. The cut then lands with an exposure flash (+0.3 brightness, 0.1 s rise, 0.35 s settle) and `meme/boom`. There is no zoom or riser: the reference has neither. |
| `cutFlash` | An exposure flash (+0.26 brightness, 0.1 s rise, 0.3 s settle) on up to four jump cuts at least 3 s apart and more than 1 s from the reveal. Off on Skull Ending, which has no cut flashes. |
| `tintFlashes` | Up to 3 full-frame colour tints on shouted words, at least 1.5 s apart, with the same 0.1 s rise and 0.3 s settle. Green on a yes (`yes`, `yeah`, `yep`) and red on a no (`no`, `nah`, `not`, `what`…); other words alternate. Both are drawn with a per-frame `eq` (channel gammas, saturation, brightness), so the face keeps its detail as it does on the reference. |
| `actionLabels` | `label` effects (`*TEXT*`, red for two frames, then white) at the caption spot. Captions they overlap are hidden. The AI writes them during titling, or from "Auto action labels" in the editor. Each must quote 2–5 transcript words it follows, and start with an action verb or be one body-state word. Automatic labels carry `auto: true`, and a rewrite replaces only those. |
| `skullEnding` | Measured on B4Xh4PzRtJM. The last kept frame holds for 2.9 s (`skull` segment, voice silent). Over it: a 0.13 s brightened vertical smear before the hold; a 1.12× punch-in; a warm grade (saturation ×1.7, gold highlights) with a soft glow on the highlights (`skullGraph`); a floor haze and five flickering flames; and an original animated mind-blown skull at 27% across and 50% down. Its brain cloud bursts up and its jaw drops on every hit of `meme/skull-808`, an original 808 beat at one hit per 0.58 s that starts with the smear. Captions stop 0.5 s before the hold. |
| `hookReveal: 'typewriter'` | The hook types on letter by letter over about 0.7 s. A second row takes the accent colour. |

Caption styles: `meme-word` (1–2 words; colour rule `turns`, which switches yellow/cyan at each sentence end as a stand-in for a speaker change) and `meme-phrase` (2-line phrases with red/green/yellow keywords).

### Moments picked for the format

A template with a `moment` block in `presets/edits.json` picks its own kind of moment. These are the two `group: "meme"` templates, shown in their own gallery section. The heuristic picker, the AI picker prompt, the stream timeline's ranked moments (swap) and the length checks all read it through `momentShape(options)`.

| Template | Plays | Source window | Payoff position | Extra rule |
|---|---|---|---|---|
| Meme Reveal | 11–24 s | 10–32 s | 50–80% | `cut`: +6 if a pause longer than the cut threshold sits within 1.5 s before the peak (where the reveal lands), −5 if not |
| Skull Ending | 12–25 s | 10–34 s | 72–95% | `after: 4`: the clip ends within 4 s of the peak. `ending`: a bonus for a laugh or hype word in the last 3 s |

Other templates keep the minute-long moments. The 10 s minimum also applies to manual ranges and trims while one of these templates is selected.

**AI judge** (`server/meme-judge.mjs`): for a meme template with the local picker and any AI key (the `METADATA_AI` chain: Gemini, Groq, then Claude), the local picker proposes 30 format-shaped candidates across the stream. The AI reads them (about 4k tokens) and returns the best 8–12, each with a start, a payoff, an end and a reason. Its times snap to words, end on a whole sentence, and must fit the shape (skull endings end within 4 s of the payoff); otherwise the local window is kept with the AI's payoff. The job records `aiMoments: {status, provider, model, pool, error?}`. A failed AI call retries once with half the pool, then keeps the local ranking. A too-large reply (HTTP 413) fails over like a busy one.

Skull Ending also sets `hookPosition: "middle"`: the title block is centred at 47% height, and captions start once it ends.
