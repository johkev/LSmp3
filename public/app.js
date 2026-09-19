const form = document.querySelector('#converter-form');
const urlInput = document.querySelector('#media-url');
const clearButton = document.querySelector('#clear-url');
const urlHint = document.querySelector('#url-hint');
const formMessage = document.querySelector('#form-message');
const formatInput = document.querySelector('#format');
const qualityInput = document.querySelector('#quality');
const saveModeInput = document.querySelector('#save-mode');
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
const mediaSummary = document.querySelector('#media-summary');
const mediaThumbnail = document.querySelector('#media-thumbnail');
const mediaTitle = document.querySelector('#media-title');
const mediaMeta = document.querySelector('#media-meta');
const diagnosticsButton = document.querySelector('#diagnostics-button');
const logsPanel = document.querySelector('#logs-panel');
const logsClose = document.querySelector('#logs-close');
const logsContent = document.querySelector('#logs-content');
const logsStatus = document.querySelector('#logs-status');
const jobNumberElement = document.querySelector('#job-number');
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
let selectedMediaUrl = '';

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
  progressPanel.hidden = true;
  downloadButton.hidden = true;
  mediaSummary.hidden = true;
  mediaThumbnail.removeAttribute('src');
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
}

async function pollJob(jobId) {
  try {
    const response = await fetch(`/api/jobs/${jobId}`);
    const job = await readJsonResponse(response, 'Status-endepunktet returnerte ikke JSON.');
    if (!response.ok) throw new Error(job.error || 'Kunne ikke hente jobbstatus.');

    if (job.status === 'failed') {
      throw new Error(job.error || 'Serveren klarte ikke å behandle filen.');
    }

    const detail = job.status === 'queued' ? 'Venter i kø...' : job.status === 'processing' ? 'Behandler innhold...' : 'Filen er klar.';
    showMetadata(job.metadata);
    setProgress(job.progress, job.status === 'completed' ? 'Filen er klar' : 'Behandler filen', detail);

    if (job.status === 'completed') {
      downloadButton.hidden = false;
      downloadButton.firstChild.textContent = `LAST NED ${videoFormats.includes(job.format) ? 'VIDEO' : job.format.toUpperCase()} `;
      return;
    }

    pollTimer = window.setTimeout(() => pollJob(jobId), 700);
  } catch (error) {
    progressTitle.textContent = 'Jobben feilet';
    progressDetail.textContent = error.message;
    formMessage.textContent = 'Kunne ikke fullføre nedlastingen. Kontroller URL-en og prøv igjen.';
  }
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
      body: JSON.stringify({ url, format: formatInput.value, quality: qualityInput.value, saveMode: saveModeInput.checked ? 'media' : 'temporary' })
    });
    const job = await readJsonResponse(response, 'Serveren returnerte ikke JSON. Sjekk at Apache peker på riktig backend.');
    if (!response.ok) throw new Error(job.error || 'Kunne ikke starte jobben.');
    currentJobId = job.jobId;
    jobNumberElement.textContent = `JOB / ${String(job.jobNumber).padStart(4, '0')}`;
    await pollJob(currentJobId);
  } catch (error) {
    formMessage.textContent = error.message;
    progressPanel.hidden = true;
  }
});

downloadButton.addEventListener('click', () => {
  if (currentJobId) window.location.href = `/api/jobs/${currentJobId}/download`;
});

diagnosticsButton.addEventListener('click', async () => {
  logsPanel.hidden = false;
  if (!currentJobId) {
    logsStatus.textContent = 'Ingen aktiv jobb.';
    return;
  }
  try {
    const statusResponse = await fetch(`/api/jobs/${currentJobId}`);
    const response = await fetch(`/api/jobs/${currentJobId}/logs`);
    const status = await readJsonResponse(statusResponse, 'Kunne ikke lese jobbstatus.');
    const payload = await readJsonResponse(response, 'Kunne ikke lese jobbloggen.');
    logsStatus.textContent = `Jobb ${currentJobId} · ${status.status} · ${status.progress}% · ${status.format}`;
    logsContent.textContent = payload.logs.map((entry) => `[${entry.time}] ${entry.message}`).join('\n') || 'Ingen logger ennå.';
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

logsClose.addEventListener('click', () => { logsPanel.hidden = true; });
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
