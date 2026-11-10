/**
 * A small, dependency-free HLS playlist parser.
 *
 * Supports the parts of RFC 8216 that matter for visualising a VOD
 * multivariant stream: master playlists, media playlists, segments,
 * byte ranges, init maps, keys, renditions and the usual metadata.
 */

const ATTRIBUTE_RE = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;

export function parseAttributes(input = '') {
  const attrs = {};
  let match;
  ATTRIBUTE_RE.lastIndex = 0;
  while ((match = ATTRIBUTE_RE.exec(input))) {
    let value = match[2].trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    attrs[match[1]] = value;
  }
  return attrs;
}

export function resolveUri(uri, baseUrl) {
  if (!uri) return '';
  try {
    return new URL(uri, baseUrl).href;
  } catch {
    return uri;
  }
}

export function parseResolution(value) {
  if (!value) return null;
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function parseCodecs(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((codec) => codec.trim())
    .filter(Boolean);
}

const CODEC_LABELS = [
  [/^avc1/i, 'H.264'],
  [/^hvc1|^hev1/i, 'HEVC'],
  [/^av01/i, 'AV1'],
  [/^vp09|^vp9/i, 'VP9'],
  [/^mp4a/i, 'AAC'],
  [/^ac-3/i, 'AC-3'],
  [/^ec-3/i, 'E-AC-3'],
  [/^opus/i, 'Opus'],
  [/^flac/i, 'FLAC'],
  [/^stpp/i, 'TTML'],
  [/^wvtt/i, 'WebVTT'],
];

export function codecLabel(codec) {
  for (const [pattern, label] of CODEC_LABELS) {
    if (pattern.test(codec)) return label;
  }
  return codec.split('.')[0].toUpperCase();
}

const VIDEO_CODECS = new Set(['H.264', 'HEVC', 'AV1', 'VP9']);
const AUDIO_CODECS = new Set(['AAC', 'AC-3', 'E-AC-3', 'Opus', 'FLAC']);

export function codecSummary(codecs) {
  const labels = [...new Set(codecs.map(codecLabel))];
  const weight = (label) => {
    if (VIDEO_CODECS.has(label)) return 0;
    if (AUDIO_CODECS.has(label)) return 1;
    return 2;
  };
  return labels.sort((a, b) => weight(a) - weight(b));
}

export function formatBitrate(bps) {
  if (!bps || Number.isNaN(Number(bps))) return '—';
  const value = Number(bps);
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(value / 1000)} kbps`;
}

export function variantLabel(variant) {
  if (!variant) return '—';
  const { name, resolution, bandwidth } = variant;
  if (name) {
    if (/^\d{3,4}$/.test(name)) return `${name}p`;
    return name;
  }
  if (resolution) return `${resolution.height}p`;
  if (!resolution && bandwidth) return 'Audio';
  return 'Variant';
}

export function variantDetail(variant) {
  if (!variant) return '';
  const parts = [];
  if (variant.resolution) parts.push(`${variant.resolution.width}×${variant.resolution.height}`);
  if (variant.frameRate) parts.push(`${Number(variant.frameRate).toFixed(Number(variant.frameRate) % 1 ? 2 : 0)} fps`);
  return parts.join(' · ');
}

/**
 * Parse a playlist body.
 * @param {string} text raw playlist text
 * @param {string} manifestUrl absolute URL used to resolve relative URIs
 */
export function parsePlaylist(text, manifestUrl) {
  const raw = String(text ?? '').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/);
  const isMaster = lines.some((line) => line.trimStart().startsWith('#EXT-X-STREAM-INF'));
  const base = isMaster ? parseMaster(lines, manifestUrl) : parseMedia(lines, manifestUrl);

  let version = null;
  let independentSegments = false;
  let start = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#EXT-X-VERSION:')) version = trimmed.slice('#EXT-X-VERSION:'.length).trim();
    else if (trimmed === '#EXT-X-INDEPENDENT-SEGMENTS') independentSegments = true;
    else if (trimmed.startsWith('#EXT-X-START:')) start = parseAttributes(trimmed.slice('#EXT-X-START:'.length));
  }

  return {
    type: isMaster ? 'master' : 'media',
    url: manifestUrl,
    raw,
    lines,
    lineCount: lines.length,
    size: byteLength(raw),
    version,
    independentSegments,
    start,
    ...base,
  };
}

function parseMaster(lines, manifestUrl) {
  const variants = [];
  const renditions = [];
  const sessionKeys = [];
  let pending = null;
  let pendingLine = -1;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('#EXT-X-STREAM-INF:')) {
      pending = parseAttributes(trimmed.slice('#EXT-X-STREAM-INF:'.length));
      pendingLine = index;
      return;
    }

    if (trimmed.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) {
      const attrs = parseAttributes(trimmed.slice('#EXT-X-I-FRAME-STREAM-INF:'.length));
      if (attrs.URI) {
        variants.push(buildVariant(attrs, attrs.URI, manifestUrl, index, index, true));
      }
      return;
    }

    if (trimmed.startsWith('#EXT-X-MEDIA:')) {
      const attrs = parseAttributes(trimmed.slice('#EXT-X-MEDIA:'.length));
      renditions.push({
        type: attrs.TYPE || 'AUDIO',
        groupId: attrs['GROUP-ID'] || '',
        name: attrs.NAME || '',
        language: attrs.LANGUAGE || '',
        isDefault: attrs.DEFAULT === 'YES',
        autoselect: attrs.AUTOSELECT === 'YES',
        forced: attrs.FORCED === 'YES',
        channels: attrs.CHANNELS || '',
        uri: attrs.URI || '',
        url: attrs.URI ? resolveUri(attrs.URI, manifestUrl) : '',
        line: index,
      });
      return;
    }

    if (trimmed.startsWith('#EXT-X-SESSION-KEY:')) {
      sessionKeys.push(parseAttributes(trimmed.slice('#EXT-X-SESSION-KEY:'.length)));
      return;
    }

    if (trimmed.startsWith('#')) return;

    if (pending) {
      variants.push(buildVariant(pending, trimmed, manifestUrl, pendingLine, index));
      pending = null;
      pendingLine = -1;
    }
  });

  // Present the ladder low → high; keep original playlist position for reference.
  variants.sort((a, b) => (a.bandwidth || 0) - (b.bandwidth || 0));
  variants.forEach((variant, index) => {
    variant.index = index;
  });

  return {
    variants,
    renditions,
    sessionKeys,
    summary: {
      variants: variants.length,
      audio: renditions.filter((r) => r.type === 'AUDIO').length,
      subtitles: renditions.filter((r) => r.type === 'SUBTITLES').length,
      closedCaptions: renditions.filter((r) => r.type === 'CLOSED-CAPTIONS').length,
    },
  };
}

function buildVariant(attrs, uri, manifestUrl, streamLine, uriLine, isIFrame = false) {
  const bandwidth = Number(attrs.BANDWIDTH) || 0;
  const averageBandwidth = Number(attrs['AVERAGE-BANDWIDTH']) || bandwidth;
  const resolution = parseResolution(attrs.RESOLUTION);
  const codecs = parseCodecs(attrs.CODECS);
  const name = attrs.NAME || '';

  return {
    index: -1,
    sourceIndex: -1,
    uri,
    url: resolveUri(uri, manifestUrl),
    attributes: attrs,
    bandwidth,
    averageBandwidth,
    resolution,
    codecs,
    codecLabels: codecSummary(codecs),
    frameRate: attrs['FRAME-RATE'] ? Number(attrs['FRAME-RATE']) : null,
    name,
    label: '',
    audioGroup: attrs.AUDIO || '',
    subtitleGroup: attrs.SUBTITLES || '',
    closedCaptions: attrs['CLOSED-CAPTIONS'] || '',
    videoRange: attrs['VIDEO-RANGE'] || '',
    programId: attrs['PROGRAM-ID'] || '',
    isIFrame,
    streamLine,
    uriLine,
  };
}

function parseMedia(lines, manifestUrl) {
  const segments = [];
  let mediaSequence = 0;
  let targetDuration = 0;
  let playlistType = '';
  let endList = false;
  let initSegment = null;
  let encryption = null;
  let discontinuity = false;
  let pendingRange = null;
  let pendingProgramDateTime = null;
  let pendingDuration = null;
  let pendingTitle = '';
  let pendingLine = -1;
  let segmentStart = 0;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('#EXTINF:')) {
      const body = trimmed.slice('#EXTINF:'.length);
      const comma = body.indexOf(',');
      const duration = comma === -1 ? body : body.slice(0, comma);
      pendingTitle = comma === -1 ? '' : body.slice(comma + 1).trim();
      pendingDuration = Number.parseFloat(duration);
      pendingLine = index;
      return;
    }

    if (trimmed.startsWith('#EXT-X-BYTERANGE:')) {
      const [length, offset] = trimmed.slice('#EXT-X-BYTERANGE:'.length).split('@');
      pendingRange = {
        length: Number(length),
        offset: offset === undefined ? null : Number(offset),
      };
      return;
    }

    if (trimmed === '#EXT-X-DISCONTINUITY') {
      discontinuity = true;
      return;
    }

    if (trimmed.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributes(trimmed.slice('#EXT-X-MAP:'.length));
      initSegment = {
        uri: attrs.URI || '',
        url: resolveUri(attrs.URI || '', manifestUrl),
        attributes: attrs,
      };
      return;
    }

    if (trimmed.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributes(trimmed.slice('#EXT-X-KEY:'.length));
      encryption = attrs.METHOD && attrs.METHOD !== 'NONE'
        ? { method: attrs.METHOD, keyFormat: attrs.KEYFORMAT || '', uri: attrs.URI || '' }
        : null;
      return;
    }

    if (trimmed.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = Number.parseInt(trimmed.slice('#EXT-X-MEDIA-SEQUENCE:'.length), 10) || 0;
      return;
    }

    if (trimmed.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = Number.parseFloat(trimmed.slice('#EXT-X-TARGETDURATION:'.length)) || 0;
      return;
    }

    if (trimmed.startsWith('#EXT-X-PLAYLIST-TYPE:')) {
      playlistType = trimmed.slice('#EXT-X-PLAYLIST-TYPE:'.length).trim();
      return;
    }

    if (trimmed === '#EXT-X-ENDLIST') {
      endList = true;
      return;
    }

    if (trimmed.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      pendingProgramDateTime = trimmed.slice('#EXT-X-PROGRAM-DATE-TIME:'.length).trim();
      return;
    }

    if (trimmed.startsWith('#')) return;

    const duration = pendingDuration ?? 0;
    segments.push({
      index: segments.length,
      sn: mediaSequence + segments.length,
      duration,
      title: pendingTitle,
      uri: trimmed,
      url: resolveUri(trimmed, manifestUrl),
      byteRange: pendingRange,
      discontinuity,
      programDateTime: pendingProgramDateTime,
      timestamp: pendingProgramDateTime ? Date.parse(pendingProgramDateTime) : null,
      line: pendingLine,
      start: segmentStart,
      end: segmentStart + duration,
      bytes: null,
      loadMs: null,
      state: 'queued',
    });

    segmentStart += duration;
    pendingDuration = null;
    pendingTitle = '';
    pendingRange = null;
    pendingProgramDateTime = null;
    pendingLine = -1;
    discontinuity = false;
  });

  const totalDuration = segments.reduce((sum, segment) => sum + segment.duration, 0);

  return {
    playlist: {
      mediaSequence,
      targetDuration,
      playlistType,
      endList,
      initSegment,
      encryption,
      segments,
      totalDuration,
      segmentCount: segments.length,
    },
  };
}

export function byteLength(text) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  return text.length;
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const value = Number(bytes);
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${Math.round(value)} B`;
}

export function formatDuration(seconds, { precise = false } = {}) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (precise) {
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}
