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
- **Variant streams** — extracts every `#EXT-X-STREAM-INF` entry, sorted by bitrate, with resolution, codec, frame rate and bandwidth. Selecting one loads its media playlist. Audio-only variants are filtered out of the selector.
- **Media playlist** — parses `#EXTINF` segments, target duration, sequence, byte ranges, init maps and encryption metadata, then renders a proportional segment ribbon and a detailed segment list.
- **Playback output** — plays the selected variant with hls.js and mirrors real fragment events: `FRAG_LOADING`, `FRAG_LOADED`, `BUFFER_APPENDED`, `FRAG_CHANGED`. The current segment, buffer, transfer rate and lifecycle (fetch → parse → append → play) update in real time.
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

You can load any CORS-accessible master playlist with the URL field. Playback starts muted so autoplay is allowed; use the speaker button in the player to unmute.

## Notes

- The visualiser is VOD-focused. Live playlists parse, but the segment table is built once rather than refreshed on playlist reload.
- hls.js handles TS → fMP4 transmuxing through Media Source Extensions, so any codec/container combination the host browser and hls.js support will play.
- Audio channel, type and codec telemetry is inferred from the manifest. When HLS omits `CHANNELS`, the values fall back to a codec-based mapping (AAC → stereo/aac, E-AC-3 → 5.1/ec-3, etc.). This is simulated telemetry, not data from a real analytics SDK.
- The playlist host must send `Access-Control-Allow-Origin`; otherwise the fetch fails in the browser.

## Structure

```
index.html              layout and panels
styles.css              dashboard theme and responsive layout
js/parser.js            dependency-free M3U8/master + media playlist parser
js/app.js               state machine, rendering, hls.js integration, heartbeats
vendor/hls.min.js       hls.js 1.7.4 (Apache-2.0)
vendor/hls.js.LICENSE   hls.js license
server.mjs              tiny zero-dependency static server
```

## Credits

- [hls.js](https://github.com/video-dev/hls.js) — Apache-2.0.
- Test content: Big Buck Bunny and Tears of Steel © Blender Foundation (CC BY 3.0); Apple BipBop is Apple's public HLS example content. The presets link to third-party test hosting.
