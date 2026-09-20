const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const express = require('express');
const { cancelJob, createJob, getJob, getJobLogs, getJobRecord, getJobStats, shutdownJobs } = require('./job-store');
const { cleanupDownloads, createArchiveCopy, createArchiveFileName, downloadsDirectory, mediaDirectory, removeJobFiles, searchMedia } = require('./media-downloader');
const { addSystemLog, getSystemLogs } = require('./log-store');

const app = express();
const port = Number(process.env.PORT) || 3002;
const host = process.env.HOST || '127.0.0.1';
const publicDirectory = path.join(__dirname, '..', 'public');
const execFileAsync = promisify(execFile);
let previousCpu = os.cpus();

function normalizeMediaUrl(value) {
  const parsedUrl = new URL(value);
  if (parsedUrl.hostname.toLowerCase().endsWith('youtube.com') && parsedUrl.pathname === '/watch' && parsedUrl.searchParams.get('v')) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(parsedUrl.searchParams.get('v'))}`;
  }
  return parsedUrl.toString();
}

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

app.get('/api/health', (request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json({
    status: 'ok',
    service: 'laensmann-mp3',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/search', async (request, response) => {
  const query = String(request.query.q || '').trim();
  const source = String(request.query.source || 'youtube');
  if (query.length < 2 || query.length > 200) {
    return response.status(400).json({ error: 'Søket må være mellom 2 og 200 tegn.' });
  }
  if (!['youtube', 'soundcloud'].includes(source)) {
    return response.status(400).json({ error: 'Søkekilden støttes ikke.' });
  }
  try {
    return response.json({ source, results: await searchMedia(source, query) });
  } catch (error) {
    addSystemLog('ERROR', `Søk (${source}): ${error.message}`);
    return response.status(502).json({ error: error.message });
  }
});

app.get('/api/logs', (request, response) => {
  response.set('Cache-Control', 'no-store');
  const source = ['app', 'ffmpeg', 'ytdlp'].includes(request.query.source) ? request.query.source : undefined;
  return response.json({ logs: getSystemLogs({ source, limit: 80 }) });
});

app.get('/api/system', async (request, response) => {
  try {
    const currentCpu = os.cpus();
    const cpuUsage = currentCpu.reduce((total, cpu, index) => {
      const before = previousCpu[index]?.times || cpu.times;
      const beforeTotal = Object.values(before).reduce((sum, value) => sum + value, 0);
      const currentTotal = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
      return total + (currentTotal > beforeTotal ? 1 - ((cpu.times.idle - before.idle) / (currentTotal - beforeTotal)) : 0);
    }, 0) / currentCpu.length;
    previousCpu = currentCpu;
    const memoryUsed = os.totalmem() - os.freemem();
    const mediaPath = process.env.MEDIA_DIR || '/mnt/media2/Lænsmann Studio';
    const disk = await fs.statfs(mediaPath).catch(() => fs.statfs(publicDirectory));
    const diskTotal = Number(disk.blocks) * Number(disk.bsize);
    const diskFree = Number(disk.bavail) * Number(disk.bsize);
    const commands = { 'yt-dlp': ['yt-dlp'], spotdl: ['spotdl'], ffmpeg: ['ffmpeg', '/usr/bin/ffmpeg'] };
    const versions = await Promise.all(Object.entries(commands).map(async ([command, candidates]) => {
      for (const candidate of candidates) {
      try {
        const { stdout, stderr } = await execFileAsync(candidate, ['--version'], { timeout: 5000 });
        return [command, (stdout || stderr).trim().split(/\r?\n/)[0]];
      } catch (error) { /* Try the next known executable path. */ }
      }
      return [command, 'ikke tilgjengelig'];
    }));
    return response.json({
      cpuPercent: Math.round(cpuUsage * 100),
      memoryPercent: Math.round((memoryUsed / os.totalmem()) * 100),
      memoryUsed,
      memoryTotal: os.totalmem(),
      diskFree,
      diskTotal,
      jobs: getJobStats(),
      versions: Object.fromEntries(versions),
      uptime: os.uptime()
    });
  } catch (error) {
    addSystemLog('ERROR', `Systemmonitor: ${error.message}`);
    return response.status(500).json({ error: 'Kunne ikke lese serverstatus.' });
  }
});

app.post('/api/jobs', (request, response) => {
  const { url, format = 'mp3', quality = '320', saveMode = 'temporary', speedMode = 'info' } = request.body || {};

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return response.status(400).json({ error: 'URL-en er ugyldig.' });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return response.status(400).json({ error: 'URL-en må bruke http eller https.' });
  }

  const audioFormats = ['mp3', 'm4a', 'flac', 'ogg', 'opus', 'wav'];
  const videoFormats = ['mp4', 'mkv', 'webm'];
  if (![...audioFormats, ...videoFormats].includes(format)) {
    return response.status(400).json({ error: 'Formatet støttes ikke.' });
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isSpotify = hostname === 'spotify.com' || hostname.endsWith('.spotify.com');
  if (isSpotify && !audioFormats.includes(format)) {
    return response.status(400).json({ error: 'Spotify støtter bare lydformatene MP3, M4A, FLAC, OGG, OPUS og WAV.' });
  }

  const validQualities = videoFormats.includes(format) ? ['360', '480', '720', '1080', '1440', '2160'] : ['96', '128', '160', '192', '256', '320'];
  if (!validQualities.includes(String(quality))) {
    return response.status(400).json({ error: 'Kvaliteten støttes ikke.' });
  }

  if (!['temporary', 'media'].includes(saveMode)) {
    return response.status(400).json({ error: 'Lagringsmålet støttes ikke.' });
  }
  if (!['fast', 'info'].includes(speedMode)) {
    return response.status(400).json({ error: 'Nedlastingsmodusen støttes ikke.' });
  }

  const normalizedUrl = normalizeMediaUrl(parsedUrl.toString());
  const job = createJob({ url: normalizedUrl, format, quality: String(quality), saveMode, speedMode });
  addSystemLog('INFO', `Jobb ${job.jobNumber} opprettet`);
  return response.status(202).json(job);
});

app.get('/api/jobs/:id', (request, response) => {
  response.set('Cache-Control', 'no-store');
    response.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    response.set('Content-Type', 'application/json; charset=utf-8');
  const job = getJob(request.params.id);
  if (!job) {
    return response.status(404).json({ error: 'Jobben finnes ikke.' });
  }

  return response.json(job);
});

app.get('/api/jobs/:id/logs', (request, response) => {
  const source = ['app', 'ffmpeg', 'ytdlp'].includes(request.query.source) ? request.query.source : undefined;
  const logs = getJobLogs(request.params.id, { source, limit: 80 });
  if (!logs) return response.status(404).json({ error: 'Jobben finnes ikke.' });
  return response.json({ jobId: request.params.id, logs });
});

app.delete('/api/jobs/:id', (request, response) => {
  const job = cancelJob(request.params.id);
  if (!job) return response.status(404).json({ error: 'Jobben finnes ikke.' });
  return response.json({ jobId: job.jobId, status: job.status });
});

app.get('/api/jobs/:id/download', (request, response) => {
  const job = getJobRecord(request.params.id);
  const recoveryRequested = request.query.recover === '1';
  if (!job) {
    const jobNumber = String(request.query.jobNumber || '');
    if (!/^\d+$/.test(jobNumber)) return response.status(404).type('text').send('Jobben finnes ikke lenger.');
    return sendRecoveredMediaJob(response, jobNumber);
  }
  if (recoveryRequested && job.saveMode === 'media') return sendRecoveredMediaJob(response, job.jobNumber, job.metadata);
  if (!['completed', 'failed', 'interrupted', 'cancelled'].includes(job.status)) {
    return response.status(409).type('text').send('Filen er ikke klar ennå. Vent til jobben er ferdig.');
  }

  if (!job.outputFile && job.saveMode === 'media') return sendRecoveredMediaJob(response, job.jobNumber, job.metadata);

  if (job.saveMode === 'media') {
    return fs.access(job.outputFile)
      .then(() => sendJobFile(response, job))
      .catch(() => sendRecoveredMediaJob(response, job.jobNumber, job.metadata));
  }

  return sendJobFile(response, job);
});

function sendJobFile(response, job) {
  return response.download(job.outputFile, job.filename, async (error) => {
    if (error) {
      if (job.saveMode === 'media') {
        sendRecoveredMediaJob(response, job.jobNumber, job.metadata).catch(() => {});
        return;
      }
      if (!response.headersSent) response.status(500).type('text').send('Kunne ikke sende filen. Prøv igjen.');
      return;
    }
    if (job.saveMode === 'temporary') {
      await removeJobFiles(job.jobId, job.saveMode);
      job.status = 'expired';
      job.outputFile = null;
    }
  });
}

async function sendRecoveredMediaJob(response, jobNumber, metadata = null) {
  const directory = path.join(mediaDirectory, `jobb${jobNumber}`);
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile()).map((entry) => path.join(directory, entry.name));
    if (!files.length) return response.status(404).type('text').send('Ingen ferdige filer finnes i jobbmappen.');
    if (files.length === 1) return response.download(files[0], path.basename(files[0]));
    const archivePath = path.join(downloadsDirectory, createArchiveFileName(metadata?.playlistTitle || metadata?.title || `jobb${jobNumber}-resultat`));
    await createArchiveCopy(directory, archivePath);
    return response.download(archivePath, path.basename(archivePath), () => {
      fs.rm(archivePath, { force: true }).catch(() => {});
    });
  } catch (error) {
    return response.status(500).type('text').send(`Kunne ikke hente jobbfilene: ${error.message}`);
  }
}

app.use(express.static(publicDirectory));

app.use('/api', (request, response) => {
  response.status(404).json({ error: 'API-endepunktet finnes ikke.' });
});

app.use((error, request, response, next) => {
  if (error instanceof SyntaxError && error.status === 400 && error.body) {
    return response.status(400).json({ error: 'Ugyldig JSON i forespørselen.' });
  }

  console.error('[ERROR] Uventet serverfeil', error);
  addSystemLog('ERROR', error.message || 'Uventet serverfeil');
  return response.status(500).json({ error: 'En intern serverfeil oppstod.' });
});

const server = app.listen(port, host, () => {
  console.log(`[INFO] Lænsmann MP3 kjører på http://${host}:${port}`);
});
const cleanupInterval = setInterval(() => {
  cleanupDownloads().catch((error) => console.error('[ERROR] Cleanup feilet', error));
}, Number(process.env.CLEANUP_INTERVAL_MS) || 60000);
cleanupDownloads().catch((error) => console.error('[ERROR] Cleanup feilet', error));

function shutDown(signal) {
  console.log(`[INFO] Mottok ${signal}, avslutter serveren`);
  clearInterval(cleanupInterval);
  shutdownJobs();
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutDown('SIGINT'));
process.on('SIGTERM', () => shutDown('SIGTERM'));