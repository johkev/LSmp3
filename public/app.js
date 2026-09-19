const form = document.querySelector('#converter-form');
const urlInput = document.querySelector('#media-url');
const clearButton = document.querySelector('#clear-url');
const urlHint = document.querySelector('#url-hint');
const formMessage = document.querySelector('#form-message');
const formatInput = document.querySelector('#format');
const qualityInput = document.querySelector('#quality');
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

const audioQualities = [
  ['320', '320 kbps'],
  ['256', '256 kbps'],
  ['192', '192 kbps'],
  ['128', '128 kbps']
];
const videoQualities = [
  ['1080', '1080p'],
  ['720', '720p'],
  ['480', '480p'],
  ['360', '360p']
];

let currentJobId = null;
let pollTimer;

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
  const options = formatInput.value === 'mp4' ? videoQualities : audioQualities;
  qualityInput.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
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
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || 'Kunne ikke hente jobbstatus.');

    if (job.status === 'failed') {
      throw new Error(job.error || 'Serveren klarte ikke å behandle filen.');
    }

    const detail = job.status === 'queued' ? 'Venter i kø...' : job.status === 'processing' ? 'Behandler innhold...' : 'Filen er klar.';
    showMetadata(job.metadata);
    setProgress(job.progress, job.status === 'completed' ? 'Filen er klar' : 'Behandler filen', detail);

    if (job.status === 'completed') {
      downloadButton.hidden = false;
      downloadButton.firstChild.textContent = `LAST NED ${job.format === 'mp4' ? 'VIDEO' : 'MP3'} `;
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
  const url = urlInput.value.trim();
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
      body: JSON.stringify({ url, format: formatInput.value, quality: qualityInput.value })
    });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || 'Kunne ikke starte jobben.');
    currentJobId = job.jobId;
    await pollJob(currentJobId);
  } catch (error) {
    formMessage.textContent = error.message;
    progressPanel.hidden = true;
  }
});

downloadButton.addEventListener('click', () => {
  if (currentJobId) window.location.href = `/api/jobs/${currentJobId}/download`;
});

updateQualityOptions();
