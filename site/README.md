# Static landing page

From the project root run `npm ci --cache .cache/npm`, then `npm run package:source`. This creates `site/downloads/open-clip-editor-source.zip` from Git-tracked source files; private work and keys are excluded. Regenerate it after changing tracked files.

Serve or upload the **complete `site/` directory**, including generated `downloads/`, as the static site root. It contains its own fonts, poster, GIF and MP4. No backend is required for this page. The app itself runs locally after the source is extracted and installed.

For GitHub Pages, use an Actions build that runs those commands and uploads `site/` with `actions/upload-pages-artifact`, then deploy that artifact using the repository's configured Pages environment. Publishing is a separate owner action. Pointing Pages directly at the repository branch will omit the ignored ZIP and break the download link.

The page is prepared locally, not published. The demo media is original graphics with synthetic audio and manually timed words; it demonstrates caption rendering rather than automatic selection.
