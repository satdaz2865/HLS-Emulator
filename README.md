# PlaylistSim

A visual, zero-build HLS pipeline lab. Load a multivariant (master) M3U8 playlist and watch it move through each stage:

```
multivariant playlist → parsed variants → selected media playlist → segments → playback
```

A simulated telemetry stream runs alongside playback, emitting timestamped heartbeats with the current video and audio metadata.

## Run

```bash
npm start
# → http://localhost:4173
```

No build step and no runtime dependencies. [hls.js](https://github.com/video-dev/hls.js) 1.7.4 is vendored in `vendor/` so the page only needs a static server.

You can also serve the folder with any static file server, for example:

```bash
python3 -m http.server 4173
```

## What it does

- **Multivariant playlist** — fetches and parses the master playlist, with syntax-highlighted raw text and line-level highlighting for the selected variant.
- **Variant streams** — extracts every `#EXT-X-STREAM-INF` entry, sorted by bitrate, with resolution, codec, frame rate and bandwidth. Selecting one loads its media playlist. Audio-only, I-frame trick-play and still-image variants are filtered out of the selector.
- **Media playlist** — parses `#EXTINF` segments, target duration, sequence, byte ranges, init maps and encryption metadata, then renders a proportional segment ribbon and a detailed segment list.
- **Playback output** — plays the selected variant with hls.js and mirrors real fragment events: `FRAG_LOADING`, `FRAG_LOADED`, `BUFFER_APPENDED`, `FRAG_CHANGED`. The current segment, buffer, transfer rate and lifecycle (fetch → parse → append → play) update in real time. When a variant uses separate `EXT-X-MEDIA` audio and the browser can decode it, the master is loaded and the selected level is pinned; otherwise a PROXY fallback is used.
- **Event stream** — a timestamped log of playlist, fragment and buffer activity, plus recovery attempts.
- **Telemetry heartbeats** — a separate event table emitting a heartbeat every 2 seconds while a variant is selected:

  | field | values |
  | --- | --- |
  | `currentResolution` | e.g. `1280x720` |
  | `currentAudioChannels` | `2`, `6`, `10`, `16` |
  | `currentVideoRange` | `SDR`, `HDR10`, `HDR10_PLUS`, `DOLBY_VISION` |
  | `currentVideoCodec` | `h.264`, `h.265`, `vp9`, `av1` |
  | `currentAudioType` | `STEREO`, `SURROUND`, `ATMOS`, `DTS-X` |
  | `currentAudioCodec` | `aac`, `ec-3`, `ec3-joc`, `dtsx-ps2` |

  Values are derived from the active variant's `RESOLUTION`, `VIDEO-RANGE`, `CODECS`, `SUPPLEMENTAL-CODECS` and matching `EXT-X-MEDIA` audio renditions. Each row has a millisecond timestamp; switching variants keeps the history and highlights the fields that changed in the next heartbeat.

## Test streams

All presets are public, CORS-enabled, clear (non-DRM) test streams:

- **Big Buck Bunny** — Mux test stream, 5 variants, MPEG-TS.
  `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`
- **Apple BipBop 4×3** — Apple HLS example stream, 5 variants.
  `https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8`
- **Tears of Steel** — Unified Streaming demo, 5 video variants (+ audio-only renditions, hidden from the selector).
  `https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8`
- **Apple HDR/Atmos demo** — a curated 11-variant master that combines Apple's public “Apple TV Trailer Advanced” and AV1 assets. It is included as `presets/apple-hdr-atmos.m3u8` and is the quickest way to see every telemetry field change:

  | select | resolution | audio | range | video codec | audio type | audio codec |
  | --- | --- | --- | --- | --- | --- | --- |
  | `SDR AVC AAC` | 1920x1080 | 2 | SDR | h.264 | STEREO | aac |
  | `SDR AVC AC3` | 1920x1080 | 6 | SDR | h.264 | SURROUND | ec-3 |
  | `SDR AVC ATMOS` | 1920x1080 | 16 | SDR | h.264 | ATMOS | ec3-joc |
  | `SDR HEVC AAC` | 1920x1080 | 2 | SDR | h.265 | STEREO | aac |
  | `HDR10 HEVC AAC` | 1920x1080 | 2 | HDR10 | h.265 | STEREO | aac |
  | `HDR10 HEVC ATMOS` | 1920x1080 | 16 | HDR10 | h.265 | ATMOS | ec3-joc |
  | `DV ATMOS` | 1920x1080 | 16 | DOLBY_VISION | h.265 | ATMOS | ec3-joc |
  | `4K DV ATMOS` | 3840x2160 | 16 | DOLBY_VISION | h.265 | ATMOS | ec3-joc |
  | `AV1 SDR AAC` | 1920x1080 | 2 | SDR | av1 | STEREO | aac |
  | `AV1 SDR AC3` | 1920x1080 | 6 | SDR | av1 | SURROUND | ec-3 |
  | `AV1 SDR ATMOS` | 1920x1080 | 16 | SDR | av1 | ATMOS | ec3-joc |

  The unsuffixed `Apple TV Trailer Advanced` master (100 video variants, same assets plus many more renditions) is available at:
  `https://devstreaming-cdn.apple.com/videos/streaming/examples/adv_dv_atmos/main.m3u8`

Additional official Apple test masters that exercise audio/codec changes:

- **Apple BipBop Advanced (TS)** — 24 video variants; `.ts` chunks, AVC, AAC stereo / AC-3 5.1 / E-AC-3 audio groups.
  `https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8`
- **Apple BipBop Advanced (fMP4)** — 24 video variants; same audio groups, CMAF/fMP4 chunks.
  `https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8`
- **Apple BipBop HEVC** — 54 video variants; AVC + HEVC across AAC/AC-3/E-AC-3 groups.
  `https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_example_hevc/master.m3u8`
- **Apple TV Trailer Basic (AV1)** — 65 video variants; AV1 SDR across AAC/AC-3/E-AC-3 groups.
  `https://devstreaming-cdn.apple.com/videos/streaming/examples/av1-sample/av1-sample.m3u8`

## Browser playback proxy

The demo browser is Chromium, which does not decode Dolby Vision or AC-3/E-AC-3, and its HEVC/HDR playback is unreliable. To keep the flow visible:

- The player badge changes to **PROXY** and the event stream names the proxy when the selected variant's codecs cannot be played by this browser.
- The app plays a browser-compatible sibling from the same master (SDR H.264 or AV1 video + AAC audio), while the heartbeat table continues to report the selected variant's manifest metadata.
- This is a demo aid, not true HDR10/Dolby Vision/Atmos playback. Use Safari, a Dolby Vision/Atmos-capable Android device, or a hardware decoder to validate the real media.

HLS is not Apple-only: Android Media3/ExoPlayer plays standard HLS with TS or fMP4 chunks, alternate audio groups, HEVC, AV1 and Dolby Vision when the device supports them. “Multi-master” is not an HLS tag — it usually means publishing multiple top-level master playlists for device/codec profiles (for example an SDR/AAC master and an HDR/Atmos master). This app loads one master at a time; the preset selector is a simple way to emulate profile-specific masters.

You can load any CORS-accessible master playlist with the URL field. Playback starts muted so autoplay is allowed; use the speaker button in the player to unmute.

## Notes

- The visualiser is VOD-focused. Live playlists parse, but the segment table is built once rather than refreshed on playlist reload.
- hls.js handles TS → fMP4 transmuxing through Media Source Extensions, so any codec/container combination the host browser and hls.js support will play. HEVC, Dolby Vision and AC-3/Atmos support depends on the browser and OS: Chrome on macOS can play some HEVC variants but typically won't decode Dolby Vision or AC-3/E-AC-3. The heartbeat table is manifest-derived, so it still reports the selected variant's values when the player cannot decode that codec.
- When a variant references a separate `EXT-X-MEDIA` audio group and the browser can decode that audio codec, the player loads the master and pins the selected level so the audio rendition is included. If the codec is unsupported, it falls back to the video-only media playlist and logs a warning.
- Audio channel, type and codec telemetry is inferred from the manifest. When HLS omits `CHANNELS`, the values fall back to a codec-based mapping (AAC → stereo/aac, E-AC-3 → 5.1/ec-3, etc.). `CHANNELS="16/JOC"` is treated as Dolby Atmos. This is simulated telemetry, not data from a real analytics SDK.
- The playlist host must send `Access-Control-Allow-Origin`; otherwise the fetch fails in the browser.

## Structure

```
index.html              layout and panels
styles.css              dashboard theme and responsive layout
js/parser.js            dependency-free M3U8/master + media playlist parser
js/app.js               state machine, rendering, hls.js integration, heartbeats
presets/apple-hdr-atmos.m3u8  curated HDR/Atmos master (Apple test assets)
vendor/hls.min.js       hls.js 1.7.4 (Apache-2.0)
vendor/hls.js.LICENSE   hls.js license
server.mjs              tiny zero-dependency static server
```

## Credits

- [hls.js](https://github.com/video-dev/hls.js) — Apache-2.0.
- Test content: Big Buck Bunny and Tears of Steel © Blender Foundation (CC BY 3.0); Apple BipBop and the Apple TV Trailer are Apple's public HLS example content. `presets/apple-hdr-atmos.m3u8` is a curated master pointing at the public Apple CDN test assets; the media itself is not redistributed here.
- The presets link to third-party test hosting.
