---
name: clip-template
description: Add or change an OpenClip edit template (the cards in the template gallery, for example Cam Split) - settings, any new render option, demo card, tests and verification. Use when the owner asks for a new editing style or layout.
---

# Add an edit template

Templates are presets of render settings in `presets/edits.json`, applied with `applyTemplate` in
`server/templates.mjs`. Cam Split (`cam-split`) is the most recent full example.

## Steps

1. **Ground it.** A template either replicates an owner-supplied reference Short (`referenceUrl`) or documents its
   `basis` (what it is based on, with sources in `NOTES.md`). Do not copy third-party footage, music or logos.
2. **Settings first.** Reuse existing options before adding new ones: framing (`center`, `face`, `fit`,
   `editorial`, `letterbox`, `stack`), caption `style` (see `presets/captions.json`), `font` (must be a real id such
   as `anton`, `work`, `montserrat`), `captionPosition`, `hookEnabled`, motion and effects options.
3. **New render option, if needed:**
   - default and validation in `server/options.mjs`;
   - add the key to `SETTING_KEYS` in `server/render.mjs` so it can be set per clip;
   - implement it in the render path (framing in `videoFilters`, layout helpers in `server/stack.mjs` or
     `server/framing.mjs`); keep a fallback when the input does not fit (no facecam, vertical source);
   - layout maths the editor preview also needs goes in `web/src/logic.mjs` (shared by server and browser).
4. **Add the entry** to `presets/edits.json` with `id`, `name`, `category`, `description`, `sample`, `accent`,
   `fontFamily`, `settings` and `metadata` (title guide, hashtags, description template).
5. **Card art.** Without a reference, the card draws `web/src/TemplateMock.tsx` (per framing; add a variant if the
   layout is new). Optionally render an original demo from synthetic footage, as in
   `scripts/make-cam-split-demo.mjs`, into `web/public/templates/<id>.mp4/.jpg`.
6. **Tests.** Update the template count in `tests/templates.test.mjs` and `tests/api.test.mjs`; add unit tests for
   any new option and its filter graph (see `tests/stack.test.mjs`).
7. **Verify on real footage.** Render a real clip with the template (`run-openclip-job`, `verify-clips`), look at the
   frames, then `npm test`, `npm run lint`, `npm run build`. Restart the server so it reads the new template.
8. Log the decision and what was rejected in `NOTES.md`.
