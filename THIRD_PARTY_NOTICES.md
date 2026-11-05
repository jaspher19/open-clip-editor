# Third-party notices

Original application code is MIT. This file does not replace upstream licenses. Runtime dependencies are installed separately, not relicensed by this project. Preserve their license files when distributing a built bundle or packaged executable.

| Component | License / source | Use |
| --- | --- | --- |
| FFmpeg / ffprobe | [LGPL/GPL depending on build](https://ffmpeg.org/legal.html) | External video/audio executable. The development machine's libx264-enabled build is GPL; no FFmpeg binary is bundled. Packaging a build requires its corresponding distribution obligations. |
| libass | [ISC](https://github.com/libass/libass) | Subtitle rendering in external FFmpeg. |
| faster-whisper | [MIT](https://github.com/SYSTRAN/faster-whisper/blob/master/LICENSE) | Local speech recognition. |
| CTranslate2 | [MIT](https://github.com/OpenNMT/CTranslate2/blob/master/LICENSE) | Inference runtime. |
| Whisper models | [MIT](https://github.com/openai/whisper/blob/main/LICENSE) | Downloaded on demand via faster-whisper; not bundled. |
| yt-dlp | [Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE) | Public video extraction. Python distribution used here. |
| yt-dlp-ejs | [Unlicense AND MIT AND ISC](https://github.com/yt-dlp/ejs) | JavaScript challenge support; transitive components retain their notices. |
| PyAV | [BSD-3-Clause](https://github.com/PyAV-Org/PyAV/blob/main/LICENSE.txt) | faster-whisper dependency. Its binary wheels can include FFmpeg libraries with their own notices. |
| MediaPipe | [Apache-2.0](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE) | Optional sampled face detection. |
| BlazeFace short-range weights | Apache-2.0, [Google model card](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf) | Optional download by `setup:faces`; no identity recognition. |
| opencv-contrib-python | [Apache-2.0 and bundled third-party notices](https://github.com/opencv/opencv-python/blob/4.x/LICENSE.txt) | Sampled frame decoding. |
| NumPy | [BSD-3-Clause](https://numpy.org/doc/stable/license.html) | Canonical audio samples and image arrays. |
| Express, multer, archiver | MIT | Local API, multipart upload and ZIP generation. See installed package LICENSE files. |
| React / React DOM | [MIT](https://github.com/facebook/react/blob/main/LICENSE) | Browser UI. |
| dotenv | BSD-2-Clause | Optional local environment configuration. |
| Lucide | [ISC](https://lucide.dev/license) | UI icons. |
| Vite / React plugin | MIT | Build tooling. |
| TypeScript / Playwright | Apache-2.0 | Type checking and local browser verification. |

Bundled fonts: **Work Sans** (Wei Huang and contributors) and **Red Hat Mono** (Red Hat and contributors) under SIL Open Font License 1.1. Full font notices accompany the fonts in `assets/fonts/`, `web/public/fonts/` and `site/media/`. They were copied from existing installed font assets; no reference-kit application code was copied.

The project does not bundle non-commercial model weights, MusicGen, downloaded YouTube media, user music, API keys, a Python environment or third-party executables. The release demo is original generated graphics and synthetic audio, with manually timed captions. Optional APIs have separate service terms and charges.

Additional bundled fonts for edit templates: **Anton** (Copyright 2020 The Anton Project Authors) and **Barlow Condensed Bold** (Copyright 2017 The Barlow Project Authors), both SIL Open Font License 1.1. Downloaded from the official [Anton](https://github.com/google/fonts/tree/main/ofl/anton) and [Barlow Condensed](https://github.com/google/fonts/tree/main/ofl/barlowcondensed) Google Fonts directories. Full OFL notices accompany server and browser copies. No vendor template projects, third-party videos or branding were copied; template demos use original graphics and synthetic audio.

Interface fonts for the comic theme: **Bangers** (Copyright 2010 The Bangers Project Authors) and **Comic Neue** Regular/Bold (Copyright 2014 The Comic Neue Project Authors), both SIL Open Font License 1.1, downloaded from the official [Bangers](https://github.com/google/fonts/tree/main/ofl/bangers) and [Comic Neue](https://github.com/google/fonts/tree/main/ofl/comicneue) Google Fonts directories. Their OFL notices are in `web/public/fonts/`.

Sound accents in `assets/sfx/` (6 soft pops, 6 impact hits): **"100 CC0 SFX"** and **"50 CC0 retro / synth SFX"** by rubberduck on OpenGameArt ([pack 1](https://opengameart.org/content/100-cc0-sfx), [pack 2](https://opengameart.org/content/50-cc0-retro-synth-sfx)), CC0 1.0 public-domain dedication. Converted to 48 kHz mono and peak-normalised; details in `assets/sfx/LICENSE.txt`.

Burned-in title font: **Montserrat** Black and ExtraBold (Copyright 2011 The Montserrat Project Authors), SIL Open Font License 1.1, downloaded from the official [Montserrat repository](https://github.com/JulietaUla/Montserrat). The OFL notice is `assets/fonts/Montserrat-OFL.txt`.

Example media in `docs/media/` (screenshots, GIF previews and MP4 examples) contains excerpts of **Tears of Steel**, (CC) Blender Foundation | mango.blender.org, licensed under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/). Changes: short excerpts, cropped to 9:16, re-encoded, with captions, titles, colour effects and original synthesized sounds added by OpenClip. The film itself is not bundled.
