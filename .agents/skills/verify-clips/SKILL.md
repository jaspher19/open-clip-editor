---
name: verify-clips
description: Check that a project's finished clips are actually good - resolution, sound present, captions in sync with the audio, full-quality sections matched - and look at frames. Use after any change to rendering, framing, downloads, live import or templates, before saying clips work.
---

# Verify clips

Tests passing is not enough for this repo: clips have broken in ways only the media shows (silent exports from
broken YouTube audio, 5-second sections, letterboxed vertical streams). Check real output.

## Steps

1. Find the project id: `ls work/` or the id in `work/<id>/job.json`. A prefix of 4+ characters is enough.
2. Run the check (read-only; it never changes media):

   ```bash
   node scripts/verify-clips.mjs <id> --frames
   ```

   Per clip it prints size, length, mean loudness, caption/audio sync and the framing note. Exit code 1 means a clip
   needs attention. What good looks like:
   - Shorts are `1080x1920`, horizontal videos `1920x1080`.
   - Mean loudness roughly -14 to -30 dB. Below -60 dB is silent: a broken source section, not a quiet clip.
   - Sync `±0.000s`-`±0.040s` with match above 0.5. A worse shift means captions and cuts land on the wrong frames.
   - For long streams, every full-quality section matched (confidence ≥ 0.35; real runs give 0.95-1.0).
3. Look at the frames it saved (`.cache/tmp/verify/<id>/*-start.jpg`, `-middle`, `-end`) with the Read tool:
   - faces not cut off at the edges; captions not covering the facecam or the action;
   - Facecam layout: the cam panel shows the webcam only (no chat or gameplay strips) and gameplay is centred;
   - vertical sources keep the whole frame (no bars cutting top and bottom).
4. Report the numbers. If something failed, say which clip and why; do not call the clips good.

## Facecam detection accuracy

When `workers/facecam.py` changes, rerun it on several real sources with a facecam and some without, and compare
against boxes measured by eye on a frame (`ffmpeg -ss 5 -i <file> -frames:v 1 frame.jpg`). Count overlap ≥ 0.7 as
right; a "found" cam on a stream that has none (for example a GTA third-person character's head) is the worst error.

## Rules

- Never "repair" a media file in place (remux, re-stamp, re-encode over it). If the platform has since made the video
  private, there is no second copy. Copy it to `.cache/tmp/` first and experiment there.
- Keep temporary files under `.cache/tmp/` in this repo (the C: drive is nearly full).
