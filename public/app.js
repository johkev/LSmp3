const form = document.querySelector('#converter-form');
const urlInput = document.querySelector('#media-url');
const clearButton = document.querySelector('#clear-url');
const urlHint = document.querySelector('#url-hint');
const formMessage = document.querySelector('#form-message');
const formatInput = document.querySelector('#format');
const qualityInput = document.querySelector('#quality');
const saveModeInput = document.querySelector('#save-mode');
const speedModeInput = document.querySelector('#speed-mode');
const urlMode = document.querySelector('#url-mode');
const searchMode = document.querySelector('#search-mode');
const urlEntry = document.querySelector('#url-entry');
const searchEntry = document.querySelector('#search-entry');
const searchQuery = document.querySelector('#search-query');
const searchSource = document.querySelector('#search-source');
const searchButton = document.querySelector('#search-button');
const searchResults = document.querySelector('#search-results');
const progressPanel = document.querySelector('#progress-panel');
const progressBar = document.querySelector('#progress-bar');
const progressValue = document.querySelector('#progress-value');
const progressTitle = document.querySelector('#progress-title');
const progressDetail = document.querySelector('#progress-detail');
const downloadButton = document.querySelector('#download-button');
const driveRootButton = document.querySelector('#drive-root-button');
const driveJobButton = document.querySelector('#drive-job-button');
const cancelButton = document.querySelector('#cancel-button');
const mediaSummary = document.querySelector('#media-summary');
const mediaThumbnail = document.querySelector('#media-thumbnail');
const mediaTitle = document.querySelector('#media-title');
const mediaMeta = document.querySelector('#media-meta');
const diagnosticsButton = document.querySelector('#diagnostics-button');
const logsPanel = document.querySelector('#logs-panel');
const logsClose = document.querySelector('#logs-close');
const logsContent = document.querySelector('#logs-content');
const logsStatus = document.querySelector('#logs-status');
const logTabs = document.querySelectorAll('.log-tab');
const systemMonitor = document.querySelector('#system-monitor');
const jobNumberElement = document.querySelector('#job-number');
const playlistItems = document.querySelector('#playlist-items');
const playlistOverview = document.querySelector('#playlist-overview');
const playlistCount = document.querySelector('#playlist-count');
const playlistActive = document.querySelector('#playlist-active');
const playlistEta = document.querySelector('#playlist-eta');
const liveLog = document.querySelector('#live-log');
const kevinTrigger = document.querySelector('#kevin-trigger');
const kevinModal = document.querySelector('#kevin-modal');
const kevinModalClose = document.querySelector('#kevin-modal-close');

const audioQualities = [
  ['320', '320 kbps'],
  ['256', '256 kbps'],
  ['192', '192 kbps'],
  ['160', '160 kbps'],
  ['128', '128 kbps'],
  ['96', '96 kbps']
];
const videoQualities = [
  ['2160', '4K / 2160p'],
  ['1440', '1440p'],
  ['1080', '1080p'],
  ['720', '720p'],
  ['480', '480p'],
  ['360', '360p']
];
const audioFormats = ['mp3', 'm4a', 'flac', 'ogg', 'opus', 'wav'];
const videoFormats = ['mp4', 'mkv', 'webm'];

let currentJobId = null;
let pollTimer;
let pollFailures = 0;
let cancellingJob = false;
let selectedMediaUrl = '';
let progressSamples = [];
let visualProgress = 0;
let visualProgressTimer;
let currentLogs = [];
let selectedLogSource = 'app';

function setUrlState() {
  clearButton.hidden = urlInput.value.length === 0;
}

function setProgress(value, title, detail) {
  progressBar.style.width = `${value}%`;
  progressValue.textContent = `${value}%`;
  progressTitle.textContent = title;
  progressDetail.textContent = detail;
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function updateQualityOptions() {
  const options = videoFormats.includes(formatInput.value) ? videoQualities : audioQualities;
  qualityInput.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
}

function setInputMode(mode) {
  const isSearch = mode === 'search';
  urlMode.classList.toggle('is-active', !isSearch);
  searchMode.classList.toggle('is-active', isSearch);
  urlMode.setAttribute('aria-selected', String(!isSearch));
  searchMode.setAttribute('aria-selected', String(isSearch));
  urlEntry.hidden = isSearch;
  searchEntry.hidden = !isSearch;
}

function formatSearchDuration(seconds) {
  const value = Math.round(Number(seconds) || 0);
  return value ? `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}` : 'ukjent lengde';
}

function renderSearchResults(results) {
  searchResults.replaceChildren();
  if (!results.length) {
    searchResults.textContent = 'Ingen resultater funnet.';
    return;
  }
  for (const result of results) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search-result';
    const thumbnail = document.createElement('span');
    thumbnail.className = 'search-result-thumb';
    if (result.thumbnail) {
      const image = document.createElement('img');
      image.src = result.thumbnail;
      image.alt = '';
      thumbnail.append(image);
    } else {
      thumbnail.textContent = '↗';
    }
    const copy = document.createElement('span');
    copy.className = 'search-result-copy';
    const title = document.createElement('strong');
    title.textContent = result.title;
    const details = document.createElement('small');
    details.textContent = `${result.uploader || searchSource.value} · ${formatSearchDuration(result.duration)}`;
    copy.append(title, details);
    const arrow = document.createElement('span');
    arrow.className = 'search-result-arrow';
    arrow.textContent = '→';
    button.append(thumbnail, copy, arrow);
    button.addEventListener('click', () => {
      selectedMediaUrl = result.url;
      urlInput.value = result.url;
      setInputMode('url');
      formMessage.textContent = 'Resultat valgt. Velg innstillinger og start jobben.';
      urlInput.focus();
    });
    searchResults.append(button);
  }
}

async function performSearch() {
  const query = searchQuery.value.trim();
  if (query.length < 2) {
    searchResults.textContent = 'Skriv minst to tegn for å søke.';
    return;
  }
  searchButton.disabled = true;
  searchResults.textContent = 'Søker...';
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&source=${encodeURIComponent(searchSource.value)}`);
    const payload = await readJsonResponse(response, 'Søket returnerte ikke JSON. Sjekk at serveren kjører riktig versjon.');
    if (!response.ok) throw new Error(payload.error || 'Søket feilet.');
    renderSearchResults(payload.results);
  } catch (error) {
    searchResults.textContent = error.message;
  } finally {
    searchButton.disabled = false;
  }
}

function renderPlaylistItems(items) {
  playlistItems.replaceChildren();
  playlistItems.hidden = items.length === 0;
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'playlist-item';
    row.dataset.index = item.index;
    row.innerHTML = '<span class="playlist-item-state">Venter</span><span class="playlist-item-title"></span><span class="playlist-item-progress">Ikke startet</span>';
    row.querySelector('.playlist-item-title').textContent = item.title || 'Uten tittel';
    playlistItems.append(row);
  }
}

function updatePlaylistItems(items) {
  if (!items || items.length === 0) return;
  playlistOverview.hidden = false;
  const completed = items.filter((item) => item.status === 'completed').length;
  playlistCount.textContent = `${completed} av ${items.length} ferdig`;
  const now = Date.now();
  const currentProgress = items.reduce((sum, item) => sum + (Number(item.progress) || 0), 0) / items.length;
  progressSamples.push({ time: now, progress: currentProgress });
  progressSamples = progressSamples.filter((sample) => now - sample.time < 15000);
  if (progressSamples.length > 1 && currentProgress > progressSamples[0].progress) {
    const first = progressSamples[0];
    const rate = (currentProgress - first.progress) / ((now - first.time) / 1000);
    playlistEta.textContent = `Ca. ${formatEta((100 - currentProgress) / rate)} igjen`;
  } else {
    playlistEta.textContent = 'Beregner tid igjen...';
  }
  for (const item of items || []) {
    const row = playlistItems.querySelector(`[data-index="${item.index}"]`);
    if (!row) continue;
    const statusText = item.status === 'completed' ? 'Ferdig' : item.status === 'processing' ? 'Laster ned' : item.status === 'failed' ? 'Feilet' : 'Venter';
    row.querySelector('.playlist-item-progress').textContent = statusText;
    row.querySelector('.playlist-item-state').textContent = statusText;
    row.classList.toggle('is-complete', item.status === 'completed');
    row.classList.toggle('is-failed', item.status === 'failed');
  }
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 60) return `${Math.max(1, Math.round(seconds || 1))} sek`;
  return `${Math.floor(seconds / 60)} min`;
}

async function readJsonResponse(response, fallbackMessage) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    await response.text();
    throw new Error(fallbackMessage);
  }
  return response.json();
}

function resetProgress() {
  window.clearTimeout(pollTimer);
  currentJobId = null;
  pollFailures = 0;
  cancellingJob = false;
  progressPanel.hidden = true;
  downloadButton.hidden = true;
  downloadButton.disabled = true;
  driveRootButton.hidden = true;
  driveJobButton.hidden = true;
  cancelButton.hidden = true;
  mediaSummary.hidden = true;
  mediaThumbnail.removeAttribute('src');
  playlistItems.replaceChildren();
  playlistItems.hidden = true;
  playlistOverview.hidden = true;
  liveLog.hidden = true;
  liveLog.textContent = '';
  progressSamples = [];
  window.clearInterval(visualProgressTimer);
  visualProgress = 0;
  setProgress(0, 'Klargjører filen', 'Venter på serveren...');
}

function formatDuration(seconds) {
  const totalSeconds = Math.round(Number(seconds) || 0);
  if (!totalSeconds) return 'Ukjent lengde';
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}

function formatSize(bytes) {
  const size = Number(bytes) || 0;
  if (!size) return 'størrelse beregnes underveis';
  return `ca. ${(size / 1024 / 1024).toFixed(1)} MB`;
}

function showMetadata(metadata) {
  if (!metadata) return;
  mediaSummary.hidden = false;
  mediaTitle.textContent = metadata.title || 'Mediejobb';
  mediaMeta.textContent = `${metadata.isPlaylist ? `${metadata.itemCount} elementer` : 'Enkeltvideo'} · ${formatDuration(metadata.duration)} · ${formatSize(metadata.estimatedSize)}`;
  if (metadata.thumbnail) {
    mediaThumbnail.src = metadata.thumbnail;
    mediaThumbnail.alt = `Forhåndsvisning av ${metadata.title || 'mediet'}`;
  }
  renderPlaylistItems(metadata.items || []);
}

function showTransfer(transfer, job) {
  if (!transfer) {
    if (job?.speedMode === 'fast') {
      mediaSummary.hidden = false;
      mediaTitle.textContent = job.url ? getUrlTitle(job.url) : 'Rask nedlasting';
      mediaMeta.textContent = `${job.format.toUpperCase()} · starter direkte · metadata hoppet over`;
      const youtubeId = getYouTubeId(job.url);
      if (youtubeId) {
        mediaThumbnail.src = `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
        mediaThumbnail.alt = 'Forhåndsvisning fra YouTube';
      }
    }
    return;
  }
  mediaSummary.hidden = false;
  mediaTitle.textContent = job?.metadata?.title || 'Laster ned';
  mediaMeta.textContent = `${transfer.downloaded} · ${transfer.speed}${transfer.eta ? ` · ETA ${transfer.eta}` : ''}`;
}

function getYouTubeId(value) {
  try {
    const parsed = new URL(value);
    if (parsed.hostname.includes('youtu.be')) return parsed.pathname.slice(1) || null;
    return parsed.hostname.includes('youtube.com') ? parsed.searchParams.get('v') : null;
  } catch {
    return null;
  }
}

function getUrlTitle(value) {
  const id = getYouTubeId(value);
  return id ? `YouTube-video · ${id}` : 'Rask nedlasting';
}

function animateProgress(target) {
  const safeTarget = Math.max(0, Math.min(100, Number(target) || 0));
  window.clearInterval(visualProgressTimer);
  visualProgressTimer = window.setInterval(() => {
    if (visualProgress >= safeTarget) {
      window.clearInterval(visualProgressTimer);
      return;
    }
    const step = safeTarget === 100 ? Math.max(.35, (safeTarget - visualProgress) * .08) : Math.max(.2, (safeTarget - visualProgress) * .12);
    visualProgress = Math.min(safeTarget, visualProgress + step);
    setProgress(visualProgress, progressTitle.textContent, progressDetail.textContent);
  }, 80);
}

async function pollJob(jobId) {
  try {
    const response = await fetch(`/api/jobs/${jobId}`);
    const job = await readJsonResponse(response, 'Status-endepunktet returnerte ikke JSON.');
    if (!response.ok) throw new Error(job.error || 'Kunne ikke hente jobbstatus.');
    pollFailures = 0;

    if (job.status === 'failed') {
      if (job.saveMode === 'media') showDriveLinks(job.jobNumber);
      throw new Error(job.error || 'Serveren klarte ikke å behandle filen.');
    }

    const detail = job.phase || (job.status === 'queued' ? 'Venter i kø...' : job.status === 'processing' ? 'Behandler innhold...' : 'Filen er klar.');
    showMetadata(job.metadata);
    showTransfer(job.transfer, job);
    if (job.latestLog) {
      liveLog.hidden = false;
      liveLog.textContent = `[${job.latestLog.source.toUpperCase()}] ${job.latestLog.message}`;
    }
    updatePlaylistItems(job.items);
    progressTitle.textContent = job.status === 'completed' ? (job.partial ? 'Delvis ferdig' : 'Filen er klar') : 'Behandler filen';
    progressDetail.textContent = detail;
    animateProgress(job.progress);

    if (job.status === 'completed') {
      cancelButton.hidden = true;
      downloadButton.hidden = false;
      downloadButton.disabled = false;
      downloadButton.firstChild.textContent = `LAST NED ${videoFormats.includes(job.format) ? 'VIDEO' : job.format.toUpperCase()} `;
      if (job.saveMode === 'media') showDriveLinks(job.jobNumber);
      return;
    }

    if (job.status === 'cancelled') {
      cancelButton.hidden = true;
      if (job.saveMode === 'media') {
        showDriveLinks(job.jobNumber);
      }
      setProgress(job.progress, 'Jobben er avbrutt', 'Nedlastingen ble stoppet.');
      return;
    }

    cancelButton.hidden = false;

    pollTimer = window.setTimeout(() => pollJob(jobId), 400);
  } catch (error) {
    if (cancellingJob) return;
    pollFailures += 1;
    progressTitle.textContent = 'Venter på serveren';
    progressDetail.textContent = `Midlertidig statusfeil (${pollFailures}/10). Prøver igjen...`;
    if (pollFailures >= 10) {
      formMessage.textContent = error.message;
      progressTitle.textContent = 'Kunne ikke lese jobbstatus';
      return;
    }
    pollTimer = window.setTimeout(() => pollJob(jobId), 1000);
  }
}

function showDriveLinks(jobNumber) {
  driveRootButton.hidden = false;
  driveJobButton.hidden = false;
  driveJobButton.href = `https://drive.lensmann.studio/files/LS%20NEDLASTEREN/jobb${jobNumber}/`;
}

urlInput.addEventListener('input', setUrlState);
formatInput.addEventListener('change', updateQualityOptions);

clearButton.addEventListener('click', () => {
  urlInput.value = '';
  urlInput.focus();
  setUrlState();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = selectedMediaUrl || urlInput.value.trim();
  formMessage.textContent = '';
  urlHint.classList.remove('error');

  if (!isValidUrl(url)) {
    formMessage.textContent = 'Skriv inn en gyldig http:// eller https://-adresse.';
    urlHint.classList.add('error');
    urlInput.focus();
    return;
  }

  resetProgress();
  progressPanel.hidden = false;
  progressPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setProgress(0, 'Klargjører filen', 'Sender jobben til serveren...');

  try {
    const response = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format: formatInput.value, quality: qualityInput.value, saveMode: saveModeInput.checked ? 'media' : 'temporary', speedMode: speedModeInput.checked ? 'info' : 'fast' })
    });
    const job = await readJsonResponse(response, 'Serveren returnerte ikke JSON. Sjekk at Apache peker på riktig backend.');
    if (!response.ok) throw new Error(job.error || 'Kunne ikke starte jobben.');
    currentJobId = job.jobId;
    jobNumberElement.textContent = `JOB / ${String(job.jobNumber).padStart(4, '0')}`;
    if (job.saveMode === 'media') showDriveLinks(job.jobNumber);
    await pollJob(currentJobId);
  } catch (error) {
    formMessage.textContent = error.message;
    progressPanel.hidden = true;
  }
});

downloadButton.addEventListener('click', async () => {
  if (!currentJobId || downloadButton.disabled) return;
  downloadButton.disabled = true;
  downloadButton.firstChild.textContent = 'FORBEREDER NEDLASTING ';
  try {
    const response = await fetch(`/api/jobs/${currentJobId}/download`);
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || 'Filen er ikke klar ennå.');
    }
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/)?.[1] || 'laensmann-download';
    link.click();
    URL.revokeObjectURL(link.href);
    downloadButton.firstChild.textContent = 'LAST NED IGJEN ';
  } catch (error) {
    formMessage.textContent = error.message;
    downloadButton.disabled = false;
    downloadButton.firstChild.textContent = 'LAST NED FIL ';
  }
});

async function cancelCurrentJob() {
  if (!currentJobId) return;
  cancelButton.disabled = true;
  cancellingJob = true;
  window.clearTimeout(pollTimer);
  try {
    await fetch(`/api/jobs/${currentJobId}`, { method: 'DELETE', keepalive: true });
    cancelButton.hidden = true;
    setProgress(progressValue.textContent.replace('%', ''), 'Jobben er avbrutt', 'Nedlastingen ble stoppet.');
    progressTitle.textContent = 'Jobben er avbrutt';
    progressDetail.textContent = 'Ingen flere statusforespørsler sendes.';
  } finally {
    cancelButton.disabled = false;
  }
}

cancelButton.addEventListener('click', cancelCurrentJob);

diagnosticsButton.addEventListener('click', async () => {
  logsPanel.hidden = false;
  loadSystemMonitor();
  if (!currentJobId) {
    logsStatus.textContent = 'Ingen aktiv jobb.';
    try {
      const response = await fetch('/api/logs');
      const payload = await readJsonResponse(response, 'Kunne ikke hente teknisk logg.');
      currentLogs = payload.logs;
      renderSelectedLogs();
    } catch (error) {
      logsContent.textContent = error.message;
    }
    return;
  }
  try {
    const statusResponse = await fetch(`/api/jobs/${currentJobId}`);
    const response = await fetch(`/api/jobs/${currentJobId}/logs`);
    const status = await readJsonResponse(statusResponse, 'Kunne ikke lese jobbstatus.');
    const payload = await readJsonResponse(response, 'Kunne ikke lese jobbloggen.');
    logsStatus.textContent = `Jobb ${currentJobId} · ${status.status} · ${status.progress}% · ${status.format}`;
    currentLogs = payload.logs;
    renderSelectedLogs();
  } catch {
    try {
      const response = await fetch('/api/logs');
      const payload = await readJsonResponse(response, 'Kunne ikke hente teknisk logg.');
      logsContent.textContent = payload.logs.map((entry) => `[${entry.time}] ${entry.level}: ${entry.message}`).join('\n') || 'Ingen systemlogger ennå.';
    } catch {
      logsContent.textContent = 'Kunne ikke hente teknisk logg.';
    }
  }
});

async function loadSystemMonitor() {
  try {
    const response = await fetch('/api/system');
    const system = await readJsonResponse(response, 'Kunne ikke hente serverstatus.');
    const formatBytes = (bytes) => `${(Number(bytes) / 1024 / 1024 / 1024).toFixed(1)} GB`;
    systemMonitor.hidden = false;
    systemMonitor.innerHTML = `<div><strong>CPU</strong><span>${system.cpuPercent}%</span></div><div><strong>RAM</strong><span>${system.memoryPercent}% (${formatBytes(system.memoryUsed)} / ${formatBytes(system.memoryTotal)})</span></div><div><strong>DISK</strong><span>${formatBytes(system.diskFree)} ledig av ${formatBytes(system.diskTotal)}</span></div><div><strong>JOBBER</strong><span>${system.jobs.active} aktive · ${system.jobs.queued} i kø · maks ${system.jobs.maxConcurrent}</span></div><div><strong>VERKTØY</strong><span>yt-dlp ${system.versions['yt-dlp']} · FFmpeg ${system.versions.ffmpeg}</span></div>`;
  } catch (error) {
    systemMonitor.hidden = false;
    systemMonitor.textContent = error.message;
  }
}

function renderSelectedLogs() {
  const logs = currentLogs.filter((entry) => (entry.source || 'app') === selectedLogSource);
  logsContent.textContent = logs.map((entry) => `[${entry.time}] ${entry.message}`).join('\n') || 'Ingen logger i denne fanen ennå.';
}

logsClose.addEventListener('click', () => { logsPanel.hidden = true; });
logTabs.forEach((tab) => tab.addEventListener('click', () => {
  selectedLogSource = tab.dataset.logSource;
  logTabs.forEach((item) => item.classList.toggle('is-active', item === tab));
  renderSelectedLogs();
}));
kevinTrigger.addEventListener('click', () => {
  kevinModal.hidden = false;
  kevinModalClose.focus();
});
kevinModalClose.addEventListener('click', () => { kevinModal.hidden = true; });
kevinModal.addEventListener('click', (event) => {
  if (event.target === kevinModal) kevinModal.hidden = true;
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    kevinModal.hidden = true;
    logsPanel.hidden = true;
  }
});
urlMode.addEventListener('click', () => setInputMode('url'));
searchMode.addEventListener('click', () => setInputMode('search'));
searchButton.addEventListener('click', performSearch);
searchQuery.addEventListener('keydown', (event) => { if (event.key === 'Enter') performSearch(); });
urlInput.addEventListener('input', () => { selectedMediaUrl = ''; });

updateQualityOptions();
