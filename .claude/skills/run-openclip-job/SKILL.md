---
name: run-openclip-job
description: Run a real OpenClip project end to end on a test server - paste a YouTube, Twitch or Kick link (including a live stream or a Twitch channel), follow progress, retry or cancel, then verify the clips. Use to test pipeline changes on real streams.
---

# Run an OpenClip project

## 1. Start a test server (do not use the owner's)

The owner's app usually runs on port 5173 with older code. Start a separate server on 5199 with the current code,
in the background:

```bash
PORT=5199 node server/index.mjs > .cache/tmp/server-5199.log 2>&1   # run_in_background
until curl -s -m 2 -o /dev/null http://localhost:5199/api/jobs; do sleep 1; done
```

Both servers share `work/`. Never run the same project on both at once. Restart the test server after changing
server code or `presets/` (templates are read at start-up). Restarting interrupts a running project; retry it after.
Stop the server when you are done.

## 2. Create a project

```bash
curl -s -X POST -H 'content-type: application/json' \
  -d '{"url":"<link>","options":{"model":"small.en","language":"en","count":3}}' \
  http://localhost:5199/api/jobs
```

- Links: YouTube video or live stream, Twitch VOD, clip or channel (live channels import the stream so far), Kick
  VOD or clip. Kick channels are refused while live (Kick shares only the last ~30 s).
- Useful options: `editTemplate` (for example `cam-split`), `framing` (`center`, `face`, `fit`, `letterbox`, `stack`),
  `count`, `scan` (`auto`, `fast`, `full`). Options are validated in `server/options.mjs`.
- `small.en` keeps test runs short. Long streams over 2 h use the fast scan.

## 3. Follow it

```bash
node -e "const j=require('./work/<id>/job.json');console.log(j.status,j.stage,Math.round(j.progress*100)+'%',j.message)"
```

Wait with a background loop that ends on `complete` or `error`; never poll with a foreground sleep. Stages: import,
probe, audio, transcribe, select, titles, render, complete. Per-step logs are in `work/<id>/` (`download.log`,
`transcribe*.log`, `hires/*.log`, `clips/*.log`).

Mutating calls need an `origin` header from the server itself:

```bash
curl -s -X POST -H 'origin: http://localhost:5199' http://localhost:5199/api/jobs/<id>/retry    # or /cancel
```

A retry keeps the transcript and picks, so renders can be redone cheaply.

## 4. Verify

Use the `verify-clips` skill: `node scripts/verify-clips.mjs <id> --frames`, then look at the frames.

## Known traps

- Live and just-ended YouTube streams: grab full-quality sections soon after the picks; a streamer can make the
  video private and then nothing can be downloaded.
- Never repair downloaded media in place (see `verify-clips`).
- Other heavy programs on this PC slow transcription a lot; check `tasklist` before blaming the code.
- Put every temporary file under `.cache/tmp/`, never on C:.
- Delete large test downloads (`work/<id>/source.mp4`, several GB for long streams) when they are no longer needed.
