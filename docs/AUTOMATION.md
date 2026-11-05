# Video and stream automation

Open **Automation** in the sidebar. Choose a source, template, context and metadata rules, then save a repeatable workflow. **Private upload for review is the UI default.** With no connected account, choose **Prepare files only** to clip/edit and generate the upload package locally.

## Connect YouTube once

1. Create a [Google Cloud project](https://console.cloud.google.com/) and enable YouTube Data API v3.
2. Configure its OAuth consent screen. Add your Google account as a test user while the application is in Testing.
3. Create an OAuth client with application type **Desktop app** and download the JSON into this project’s ignored `.cache/` folder.
4. In Automation, load that JSON and click **Connect YouTube**. Authorize the channel shown by Google.

The app uses a loopback callback, PKCE, a one-time state token, and offline refresh credentials. The browser receives only connection status and the channel name. OAuth files remain under `.cache/youtube/`; upload-session URLs remain under `work/automations/`. These locations are ignored by Git and excluded from source packages. Treat a copy of this working folder as containing account credentials. Disconnect stops enabled workflows and removes the saved token. Google consent-screen Testing and app-verification requirements can affect how long authorization lasts; see [installed-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app).

No Google credentials are included. 

**Public posting from a new Google Cloud project.** YouTube has locked uploads from unaudited API projects (those created after 28 July 2020) as private, and Google's current pages disagree on whether that still applies. After every upload the app compares the privacy YouTube actually applied with the one you asked for. If a **Publish publicly automatically** or **Upload unlisted** clip comes back private, the run is marked *kept private by YouTube* instead of *published*. To lift the lock, request a [YouTube API compliance audit](https://support.google.com/youtube/contact/yt_api_form), or make the video public in YouTube Studio. Consent screens left in Testing also expire refresh tokens after about seven days, so reconnect weekly or publish the consent screen.

## What runs automatically

The saved script validates a single public YouTube video ID, detects VOD/live/upcoming status, runs the local transcription/selection/edit pipeline, generates metadata and thumbnails, and uploads eligible current exports when publishing is explicitly enabled. It does not bypass private-video access, DRM, sign-in or ownership controls.

- **Recorded video:** the normal local pipeline handles files up to four hours / 4 GB.
- **Long recorded stream:** the automation divides sources over four hours into bounded requested sections of 60–900 seconds, up to the configured segment count. These use yt-dlp/FFmpeg remote section downloads. Section cuts can follow nearby keyframes, so original-source timestamp references are approximate.
- **Active live stream:** FFmpeg continuously records into bounded segments. Only finalized CSV-listed segments enter the processing queue. Capture begins at the current live edge; it is not an automatic DVR of earlier broadcast history.
- **Upcoming stream:** waits and checks again. Keep the app running.
- **Backpressure:** one expensive editing job runs at a time. At the configured backlog or disk limit, recording stops; a later live-edge reconnect can leave gaps. This is not a lossless full-broadcast recorder.

Default safeguards include a finite segment count, up to three waiting captures, a 10 GB capture budget per workflow and a 2 GB free-space floor. Advanced limits can be changed in script JSON. Saved capture media and finished projects are retained so edits/retries remain possible; archive or remove old work after stopping the app. This app is a local process, not an operating-system service: closing it stops work. Enabled scripts with `autoResume` can resume after restart; unavailable credentials leave the UI accessible for reconnecting.

Low-speech or ambiguous footage can fail transcription or yield fewer useful clips. The tool does not invent speech captions, detect every visual reaction/game event or guarantee viral selections. Context text supplied by the creator is the most reliable way to establish who/what/why. The free metadata generator extracts actual source text; it does not independently verify identities.

## Metadata and posting

Each clip supports a separate on-video title, persistent context, speech captions, upload title, description, tags and category. **Edit clip → Upload details** edits the upload fields. Corrected owner metadata is preserved. Stop a workflow before editing its active source job. Export after editing; stale clips are excluded from automation.

The upload package contains MP4, SRT, title TXT, metadata JSON and a JPG thumbnail. The JPG is prepared locally; YouTube's own thumbnail behavior still applies to the uploaded Short. No custom-thumbnail API action is currently performed.

Metadata rules support `{title}`, `{context}`, `{transcript}`, `{sourceTitle}`, `{sourceUrl}`, `{start}` and `{end}`. For example:

```json
{
  "titleTemplate": "{title}",
  "descriptionTemplate": "{context}\n\n{transcript}\n\nSource: {sourceTitle}\n{sourceUrl}\n\n#Shorts",
  "tags": ["highlights"]
}
```

Private, unlisted, immediate public and scheduled public modes are separate choices. The UI defaults to private; a script with an upload mode must explicitly set `publishingEnabled: true`. Scheduling uses YouTube's private-plus-future-`publishAt` contract. Per-run caps stop with remaining files prepared; another run can continue. Daily caps wait for the next day in the script's `timeZone` (default `Asia/Manila`). Scheduling intervals and per-run/day limits are configurable. Review the audience setting (`madeForKids`) and generated claims before enabling a workflow. [YouTube video insertion](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert), [video status fields](https://developers.google.com/youtube/data/reference/rest/v3/videos#status).

Uploads save their resumable session before media transfer. Retries query that same session, and completed video IDs prevent repeated posts. A corrupt, expired or uncertain session is not silently replaced. Changing privacy, metadata, channel or media during an existing transfer is blocked; reconcile the existing upload in YouTube Studio before changing it. A scheduled session whose time has passed can be queried for completion, but receives no further media automatically if still incomplete. [Resumable upload contract](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol).

Prepare-only outputs can later be uploaded by editing the same stopped script to an upload mode, connecting the channel, and running it. Re-running Prepare refreshes its metadata preview without creating duplicate clips. Changes to edit templates affect new jobs; re-export existing clips after changing their style. Create a new workflow to change a source URL once jobs already exist.

## Scripts and CLI

Scripts are declarative JSON, not arbitrary JavaScript or shell commands. Start the app first:

```powershell
npm start
# In another PowerShell window:
npm run automate -- docs/automation/example-script.json --watch
npm run automate -- --resume YOUR_SCRIPT_ID --watch
npm run automate -- --stop YOUR_SCRIPT_ID
```

The [example script](automation/example-script.json) selects private uploads and requires a connected channel. Change `posting` to `prepare` and `publishingEnabled` to `false` to run locally without credentials. In the UI, **Edit script JSON** exposes the same configuration; each saved workflow has a download button. Logs, prepared metadata, source jobs and remote video IDs appear in Automation.

## Reference-inspired templates

Context Hit, Word Punch, White Editorial, Reaction Context and Ranked Moments were designed after inspecting actual frames from the five supplied reference Shorts. Public previews use original graphics, manually timed words and synthetic audio; downloaded reference footage is kept out of Git and public assets. See [the research report](../reports/Reference%20edit%20automation.md).

The local template picker and Automation preview now include **Original reference / Template output** modes. Original mode streams the complete cached video without transcoding, trimming, cropping or replacing its audio. The sample controls and frame scrubber sit outside the picture. A timecoded observation list covers headline, captions, contextual labels, framing/color changes, graphics and source overlays, alongside the full video/audio streams. Original playback is the timing authority; inspection notes distinguish measured boundaries from estimates and are not editable original-project tracks. Missing originals can be loaded through the UI or `npm run setup:references`.

Ranked Moments builds a real countdown from **2–5 distinct selected clips**, sorted from lower selection score to higher. Those scores express local editing suitability, not an objective ranking of entertainment value. Edit the per-clip names and compilation title to make the series meaningful. The finished compilation must fit within three minutes; changing its inputs invalidates the prior download.

## Verification boundary

Verified locally: the full 44m12s supplied source (using its verified cached download), 4,523-word transcription, three exports and prepared metadata; all five new styles and original preview playback; real two- and three-clip countdowns; browser metadata editing/downloads; local FFmpeg segment finalization; a real public recorded-section download; and mock OAuth/resumable-upload recovery contracts.

Not verified against a real account: OAuth consent completion, quota behavior, private/public uploads or scheduled publishing. No active public live broadcast was used for an end-to-end network capture test; live lifecycle checks use a generated media fixture and injected finalized-segment provider. Upstream extraction and API availability can change. Google setup and channel authorization are the remaining user action before real posting.
