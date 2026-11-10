import {
  parsePlaylist,
  variantLabel,
  variantDetail,
  formatBitrate,
  formatBytes,
  formatDuration,
  byteLength,
} from './parser.js';

const Hls = window.Hls;
const $ = (id) => document.getElementById(id);

const els = {
  statusPill: $('statusPill'),
  statusText: $('statusText'),
  sourceUrl: $('sourceUrl'),
  loadBtn: $('loadBtn'),
  presetSelect: $('presetSelect'),
  pipeInput: $('pipeInput'),
  pipeParse: $('pipeParse'),
  pipeSelect: $('pipeSelect'),
  pipePlay: $('pipePlay'),
  manifestBadge: $('manifestBadge'),
  manifestSize: $('manifestSize'),
  tabMaster: $('tabMaster'),
  tabMedia: $('tabMedia'),
  copyCode: $('copyCode'),
  codeScroll: $('codeScroll'),
  codeView: $('codeView'),
  sourceFoot: $('sourceFoot'),
  sourceMeta: $('sourceMeta'),
  variantList: $('variantList'),
  variantCount: $('variantCount'),
  variantFoot: $('variantFoot'),
  renditionChips: $('renditionChips'),
  connectorSelect: $('connectorSelect'),
  segmentCount: $('segmentCount'),
  selectedTag: $('selectedTag'),
  segmentMeta: $('segmentMeta'),
  segmentRibbon: $('segmentRibbon'),
  ribbonPlayhead: $('ribbonPlayhead'),
  ribbonSkeleton: $('ribbonSkeleton'),
  legendTime: $('legendTime'),
  segmentList: $('segmentList'),
  playerShell: $('playerShell'),
  video: $('video'),
  playerPlaceholder: $('playerPlaceholder'),
  playerVariant: $('playerVariant'),
  playerState: $('playerState'),
  liveDot: $('liveDot'),
  playOverlay: $('playOverlay'),
  playBtn: $('playBtn'),
  curTime: $('curTime'),
  durTime: $('durTime'),
  seek: $('seek'),
  seekBuffer: $('seekBuffer'),
  seekProgress: $('seekProgress'),
  seekThumb: $('seekThumb'),
  muteBtn: $('muteBtn'),
  fsBtn: $('fsBtn'),
  nowSn: $('nowSn'),
  nowFile: $('nowFile'),
  nowDuration: $('nowDuration'),
  nowBytes: $('nowBytes'),
  nowBitrate: $('nowBitrate'),
  lifecycle: $('lifecycle'),
  statBuffer: $('statBuffer'),
  statBytes: $('statBytes'),
  statRate: $('statRate'),
  statDrops: $('statDrops'),
  log: $('log'),
  logCount: $('logCount'),
  clearLog: $('clearLog'),
  heartbeatCount: $('heartbeatCount'),
  heartbeatLive: $('heartbeatLive'),
  heartbeatVariant: $('heartbeatVariant'),
  heartbeatScroll: $('heartbeatScroll'),
  heartbeatTable: $('heartbeatTable'),
  toast: $('toast'),
};

const state = {
  master: null,
  masterUrl: '',
  masterText: '',
  selectedIndex: -1,
  pendingIndex: -1,
  variant: null,
  media: null,
  mediaText: '',
  mediaUrl: '',
  hls: null,
  playlist: null,
  variantEls: [],
  segmentEls: new Map(),
  ribbonEls: new Map(),
  currentSeg: null,
  currentRowEl: null,
  activeTab: 'master',
  muted: true,
  switching: false,
  loadingMaster: false,
  recoveries: 0,
  autoScrollBlockedUntil: 0,
  toastTimer: null,
  pendingResume: 0,
  heartbeatTimer: null,
  heartbeatSeq: 0,
  lastTelemetry: null,
};

const SEGMENT_STATE_ORDER = { queued: 0, loading: 1, loaded: 2, buffered: 3, playing: 4, played: 5 };
const SEGMENT_STATE_LABEL = {
  queued: 'queued',
  loading: 'fetching',
  loaded: 'loaded',
  buffered: 'buffered',
  playing: 'playing',
  played: 'played',
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function pad(value, size = 3) {
  return String(value).padStart(size, '0');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function shortUri(uri) {
  if (!uri) return '';
  const clean = uri.split('?')[0];
  return clean.split('/').slice(-2).join('/');
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function normalizeUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) throw new Error('Enter a playlist URL first.');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return new URL(trimmed, window.location.href).href;
  }
  return `https://${trimmed}`;
}

function setStatus(kind, text) {
  els.statusPill.dataset.status = kind;
  els.statusText.textContent = text;
}

function setStage(name, kind, value) {
  const node = document.querySelector(`.stage[data-stage="${name}"]`);
  if (!node) return;
  node.dataset.state = kind;
  if (value !== undefined) {
    const valueEl = node.querySelector('.stage-value');
    valueEl.textContent = value;
    valueEl.title = value;
  }
}

function setSourceFoot(kind, text) {
  els.sourceFoot.replaceChildren();
  const dot = document.createElement('span');
  dot.className = `dot ${kind}`;
  els.sourceFoot.append(dot, document.createTextNode(` ${text}`));
}

function setTabLabel(tab, text) {
  tab.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'tab-dot';
  tab.append(dot, document.createTextNode(text));
}

function showToast(message, kind = 'error') {
  els.toast.classList.toggle('is-ok', kind === 'ok');
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 5200);
}

function log(kind, text) {
  clearEmptyLog();
  const now = new Date();
  const time = `${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, '0')}`;
  const nearBottom = els.log.scrollHeight - els.log.scrollTop - els.log.clientHeight < 28;

  const line = document.createElement('div');
  line.className = 'log-line';
  line.dataset.kind = kind;

  const timeEl = document.createElement('span');
  timeEl.className = 'log-time';
  timeEl.textContent = time;

  const kindEl = document.createElement('span');
  kindEl.className = 'log-kind';
  kindEl.textContent = kind.toUpperCase();

  const textEl = document.createElement('span');
  textEl.className = 'log-text';
  textEl.textContent = text;

  line.append(timeEl, kindEl, textEl);
  line.title = `${time}  ${text}`;
  els.log.append(line);

  while (els.log.childElementCount > 140) {
    els.log.firstElementChild?.remove();
  }
  const count = els.log.querySelectorAll('.log-line').length;
  els.logCount.textContent = String(count);

  if (nearBottom) els.log.scrollTop = els.log.scrollHeight;
}

function clearEmptyLog() {
  els.log.querySelector('.log-empty')?.remove();
}

/* ------------------------------------------------------------------ */
/* code rendering                                                      */
/* ------------------------------------------------------------------ */

function highlightLine(line) {
  if (!line.trim()) return '&nbsp;';

  if (!line.startsWith('#')) {
    return `<span class="tok-uri">${escapeHtml(line)}</span>`;
  }
  if (line.startsWith('##')) {
    return `<span class="tok-comment">${escapeHtml(line)}</span>`;
  }

  if (line.startsWith('#EXTINF:')) {
    const body = line.slice('#EXTINF:'.length);
    const comma = body.indexOf(',');
    if (comma >= 0) {
      return `<span class="tok-tag">#EXTINF</span>:<span class="tok-val">${escapeHtml(body.slice(0, comma))}</span>,<span class="tok-comment">${escapeHtml(body.slice(comma + 1))}</span>`;
    }
    return `<span class="tok-tag">#EXTINF</span>:<span class="tok-val">${escapeHtml(body)}</span>`;
  }

  const colon = line.indexOf(':');
  if (colon < 0) {
    return `<span class="tok-tag">${escapeHtml(line)}</span>`;
  }

  const tag = `<span class="tok-tag">${escapeHtml(line.slice(0, colon))}</span>`;
  const rest = line.slice(colon + 1);

  if (!/[A-Z0-9-]+=/.test(rest)) {
    return `${tag}:<span class="tok-val">${escapeHtml(rest)}</span>`;
  }

  let out = '';
  let last = 0;
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let match;
  while ((match = re.exec(rest))) {
    out += escapeHtml(rest.slice(last, match.index));
    const value = match[2];
    const valueClass = value.startsWith('"') ? 'tok-str' : 'tok-val';
    out += `<span class="tok-attr">${escapeHtml(match[1])}</span>=<span class="${valueClass}">${escapeHtml(value)}</span>`;
    last = match.index + match[0].length;
  }
  out += escapeHtml(rest.slice(last));
  return `${tag}:${out}`;
}

function renderCode(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const fragment = document.createDocumentFragment();

  lines.forEach((line, index) => {
    const row = document.createElement('div');
    row.className = 'code-line';
    row.dataset.line = String(index);

    const number = document.createElement('span');
    number.className = 'ln';
    number.textContent = String(index + 1);

    const content = document.createElement('span');
    content.className = 'lc';
    content.innerHTML = highlightLine(line);

    row.append(number, content);
    fragment.append(row);
  });

  els.codeView.replaceChildren(fragment);
  els.codeScroll.scrollTop = 0;
}

function renderCodeTab() {
  const useMedia = state.activeTab === 'media';
  const text = useMedia ? state.media?.raw : state.masterText;

  els.tabMaster.classList.toggle('is-active', !useMedia);
  els.tabMaster.setAttribute('aria-selected', String(!useMedia));
  els.tabMedia.classList.toggle('is-active', useMedia);
  els.tabMedia.setAttribute('aria-selected', String(useMedia));

  if (!text) {
    els.codeView.innerHTML = '<div class="code-empty"><p>No playlist loaded.</p></div>';
    return;
  }

  renderCode(text);

  if (useMedia) {
    highlightMediaLine();
    scrollToMediaLine();
  } else {
    highlightVariantLines();
  }
}

function highlightVariantLines() {
  if (state.activeTab !== 'master') return;
  els.codeView.querySelectorAll('.code-line.hl').forEach((node) => node.classList.remove('hl'));
  if (!state.variant || state.variant.isDirect) return;
  const lines = [state.variant.streamLine, state.variant.uriLine];
  for (const index of lines) {
    if (index == null || index < 0) continue;
    els.codeView.querySelector(`.code-line[data-line="${index}"]`)?.classList.add('hl');
  }
}

function highlightMediaLine() {
  if (state.activeTab !== 'media') return;
  els.codeView.querySelectorAll('.code-line.hl').forEach((node) => node.classList.remove('hl'));
  if (!state.currentSeg || state.currentSeg.line == null) return;
  const line = state.currentSeg.line;
  for (const index of [line, line + 1]) {
    els.codeView.querySelector(`.code-line[data-line="${index}"]`)?.classList.add('hl');
  }
}

function scrollToMediaLine() {
  if (state.activeTab !== 'media' || !state.currentSeg) return;
  const line = els.codeView.querySelector(`.code-line[data-line="${state.currentSeg.line}"]`);
  if (!line) return;
  const lineTop = line.getBoundingClientRect().top
    - els.codeScroll.getBoundingClientRect().top
    + els.codeScroll.scrollTop;
  els.codeScroll.scrollTo({
    top: Math.max(0, lineTop - els.codeScroll.clientHeight / 2 + 30),
    behavior: 'smooth',
  });
}

function scrollToVariantLines() {
  if (state.activeTab !== 'master' || !state.variant) return;
  const line = els.codeView.querySelector(`.code-line[data-line="${state.variant.streamLine}"]`);
  if (!line) return;
  const lineTop = line.getBoundingClientRect().top
    - els.codeScroll.getBoundingClientRect().top
    + els.codeScroll.scrollTop;
  const top = lineTop - els.codeScroll.clientHeight / 2 + 40;
  if (top > 0 && Math.abs(els.codeScroll.scrollTop - top) > 60) {
    els.codeScroll.scrollTo({ top, behavior: 'smooth' });
  }
}

/* ------------------------------------------------------------------ */
/* fetching                                                            */
/* ------------------------------------------------------------------ */

class HttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

async function fetchPlaylist(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      mode: 'cors',
    });
    if (!response.ok) throw new HttpError(response.status);
    const text = await response.text();
    return {
      text,
      url: response.url || url,
      ms: Math.round(performance.now() - started),
      size: byteLength(text),
    };
  } finally {
    clearTimeout(timer);
  }
}

function describeFetchError(error, url) {
  if (error.name === 'AbortError') return `Timed out after 15s while fetching ${hostOf(url)}.`;
  if (error instanceof HttpError) return `Playlist request failed with HTTP ${error.status}.`;
  if (error instanceof TypeError) {
    return `Could not fetch ${hostOf(url)}. The host may block browser CORS requests or the URL may be wrong.`;
  }
  return error.message || 'Unknown playlist error.';
}

/* ------------------------------------------------------------------ */
/* master playlist                                                     */
/* ------------------------------------------------------------------ */

function resetPlayback() {
  destroyHls();
  try {
    els.video.pause();
    els.video.removeAttribute('src');
    els.video.load();
  } catch {
    /* noop */
  }

  els.playerShell.classList.remove('has-source', 'is-playing', 'is-muted', 'is-audio-only');
  els.playerShell.classList.add('is-muted');
  const placeholderTitle = els.playerPlaceholder?.querySelector('p');
  const placeholderSub = els.playerPlaceholder?.querySelector('span');
  if (placeholderTitle) placeholderTitle.textContent = 'Select a variant to start playback';
  if (placeholderSub) placeholderSub.textContent = 'Segments will stream into this window';
  els.video.muted = true;
  state.muted = true;
  state.currentSeg = null;
  state.currentRowEl = null;

  els.playerVariant.textContent = 'no variant';
  els.playerState.textContent = 'idle';
  els.liveDot.classList.remove('is-live');
  els.playOverlay.style.display = '';

  els.curTime.textContent = '0:00';
  els.durTime.textContent = '0:00';
  els.seekProgress.style.width = '0%';
  els.seekBuffer.style.width = '0%';
  els.seekThumb.style.left = '0%';
  els.ribbonPlayhead.parentElement.classList.remove('has-progress');

  resetNowCard('No segment yet');
  els.statBuffer.textContent = '—';
  els.statBytes.textContent = '—';
  els.statRate.textContent = '—';
  els.statDrops.textContent = '0';

  state.playlist = null;
  state.media = null;
  state.mediaText = '';
  state.variant = null;
  state.selectedIndex = -1;
  state.pendingIndex = -1;
  state.currentSn = null;
  state.pendingResume = 0;

  setStage('select', 'idle', '—');
  setStage('play', 'idle', '—');
  els.connectorSelect.classList.remove('is-active');
  els.selectedTag.textContent = 'no selection';
  els.selectedTag.classList.remove('tag-accent');

  els.tabMedia.disabled = true;
  setTabLabel(els.tabMedia, 'media.m3u8');
  els.tabMedia.title = '';

  resetHeartbeats();
}

function resetSegmentPanel(message = 'Select a variant to load its segment timeline.') {
  els.segmentCount.textContent = '0';
  els.segmentMeta.innerHTML = [
    '<span class="meta-chip"><i>target</i> —</span>',
    '<span class="meta-chip"><i>duration</i> —</span>',
    '<span class="meta-chip"><i>type</i> —</span>',
    '<span class="meta-chip"><i>sequence</i> —</span>',
    '<span class="meta-chip meta-end"><i>endlist</i> —</span>',
  ].join('');
  els.segmentRibbon.replaceChildren();
  els.segmentList.innerHTML = `<div class="empty-state compact"><p>${escapeHtml(message)}</p></div>`;
  els.ribbonSkeleton.classList.remove('is-hidden');
  els.legendTime.textContent = '0:00 · 0:00';
  els.ribbonPlayhead.style.left = '0%';
  els.ribbonPlayhead.parentElement.classList.remove('has-progress');
  state.segmentEls.clear();
  state.ribbonEls.clear();
}

function renderMasterLoading() {
  els.manifestBadge.textContent = 'M3U8';
  els.manifestSize.textContent = '—';
  els.manifestBadge.classList.remove('tag-accent');
  els.sourceMeta.textContent = '—';
  els.variantCount.textContent = '0';
  els.variantList.innerHTML = `
    <div class="empty-state">
      <span class="pulse-ring"></span>
      <p>Fetching and parsing the playlist…</p>
      <span>Reading <code>#EXT-X-STREAM-INF</code> entries.</span>
    </div>`;
  els.variantFoot.textContent = 'parsing…';
  els.renditionChips.replaceChildren();
  els.selectedTag.textContent = 'no selection';
  resetSegmentPanel('Waiting for a variant selection…');
  els.connectorSelect.classList.remove('is-active');

  const skeleton = document.createElement('div');
  skeleton.className = 'code-skeleton';
  const widths = [34, 58, 46, 72, 40, 66, 52, 78, 44, 62, 36, 70];
  for (const width of widths) {
    const line = document.createElement('div');
    line.className = 'sk-line';
    line.style.width = `${width}%`;
    skeleton.append(line);
  }
  els.codeView.replaceChildren(skeleton);
}

function isAudioOnlyVariant(variant) {
  if (!variant || variant.isDirect || variant.resolution) return false;
  const codecs = variant.codecs || [];
  if (!codecs.length) return false;
  return codecs.every((codec) => /^(mp4a|ac-3|ec-3|opus|flac|dts)/i.test(codec));
}

function renderMaster(parsed, fetched) {
  const isMaster = parsed.type === 'master';
  let variants = parsed.variants || [];

  // Audio-only renditions are playlists without a video track; keep the
  // selector focused on video variants (unless a master is audio-only).
  if (isMaster) {
    const videoVariants = variants.filter((variant) => !isAudioOnlyVariant(variant));
    if (videoVariants.length) {
      variants = videoVariants;
      variants.forEach((variant, index) => {
        variant.index = index;
      });
      parsed.variants = variants;
      if (parsed.summary) parsed.summary.variants = variants.length;
    }
  }

  if (!isMaster) {
    const label = 'Direct media';
    variants = [{
      index: 0,
      uri: parsed.url,
      url: parsed.url,
      bandwidth: 0,
      averageBandwidth: 0,
      resolution: null,
      codecs: [],
      codecLabels: [],
      frameRate: null,
      name: label,
      audioGroup: '',
      subtitleGroup: '',
      closedCaptions: '',
      attributes: {},
      streamLine: 0,
      uriLine: 0,
      isDirect: true,
    }];
    parsed.variants = variants;
    parsed.summary = { variants: 1, audio: 0, subtitles: 0, closedCaptions: 0 };
  }

  state.master = parsed;
  state.masterUrl = fetched.url || parsed.url;
  state.masterText = parsed.raw;
  state.selectedIndex = -1;
  state.pendingIndex = -1;
  state.variant = null;
  state.media = null;
  state.mediaText = '';
  state.activeTab = 'master';

  els.sourceUrl.value = state.masterUrl;
  els.manifestBadge.textContent = isMaster ? 'MASTER' : 'MEDIA';
  els.manifestBadge.classList.toggle('tag-accent', isMaster);
  els.manifestSize.textContent = formatBytes(fetched.size);
  els.sourceMeta.textContent = `${hostOf(state.masterUrl)} · ${formatBytes(fetched.size)} · ${fetched.ms} ms`;
  els.sourceMeta.title = state.masterUrl;
  setSourceFoot('ok', `${parsed.lineCount} lines · ${variants.length} ${variants.length === 1 ? 'variant' : 'variants'}`);

  setTabLabel(els.tabMaster, isMaster ? 'master.m3u8' : 'playlist.m3u8');
  els.tabMaster.title = state.masterUrl;
  els.tabMedia.disabled = true;
  setTabLabel(els.tabMedia, 'media.m3u8');
  els.tabMedia.title = '';
  els.activeTab = 'master';
  renderCodeTab();

  setStage('input', 'done', hostOf(state.masterUrl));
  setStage('parse', 'done', isMaster ? `${variants.length} variants` : 'media playlist');

  renderVariants();
  resetSegmentPanel();
  els.connectorSelect.classList.remove('is-active');

  setStatus('ready', 'ready');
  els.playerState.textContent = 'ready';

  log(
    'manifest',
    `${isMaster ? 'master' : 'media'} parsed · ${variants.length} variant${variants.length === 1 ? '' : 's'} · ${fetched.ms} ms`,
  );

  if (state.activeTab === 'master') {
    requestAnimationFrame(scrollToVariantLines);
  }
}

function renderVariants() {
  const variants = state.master?.variants || [];
  els.variantList.replaceChildren();
  state.variantEls = [];

  els.variantCount.textContent = String(variants.length);
  els.variantFoot.textContent = variants.length
    ? `${variants.length} ${variants.length === 1 ? 'variant' : 'variants'} · sorted low → high`
    : 'no variants parsed';

  const renderChips = [];
  const summary = state.master?.summary || {};
  if (summary.audio) renderChips.push(`${summary.audio} audio`);
  if (summary.subtitles) renderChips.push(`${summary.subtitles} sub`);
  if (summary.closedCaptions) renderChips.push(`${summary.closedCaptions} cc`);
  els.renditionChips.replaceChildren();
  for (const text of renderChips) {
    const chip = document.createElement('span');
    chip.className = 'mini-chip';
    chip.textContent = text;
    els.renditionChips.append(chip);
  }

  if (!variants.length) {
    els.variantList.innerHTML = `
      <div class="empty-state">
        <p>No variants were found in this playlist.</p>
        <span>Try a master playlist containing <code>#EXT-X-STREAM-INF</code> entries.</span>
      </div>`;
    return;
  }

  const maxBandwidth = Math.max(...variants.map((variant) => variant.bandwidth || 0), 1);

  variants.forEach((variant, index) => {
    const label = variantLabel(variant);
    const detail = variantDetail(variant);
    const isAudio = !variant.resolution && !variant.isDirect && variant.bandwidth > 0;
    const codecText = variant.codecLabels?.length ? variant.codecLabels.join(' · ') : 'codec not listed';
    const subText = [codecText];
    if (variant.videoRange) subText.push(variant.videoRange);
    if (variant.audioGroup && !isAudio) subText.push(`audio: ${variant.audioGroup}`);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'variant';
    button.dataset.index = String(variant.index);
    button.style.animationDelay = `${index * 34}ms`;
    button.title = [
      variant.url,
      variant.codecs?.length ? `codecs: ${variant.codecs.join(', ')}` : '',
      variant.bandwidth ? `bandwidth: ${formatBitrate(variant.bandwidth)}` : '',
    ].filter(Boolean).join('\n');
    button.innerHTML = `
      <span class="v-index"></span>
      <span class="v-main">
        <span class="v-title">
          <span class="v-name"></span>
          <span class="v-res"></span>
          <span class="v-flag" hidden></span>
        </span>
        <span class="v-sub"><span class="v-codec"></span></span>
      </span>
      <span class="v-side">
        <span class="v-rate"></span>
        <span class="v-meter"><i></i></span>
      </span>
      <span class="v-arrow" aria-hidden="true">→</span>`;

    button.querySelector('.v-index').textContent = pad(index + 1, 2);
    button.querySelector('.v-name').textContent = label;
    button.querySelector('.v-res').textContent = detail;
    button.querySelector('.v-codec').textContent = subText.join(' · ');

    const flag = button.querySelector('.v-flag');
    if (variant.isDirect) {
      flag.hidden = false;
      flag.textContent = 'single';
    } else if (isAudio) {
      flag.hidden = false;
      flag.textContent = 'audio';
      flag.classList.add('audio');
    }

    const rate = button.querySelector('.v-rate');
    rate.innerHTML = variant.bandwidth
      ? `${(variant.bandwidth / 1_000_000).toFixed(2)} <em>Mbps</em>`
      : '—';
    button.querySelector('.v-meter i').style.width = `${Math.round(((variant.bandwidth || 0) / maxBandwidth) * 100)}%`;

    button.addEventListener('click', () => selectVariant(index));
    els.variantList.append(button);
    state.variantEls.push(button);
  });

  paintSelection();
}

function paintSelection() {
  const active = state.pendingIndex >= 0 ? state.pendingIndex : state.selectedIndex;
  state.variantEls.forEach((button, index) => {
    button.classList.toggle('is-selected', index === active);
    button.classList.toggle('is-loading', index === state.pendingIndex);
    button.setAttribute('aria-pressed', String(index === state.selectedIndex));
  });
}

/* ------------------------------------------------------------------ */
/* media playlist + segments                                           */
/* ------------------------------------------------------------------ */

function renderMedia(parsed) {
  const playlist = parsed.playlist;
  const segmentCount = playlist.segmentCount;
  const endChip = playlist.endList
    ? '<span class="meta-chip meta-end is-yes"><i>endlist</i> yes</span>'
    : '<span class="meta-chip meta-end"><i>endlist</i> no</span>';
  const encryption = playlist.encryption ? playlist.encryption.method : '';
  const playlistType = (playlist.playlistType || (playlist.endList ? 'VOD' : 'LIVE')).toUpperCase();

  els.segmentCount.textContent = String(segmentCount);
  els.segmentMeta.innerHTML = [
    `<span class="meta-chip"><i>target</i> ${escapeHtml(String(playlist.targetDuration || '—'))}s</span>`,
    `<span class="meta-chip"><i>duration</i> ${escapeHtml(formatDuration(playlist.totalDuration))}</span>`,
    `<span class="meta-chip"><i>type</i> ${escapeHtml(playlistType)}</span>`,
    `<span class="meta-chip"><i>sequence</i> ${escapeHtml(String(playlist.mediaSequence))}</span>`,
    endChip,
    encryption ? `<span class="meta-chip"><i>enc</i> ${escapeHtml(encryption)}</span>` : '',
  ].join('');
  els.legendTime.textContent = `0:00 · ${formatDuration(playlist.totalDuration)}`;
  els.ribbonSkeleton.classList.add('is-hidden');
  els.segmentRibbon.replaceChildren();
  els.segmentList.replaceChildren();
  state.segmentEls.clear();
  state.ribbonEls.clear();
  state.currentSeg = null;
  state.currentRowEl = null;

  const ribbonFragment = document.createDocumentFragment();
  const listFragment = document.createDocumentFragment();

  playlist.segments.forEach((segment) => {
    const block = document.createElement('div');
    block.className = 'seg';
    block.dataset.state = 'queued';
    block.dataset.index = String(segment.index);
    block.title = `#${segment.index + 1} · ${segment.duration.toFixed(2)}s · ${shortUri(segment.uri)}`;
    block.style.flexGrow = String(Math.max(segment.duration, 0.01));
    ribbonFragment.append(block);
    state.ribbonEls.set(segment.index, block);

    const row = document.createElement('div');
    row.className = 'seg-row';
    row.dataset.state = 'queued';
    row.dataset.index = String(segment.index);
    row.title = segment.url;
    row.innerHTML = `
      <span class="seg-dot"></span>
      <span class="seg-num"></span>
      <span class="seg-dur"></span>
      <span class="seg-file"></span>
      <span class="seg-state"></span>`;
    row.querySelector('.seg-num').textContent = pad(segment.index + 1);
    row.querySelector('.seg-dur').textContent = `${segment.duration.toFixed(1)}s`;
    row.querySelector('.seg-file').textContent = shortUri(segment.uri);
    row.querySelector('.seg-state').textContent = 'queued';
    listFragment.append(row);
    state.segmentEls.set(segment.index, row);
  });

  els.segmentRibbon.append(ribbonFragment);
  els.segmentList.append(listFragment);
  els.ribbonPlayhead.style.left = '0%';
  els.ribbonPlayhead.parentElement.classList.remove('has-progress');

  if (segmentCount === 0) {
    els.segmentList.innerHTML = '<div class="empty-state compact"><p>This media playlist has no segments.</p></div>';
  }

  els.selectedTag.classList.add('tag-accent');
  els.connectorSelect.classList.add('is-active');
  log('manifest', `media parsed · ${segmentCount} segments · ${formatDuration(playlist.totalDuration)} · target ${playlist.targetDuration}s`);
}

function findSegment(frag) {
  if (!frag) return null;
  if (frag.sn != null) {
    const segment = state.playlist?.segments.find((item) => item.sn === frag.sn);
    if (segment) return segment;
  }
  const rel = String(frag.relurl || frag.url || '').split('?')[0];
  if (!rel) return null;
  return state.playlist?.segments.find((segment) => {
    const segmentPath = segment.url.split('?')[0];
    return segmentPath.endsWith(rel) || rel.endsWith(segment.uri);
  }) || null;
}

function setSegmentState(segment, nextState) {
  if (!segment) return false;
  if (nextState !== 'playing' && SEGMENT_STATE_ORDER[nextState] < SEGMENT_STATE_ORDER[segment.state]) return false;

  const changed = segment.state !== nextState;
  segment.state = nextState;

  const row = state.segmentEls.get(segment.index);
  if (row) {
    row.dataset.state = nextState;
    const stateEl = row.querySelector('.seg-state');
    if (stateEl) stateEl.textContent = SEGMENT_STATE_LABEL[nextState];
    if (nextState === 'playing') {
      if (state.currentRowEl && state.currentRowEl !== row) state.currentRowEl.classList.remove('is-current');
      row.classList.add('is-current');
      state.currentRowEl = row;
    }
  }

  const block = state.ribbonEls.get(segment.index);
  if (block) {
    block.dataset.state = nextState;
  }
  return changed;
}

function markPlaying(segment) {
  if (!segment) return;

  if (state.currentSeg && state.currentSeg !== segment && state.currentSeg.state === 'playing') {
    setSegmentState(state.currentSeg, 'played');
  }

  for (const item of state.playlist.segments) {
    if (item.index < segment.index && ['loaded', 'buffered', 'playing'].includes(item.state)) {
      setSegmentState(item, 'played');
    }
  }

  state.currentSeg = segment;
  state.currentSn = segment.sn;
  setSegmentState(segment, 'playing');
  updateNowCard(segment);
  highlightMediaLine();
  autoScrollSegment(segment);
}

function updateNowCard(segment) {
  els.nowSn.textContent = `SN ${segment.sn} · ${pad(segment.index + 1, 2)}/${state.playlist.segmentCount}`;
  els.nowFile.textContent = shortUri(segment.uri);
  els.nowFile.title = segment.url;
  els.nowDuration.textContent = `${segment.duration.toFixed(1)} s`;
  els.nowBytes.textContent = segment.bytes ? formatBytes(segment.bytes) : '—';
  els.nowBitrate.textContent = state.variant ? formatBitrate(state.variant.bandwidth) : '—';

  setLifecycle(3);

  els.liveDot.classList.add('is-live');
}

function setLifecycle(activeIndex) {
  els.lifecycle.querySelectorAll('.lc-step').forEach((step, index) => {
    step.classList.toggle('is-done', index < activeIndex);
    step.classList.toggle('is-active', index === activeIndex);
  });
}

function resetNowCard(message) {
  els.nowSn.textContent = '—';
  els.nowFile.textContent = message;
  els.nowFile.title = '';
  els.nowDuration.textContent = '—';
  els.nowBytes.textContent = '—';
  els.nowBitrate.textContent = '—';
  els.lifecycle.querySelectorAll('.lc-step').forEach((step) => {
    step.classList.remove('is-done', 'is-active');
  });
}

function autoScrollSegment(segment) {
  if (Date.now() < state.autoScrollBlockedUntil) return;
  const row = state.segmentEls.get(segment.index);
  if (!row) return;
  const rowTop = row.getBoundingClientRect().top
    - els.segmentList.getBoundingClientRect().top
    + els.segmentList.scrollTop;
  const target = rowTop - els.segmentList.clientHeight / 2 + row.offsetHeight / 2;
  els.segmentList.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

/* ------------------------------------------------------------------ */
/* variant selection                                                   */
/* ------------------------------------------------------------------ */

async function selectVariant(index) {
  if (state.switching) return;
  if (!state.master?.variants?.[index]) return;
  if (state.selectedIndex === index && state.hls) return;

  const variant = state.master.variants[index];
  const previous = state.selectedIndex;
  const resumeAt = previous >= 0 && Number.isFinite(els.video.currentTime) ? els.video.currentTime : 0;

  state.switching = true;
  state.pendingIndex = index;
  paintSelection();

  setStatus('loading', 'selecting');
  setStage('select', 'active', variantLabel(variant));
  els.connectorSelect.classList.add('is-active');
  els.selectedTag.textContent = `loading ${variantLabel(variant)}…`;
  els.selectedTag.classList.add('tag-accent');
  if (previous < 0) {
    resetSegmentPanel('Fetching the media playlist…');
    els.segmentCount.textContent = '0';
  }
  log('select', `selecting ${variantLabel(variant)} · ${variantDetail(variant) || 'media playlist'}`);

  try {
    let media;

    if (variant.isDirect && state.master.type === 'media') {
      media = state.master;
      state.mediaText = state.master.raw;
      state.mediaUrl = state.masterUrl;
    } else {
      const fetched = await fetchPlaylist(variant.url);
      const parsed = parsePlaylist(fetched.text, fetched.url);

      if (parsed.type !== 'media') {
        throw new Error('That URL returned a master playlist, not a media playlist.');
      }

      state.mediaText = fetched.text;
      state.mediaUrl = fetched.url;
      log('system', `GET media · ${fetched.ms} ms · ${formatBytes(fetched.size)} · ${parsed.playlist.segmentCount} segments`);
      media = parsed;
    }

    destroyHls();
    state.selectedIndex = index;
    state.pendingIndex = -1;
    state.variant = variant;
    state.media = media;
    state.playlist = media.playlist;

    els.tabMedia.disabled = false;
    setTabLabel(els.tabMedia, `${variantLabel(variant)}.m3u8`);
    els.tabMedia.title = state.mediaUrl;

    renderMedia(media);
    els.selectedTag.textContent = variantLabel(variant);

    if (state.activeTab === 'media') renderCodeTab();
    highlightVariantLines();
    scrollToVariantLines();

    setStage('select', 'done', variantLabel(variant));
    setStatus('ready', 'ready');
    els.playerState.textContent = 'ready';

    log('select', `playing ${variantLabel(variant)} · ${formatBitrate(variant.bandwidth)} · ${media.playlist.segmentCount} segments`);

    startPlayback(variant, resumeAt);
    startHeartbeats();
    paintSelection();
  } catch (error) {
    state.pendingIndex = -1;
    paintSelection();
    els.selectedTag.textContent = previous >= 0
      ? variantLabel(state.master.variants[previous])
      : 'no selection';
    setStage('select', previous >= 0 ? 'done' : 'idle', previous >= 0 ? variantLabel(state.master.variants[previous]) : '—');
    if (previous >= 0) {
      els.connectorSelect.classList.add('is-active');
      refreshStatusFromVideo();
    } else {
      resetSegmentPanel('Media playlist could not be loaded. Pick another variant.');
      els.connectorSelect.classList.remove('is-active');
      els.selectedTag.classList.remove('tag-accent');
      setStatus('error', 'error');
    }
    const message = describeFetchError(error, variant.url);
    log('error', message);
    showToast(message);
  } finally {
    state.switching = false;
  }
}

/* ------------------------------------------------------------------ */
/* playback                                                            */
/* ------------------------------------------------------------------ */

function destroyHls() {
  if (!state.hls) return;
  const hls = state.hls;
  state.hls = null;
  try {
    hls.destroy();
  } catch {
    /* noop */
  }
}

function refreshStatusFromVideo() {
  if (!els.video.paused && els.video.readyState > 2) {
    setStatus('playing', 'playing');
  } else {
    setStatus('ready', 'ready');
  }
}

function applyPendingResume() {
  if (!state.pendingResume) return;
  const duration = els.video.duration;
  if (!Number.isFinite(duration) || els.video.readyState < 1) return;
  const target = Math.min(state.pendingResume, Math.max(0, duration - 0.5));
  state.pendingResume = 0;
  try {
    els.video.currentTime = target;
  } catch {
    /* ignore: browser will start at zero */
  }
}

function startPlayback(variant, resumeAt = 0) {
  if (!Hls) {
    showToast('hls.js failed to load. Check vendor/hls.min.js.');
    return;
  }

  destroyHls();
  state.recoveries = 0;
  state.currentSeg = null;
  state.currentRowEl = null;
  state.currentSn = null;
  state.pendingResume = resumeAt > 0.5 ? resumeAt : 0;
  els.nowSn.textContent = '—';
  els.nowFile.textContent = 'Buffering first segment…';
  els.nowFile.title = '';
  els.nowDuration.textContent = '—';
  els.nowBytes.textContent = '—';
  els.nowBitrate.textContent = formatBitrate(variant.bandwidth);
  els.lifecycle.querySelectorAll('.lc-step').forEach((step) => step.classList.remove('is-done', 'is-active'));
  els.statBuffer.textContent = '0.0 s';
  els.statBytes.textContent = '—';
  els.statRate.textContent = '—';

  const audioOnly = !variant.resolution && !variant.isDirect;
  els.playerShell.classList.add('has-source');
  els.playerShell.classList.remove('is-playing');
  els.playerShell.classList.toggle('is-audio-only', audioOnly);
  els.playerShell.classList.toggle('is-muted', state.muted);
  els.video.muted = state.muted;
  els.playerVariant.textContent = variant.resolution
    ? `${variantLabel(variant)} · ${variant.resolution.width}×${variant.resolution.height}`
    : variantLabel(variant);

  const placeholderTitle = els.playerPlaceholder?.querySelector('p');
  const placeholderSub = els.playerPlaceholder?.querySelector('span');
  if (placeholderTitle) {
    placeholderTitle.textContent = audioOnly ? 'Audio-only rendition' : 'Connecting…';
  }
  if (placeholderSub) {
    placeholderSub.textContent = audioOnly ? 'This variant has no video track' : 'Segment data is on the way';
  }
  els.playerVariant.title = variant.url;
  els.playerState.textContent = 'loading';
  els.liveDot.classList.remove('is-live');

  setStage('play', 'active', 'buffering…');
  setStatus('loading', 'buffering');

  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 30,
    maxBufferLength: 24,
    maxMaxBufferLength: 48,
    maxBufferSize: 48 * 1000 * 1000,
    startFragPrefetch: false,
    testBandwidth: false,
    capLevelToPlayerSize: false,
  });
  state.hls = hls;

  hls.on(Hls.Events.MEDIA_ATTACHED, () => {
    log('manifest', 'MediaSource attached');
    hls.loadSource(variant.url);
  });

  hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
    log('manifest', `hls manifest parsed · ${data.levels?.length || 1} level(s)`);
    applyPendingResume();
    const promise = els.video.play();
    if (promise?.catch) {
      promise.catch(() => {
        log('warn', 'autoplay was blocked — press play to start');
        els.playerState.textContent = 'paused';
        setStatus('ready', 'ready');
      });
    }
  });

  hls.on(Hls.Events.FRAG_LOADING, (_, data) => {
    const segment = findSegment(data.frag);
    if (!segment) return;
    segment.loadStartedAt = performance.now();
    setSegmentState(segment, 'loading');
    log('frag', `GET seg ${pad(segment.index + 1)} · ${shortUri(segment.uri)}`);
  });

  hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
    const segment = findSegment(data.frag);
    if (!segment) return;
    const stats = data.frag.stats || {};
    const bytes = stats.total || stats.loaded || segment.bytes || 0;
    const started = stats.loading?.start || segment.loadStartedAt || performance.now();
    const ended = stats.loading?.end || performance.now();
    const ms = Math.max(1, Math.round(ended - started));

    segment.bytes = bytes;
    segment.loadMs = ms;
    if (segment.state !== 'playing') setSegmentState(segment, 'loaded');

    state.lastLoadedBytes = bytes;
    state.lastLoadMs = ms;
    els.statBytes.textContent = formatBytes(bytes);
    els.statRate.textContent = bytes && ms
      ? `${((bytes * 8) / ms / 1000).toFixed(1)} Mbps`
      : '—';

    log('frag', `200 seg ${pad(segment.index + 1)} · ${formatBytes(bytes)} · ${ms} ms`);

    if (state.currentSeg === segment) {
      els.nowBytes.textContent = formatBytes(bytes);
      setLifecycle(3);
    }
  });

  hls.on(Hls.Events.BUFFER_APPENDED, (_, data) => {
    const segment = findSegment(data.frag);
    if (!segment) return;
    const changed = setSegmentState(segment, 'buffered');
    if (changed) log('buffer', `APPEND seg ${pad(segment.index + 1)} · ${segment.duration.toFixed(1)} s`);
    if (state.currentSeg === segment) setLifecycle(3);
  });

  hls.on(Hls.Events.FRAG_CHANGED, (_, data) => {
    const segment = findSegment(data.frag);
    if (!segment) return;
    markPlaying(segment);
    log('frag', `PLAY seg ${pad(segment.index + 1)} · t ${formatDuration(segment.start, { precise: true })}`);
  });

  hls.on(Hls.Events.ERROR, (_, data) => {
    if (!data.fatal) {
      if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
        log('warn', 'buffer stalled · waiting for data');
      }
      return;
    }

    if (state.recoveries >= 2) {
      log('error', `playback failed · ${data.type} · ${data.details}`);
      showToast(`Playback failed: ${data.details || data.type}. This codec may not be supported.`);
      setStatus('error', 'error');
      els.playerState.textContent = 'error';
      els.liveDot.classList.remove('is-live');
      stopHeartbeats();
      destroyHls();
      return;
    }

    state.recoveries += 1;
    log('warn', `recovering (${state.recoveries}/2) · ${data.details}`);

    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      hls.recoverMediaError();
    } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      hls.startLoad();
    } else {
      destroyHls();
    }
  });

  hls.attachMedia(els.video);
}

/* ------------------------------------------------------------------ */
/* player UI                                                           */
/* ------------------------------------------------------------------ */

function bufferedEndAt(currentTime) {
  const video = els.video;
  let end = 0;
  for (let index = 0; index < video.buffered.length; index += 1) {
    if (video.buffered.start(index) <= currentTime + 0.15) {
      end = Math.max(end, video.buffered.end(index));
    }
  }
  return end;
}

function updatePlaybackUI() {
  const video = els.video;
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  const pct = duration ? clamp(current / duration, 0, 1) : 0;

  els.seekProgress.style.width = `${pct * 100}%`;
  els.seekThumb.style.left = `${pct * 100}%`;
  els.curTime.textContent = formatDuration(current);
  els.durTime.textContent = duration ? formatDuration(duration) : '—';
  els.seek.setAttribute('aria-valuemin', '0');
  els.seek.setAttribute('aria-valuemax', String(Math.round(duration)));
  els.seek.setAttribute('aria-valuenow', String(Math.round(current)));
  els.seek.setAttribute('aria-valuetext', `${formatDuration(current)} of ${formatDuration(duration)}`);

  if (state.playlist && duration) {
    els.ribbonPlayhead.style.left = `${pct * 100}%`;
    els.ribbonPlayhead.parentElement.classList.add('has-progress');
    setStage('play', 'active', `${formatDuration(current)} / ${formatDuration(duration)}`);
  }

  const end = bufferedEndAt(current);
  const bufferAhead = Math.max(0, end - current);
  els.seekBuffer.style.width = duration ? `${clamp(end / duration, 0, 1) * 100}%` : '0%';
  els.statBuffer.textContent = `${bufferAhead.toFixed(1)} s`;

  const quality = video.getVideoPlaybackQuality?.();
  if (quality) els.statDrops.textContent = String(quality.droppedVideoFrames || 0);
}

function seekFromClientX(clientX) {
  const rect = els.seek.getBoundingClientRect();
  if (!rect.width) return;
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  const duration = Number.isFinite(els.video.duration) ? els.video.duration : 0;
  if (duration) els.video.currentTime = ratio * duration;
}

function togglePlay() {
  if (els.video.paused) {
    if (els.video.ended) els.video.currentTime = 0;
    els.video.play().catch(() => {
      log('warn', 'playback could not start');
    });
  } else {
    els.video.pause();
  }
}

/* ------------------------------------------------------------------ */
/* events                                                              */
/* ------------------------------------------------------------------ */

els.video.addEventListener('play', () => {
  els.playerShell.classList.add('is-playing');
  els.liveDot.classList.add('is-live');
  els.playerState.textContent = 'playing';
  setStatus('playing', 'playing');
  setStage('play', 'active', els.pipePlay.textContent === '—' ? 'starting…' : els.pipePlay.textContent);
  if (!state.heartbeatTimer && state.variant) startHeartbeats();
});

els.video.addEventListener('pause', () => {
  els.playerShell.classList.remove('is-playing');
  els.liveDot.classList.remove('is-live');
  els.playerState.textContent = els.video.ended ? 'ended' : 'paused';
  setStatus('ready', 'ready');
});

els.video.addEventListener('waiting', () => {
  els.playerState.textContent = 'buffering';
});

els.video.addEventListener('playing', () => {
  els.playerShell.classList.add('is-playing');
  els.liveDot.classList.add('is-live');
  els.playerState.textContent = 'playing';
  setStatus('playing', 'playing');
});

els.video.addEventListener('timeupdate', updatePlaybackUI);
els.video.addEventListener('progress', updatePlaybackUI);
els.video.addEventListener('durationchange', updatePlaybackUI);
els.video.addEventListener('loadedmetadata', () => {
  applyPendingResume();
  updatePlaybackUI();
});

els.video.addEventListener('ended', () => {
  els.playerShell.classList.remove('is-playing');
  els.liveDot.classList.remove('is-live');
  els.playerState.textContent = 'ended';
  setStatus('ready', 'ready');
  setStage('play', 'done', 'ended');
  stopHeartbeats();
  log('system', 'playback reached the end of the playlist');
});

els.video.addEventListener('volumechange', () => {
  state.muted = els.video.muted;
  els.playerShell.classList.toggle('is-muted', els.video.muted);
  els.muteBtn.setAttribute('aria-label', els.video.muted ? 'Unmute' : 'Mute');
});

els.playBtn.addEventListener('click', togglePlay);
els.playOverlay.addEventListener('click', togglePlay);
els.video.addEventListener('click', togglePlay);

els.muteBtn.addEventListener('click', () => {
  els.video.muted = !els.video.muted;
  if (!els.video.muted) {
    els.video.volume = Math.max(els.video.volume, 0.65);
    log('system', 'audio unmuted');
  }
});

els.fsBtn.addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
  } else {
    els.playerShell.requestFullscreen?.().catch(() => {});
  }
});

let seeking = false;
els.seek.addEventListener('pointerdown', (event) => {
  if (!Number.isFinite(els.video.duration)) return;
  seeking = true;
  els.seek.setPointerCapture?.(event.pointerId);
  seekFromClientX(event.clientX);
  event.preventDefault();
});
els.seek.addEventListener('pointermove', (event) => {
  if (seeking) seekFromClientX(event.clientX);
});
els.seek.addEventListener('pointerup', () => { seeking = false; });
els.seek.addEventListener('pointercancel', () => { seeking = false; });
els.seek.addEventListener('keydown', (event) => {
  const step = event.shiftKey ? 15 : 5;
  if (event.key === 'ArrowLeft') {
    els.video.currentTime = Math.max(0, els.video.currentTime - step);
    event.preventDefault();
  } else if (event.key === 'ArrowRight') {
    els.video.currentTime = Math.min(els.video.duration || 0, els.video.currentTime + step);
    event.preventDefault();
  } else if (event.key === 'Home') {
    els.video.currentTime = 0;
    event.preventDefault();
  } else if (event.key === 'End' && Number.isFinite(els.video.duration)) {
    els.video.currentTime = els.video.duration;
    event.preventDefault();
  }
});

els.tabMaster.addEventListener('click', () => {
  state.activeTab = 'master';
  renderCodeTab();
});
els.tabMedia.addEventListener('click', () => {
  if (els.tabMedia.disabled) return;
  state.activeTab = 'media';
  renderCodeTab();
});

els.copyCode.addEventListener('click', async () => {
  const text = state.activeTab === 'media' ? state.mediaText : state.masterText;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Playlist text copied to clipboard.', 'ok');
  } catch {
    showToast('Clipboard access was blocked.');
  }
});

els.clearLog.addEventListener('click', () => {
  els.log.replaceChildren();
  els.logCount.textContent = '0';
  log('system', 'event stream cleared');
});

els.presetSelect.addEventListener('change', () => {
  els.sourceUrl.value = els.presetSelect.value;
  loadMaster(els.presetSelect.value);
});

els.loadBtn.addEventListener('click', () => {
  loadMaster(els.sourceUrl.value).catch(() => {});
});

els.sourceUrl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') loadMaster(els.sourceUrl.value).catch(() => {});
});

els.segmentList.addEventListener('wheel', () => {
  state.autoScrollBlockedUntil = Date.now() + 4000;
}, { passive: true });
els.segmentList.addEventListener('touchstart', () => {
  state.autoScrollBlockedUntil = Date.now() + 4000;
}, { passive: true });
els.segmentList.addEventListener('pointerdown', () => {
  state.autoScrollBlockedUntil = Date.now() + 4000;
});

/* ------------------------------------------------------------------ */
/* telemetry heartbeats                                                */
/* ------------------------------------------------------------------ */

const HEARTBEAT_INTERVAL_MS = 2000;
const ALLOWED_CHANNELS = [2, 6, 10, 16];

function deriveTelemetry(variant) {
  if (!variant) return null;

  const codecs = variant.codecs || [];
  const codecString = codecs.join(' ').toLowerCase();
  const supplemental = String(variant.attributes?.['SUPPLEMENTAL-CODECS'] || '').toLowerCase();
  const hasResolution = Boolean(variant.resolution);

  let currentVideoCodec = null;
  for (const rawCodec of codecs) {
    const codec = rawCodec.toLowerCase();
    if (/^(avc1|avc3)/.test(codec)) { currentVideoCodec = 'h.264'; break; }
    if (/^(hvc1|hev1|dvh1|dvhe)/.test(codec)) { currentVideoCodec = 'h.265'; break; }
    if (/^(vp09|vp9)/.test(codec)) { currentVideoCodec = 'vp9'; break; }
    if (/^av01/.test(codec)) { currentVideoCodec = 'av1'; break; }
  }

  let currentVideoRange = null;
  if (hasResolution) {
    const range = String(variant.videoRange || '').toUpperCase();
    if (/dvh1|dvhe|dby1|dolby/i.test(`${codecString} ${supplemental}`)) {
      currentVideoRange = 'DOLBY_VISION';
    } else if (/hdr10\+|hdr10plus/i.test(`${supplemental} ${range}`)) {
      currentVideoRange = 'HDR10_PLUS';
    } else if (range === 'PQ' || range === 'HDR10' || range === 'HLG') {
      currentVideoRange = 'HDR10';
    } else {
      currentVideoRange = 'SDR';
    }
  }

  const audioRendition = (state.master?.renditions || []).find(
    (rendition) => rendition.type === 'AUDIO'
      && variant.audioGroup
      && rendition.groupId === variant.audioGroup,
  );
  const channelAttr = audioRendition?.channels
    ? Number.parseInt(audioRendition.channels, 10)
    : null;

  const hasJoc = /joc|atmos/.test(`${codecString} ${supplemental}`);
  const hasDts = /dtsx|dts-x|dts/.test(codecString);
  const hasEc3 = /ec-3|eac3/.test(codecString);
  const hasAc3 = /ac-3/.test(codecString);

  let currentAudioChannels = Number.isFinite(channelAttr) && channelAttr > 0
    ? channelAttr
    : (hasJoc ? 10 : hasDts ? 16 : (hasEc3 || hasAc3) ? 6 : 2);

  if (hasJoc) currentAudioChannels = Math.max(currentAudioChannels, 10);
  if (hasDts) currentAudioChannels = 16;

  if (!ALLOWED_CHANNELS.includes(currentAudioChannels)) {
    currentAudioChannels = ALLOWED_CHANNELS.reduce(
      (nearest, candidate) => (
        Math.abs(candidate - currentAudioChannels) < Math.abs(nearest - currentAudioChannels)
          ? candidate
          : nearest
      ),
      2,
    );
  }

  let currentAudioType;
  if (hasDts || currentAudioChannels === 16) currentAudioType = 'DTS-X';
  else if (hasJoc || currentAudioChannels === 10) currentAudioType = 'ATMOS';
  else if (currentAudioChannels === 6) currentAudioType = 'SURROUND';
  else currentAudioType = 'STEREO';

  let currentAudioCodec;
  if (hasDts) currentAudioCodec = 'dtsx-ps2';
  else if (hasJoc) currentAudioCodec = 'ec3-joc';
  else if (hasEc3 || hasAc3) currentAudioCodec = 'ec-3';
  else currentAudioCodec = 'aac';

  return {
    currentResolution: hasResolution
      ? `${variant.resolution.width}x${variant.resolution.height}`
      : null,
    currentAudioChannels,
    currentVideoRange,
    currentVideoCodec,
    currentAudioType,
    currentAudioCodec,
  };
}

function createHeartbeatEmpty() {
  const empty = document.createElement('div');
  empty.className = 'hb-empty';
  empty.innerHTML = `
    <span class="pulse-ring"></span>
    <p>No heartbeats yet</p>
    <span>Select a variant to start the telemetry stream.</span>`;
  return empty;
}

function stopHeartbeats() {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
  els.heartbeatLive.classList.remove('is-live');
}

function resetHeartbeats() {
  stopHeartbeats();
  state.heartbeatSeq = 0;
  state.lastTelemetry = null;
  els.heartbeatCount.textContent = '0';
  els.heartbeatVariant.textContent = 'no variant';
  els.heartbeatTable.querySelectorAll('.hb-row:not(.hb-head), .hb-empty').forEach((node) => node.remove());
  els.heartbeatTable.append(createHeartbeatEmpty());
}

function startHeartbeats() {
  stopHeartbeats();

  if (!state.variant) {
    els.heartbeatVariant.textContent = 'no variant';
    els.heartbeatTable.append(createHeartbeatEmpty());
    return;
  }

  const resolution = state.variant.resolution
    ? `${state.variant.resolution.width}x${state.variant.resolution.height}`
    : 'audio only';
  els.heartbeatVariant.textContent = `${variantLabel(state.variant)} · ${resolution}`;
  els.heartbeatLive.classList.add('is-live');

  // Keep the event history across variant switches so the change is visible
  // in the stream; a master reload clears it via resetHeartbeats().
  emitHeartbeat();
  state.heartbeatTimer = setInterval(emitHeartbeat, HEARTBEAT_INTERVAL_MS);
}

function emitHeartbeat() {
  if (!state.variant) return;
  const payload = deriveTelemetry(state.variant);
  if (!payload) return;

  state.heartbeatSeq += 1;
  appendHeartbeat(payload, state.heartbeatSeq);
  els.heartbeatCount.textContent = String(state.heartbeatSeq);
}

function appendHeartbeat(payload, sequence) {
  const empty = els.heartbeatTable.querySelector('.hb-empty');
  const hadRows = Boolean(els.heartbeatTable.querySelector('.hb-row:not(.hb-head)'));
  const nearBottom = !hadRows
    || els.heartbeatScroll.scrollHeight - els.heartbeatScroll.scrollTop - els.heartbeatScroll.clientHeight < 30;

  empty?.remove();

  const now = new Date();
  const timestamp = `${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, '0')}`;

  const event = {
    timestamp: now.toISOString(),
    heartbeat: sequence,
    ...payload,
  };

  const row = document.createElement('div');
  row.className = 'hb-row is-new';
  row.dataset.payload = JSON.stringify(event);
  row.title = `heartbeat #${sequence}\n${JSON.stringify(event, null, 2)}`;

  const time = document.createElement('span');
  time.className = 'hb-time';
  const dot = document.createElement('i');
  dot.className = 'hb-dot';
  const timeText = document.createElement('span');
  timeText.textContent = timestamp;
  time.append(dot, timeText);

  const cell = (key, value, { pill = false, dimWhenEmpty = true } = {}) => {
    const node = document.createElement('span');
    node.className = 'hb-value';
    if (pill) node.classList.add('hb-pill');

    if (value === null || value === undefined || value === '') {
      node.textContent = '—';
      if (dimWhenEmpty) node.classList.add('is-dim');
    } else {
      node.textContent = String(value);
      if (pill) node.dataset.value = String(value);
    }

    if (state.lastTelemetry && state.lastTelemetry[key] !== payload[key]) {
      node.classList.add('is-changed');
      setTimeout(() => node.classList.remove('is-changed'), 2400);
    }
    return node;
  };

  row.append(
    time,
    cell('currentResolution', payload.currentResolution),
    cell('currentAudioChannels', payload.currentAudioChannels),
    cell('currentVideoRange', payload.currentVideoRange, { pill: true }),
    cell('currentVideoCodec', payload.currentVideoCodec),
    cell('currentAudioType', payload.currentAudioType, { pill: true }),
    cell('currentAudioCodec', payload.currentAudioCodec),
  );

  els.heartbeatTable.append(row);
  state.lastTelemetry = payload;

  const rows = els.heartbeatTable.querySelectorAll('.hb-row:not(.hb-head)');
  if (rows.length > 60) rows[0].remove();

  if (nearBottom) els.heartbeatScroll.scrollTop = els.heartbeatScroll.scrollHeight;
  setTimeout(() => row.classList.remove('is-new'), 2300);
}

/* ------------------------------------------------------------------ */
/* master loader                                                       */
/* ------------------------------------------------------------------ */

async function loadMaster(rawUrl) {
  if (state.loadingMaster) return;

  let url;
  try {
    url = normalizeUrl(rawUrl);
  } catch (error) {
    showToast(error.message);
    return;
  }

  state.loadingMaster = true;
  els.loadBtn.classList.add('is-loading');
  els.loadBtn.querySelector('.btn-label').textContent = 'Loading…';
  els.sourceUrl.value = url;

  resetPlayback();
  resetSegmentPanel('Waiting for a variant selection…');
  renderMasterLoading();
  state.playlist = null;
  els.selectedTag.textContent = 'no selection';
  els.selectedTag.classList.remove('tag-accent');
  setStatus('loading', 'fetching');
  setStage('input', 'active', 'fetching…');
  setStage('parse', 'idle', '—');
  setSourceFoot('warn', 'fetching master playlist…');
  log('system', `GET ${url}`);

  try {
    const fetched = await fetchPlaylist(url);
    const parsed = parsePlaylist(fetched.text, fetched.url);

    if (parsed.type === 'master' && !parsed.variants.length) {
      throw new Error('No #EXT-X-STREAM-INF variants were found in this master playlist.');
    }

    renderMaster(parsed, fetched);
    const isPreset = [...els.presetSelect.options].some((option) => option.value === state.masterUrl);
    els.presetSelect.value = isPreset ? state.masterUrl : '';

    log('system', `GET 200 · ${formatBytes(fetched.size)} · ${fetched.ms} ms`);
    log('warn', 'player starts muted so autoplay is permitted — use the speaker button to unmute');
  } catch (error) {
    const message = describeFetchError(error, url);
    setStatus('error', 'error');
    setStage('input', 'error', 'failed');
    setStage('parse', 'idle', '—');
    setSourceFoot('err', 'load failed');
    els.variantCount.textContent = '0';
    els.variantFoot.textContent = 'no variants parsed';
    els.variantList.innerHTML = `
      <div class="empty-state">
        <p>Could not load that playlist.</p>
        <span>${escapeHtml(message)}</span>
      </div>`;
    els.codeView.innerHTML = `
      <div class="code-empty">
        <p>Request failed.</p>
        <span class="dim" style="max-width:280px">${escapeHtml(message)}</span>
      </div>`;
    els.manifestBadge.textContent = 'ERROR';
    els.manifestSize.textContent = '—';
    els.sourceMeta.textContent = hostOf(url);
    log('error', message);
    showToast(message);
  } finally {
    state.loadingMaster = false;
    els.loadBtn.classList.remove('is-loading');
    els.loadBtn.querySelector('.btn-label').textContent = 'Load playlist';
  }
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

function boot() {
  if (!Hls) {
    showToast('hls.js did not load. Make sure vendor/hls.min.js exists.');
    return;
  }

  els.video.muted = true;
  els.playerShell.classList.add('is-muted');
  els.log.innerHTML = '<div class="log-empty">Waiting for events…</div>';
  log('system', 'playlist simulator ready');
  log('system', `hls.js ${Hls.version || 'unknown'} · MSE ${window.MediaSource ? 'available' : 'missing'}`);

  const params = new URLSearchParams(window.location.search);
  const initialUrl = params.get('url') || els.sourceUrl.value;
  els.sourceUrl.value = initialUrl;

  setTimeout(() => loadMaster(initialUrl).catch(() => {}), 220);
}

boot();

// Handy for poking at the simulator from devtools.
window.__playlistSim = { state, els };
