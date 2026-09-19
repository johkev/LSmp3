const path = require('node:path');
const express = require('express');
const { createJob, getJob, getJobRecord, shutdownJobs } = require('./job-store');
const { cleanupDownloads, removeJobFiles } = require('./media-downloader');

const app = express();
const port = Number(process.env.PORT) || 3002;
const host = process.env.HOST || '127.0.0.1';
const publicDirectory = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

app.get('/api/health', (request, response) => {
  response.json({
    status: 'ok',
    service: 'laensmann-mp3',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/jobs', (request, response) => {
  const { url, format = 'mp3', quality = '320' } = request.body || {};

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return response.status(400).json({ error: 'URL-en er ugyldig.' });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return response.status(400).json({ error: 'URL-en må bruke http eller https.' });
  }

  if (!['mp3', 'mp4'].includes(format)) {
    return response.status(400).json({ error: 'Formatet støttes ikke.' });
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isSpotify = hostname === 'spotify.com' || hostname.endsWith('.spotify.com');
  if (isSpotify && format !== 'mp3') {
    return response.status(400).json({ error: 'Spotify støttes bare med MP3-format.' });
  }

  const validQualities = format === 'mp4' ? ['360', '480', '720', '1080'] : ['128', '192', '256', '320'];
  if (!validQualities.includes(String(quality))) {
    return response.status(400).json({ error: 'Kvaliteten støttes ikke.' });
  }

  const job = createJob({ url: parsedUrl.toString(), format, quality: String(quality) });
  return response.status(202).json(job);
});

app.get('/api/jobs/:id', (request, response) => {
  const job = getJob(request.params.id);
  if (!job) {
    return response.status(404).json({ error: 'Jobben finnes ikke.' });
  }

  return response.json(job);
});

app.get('/api/jobs/:id/download', (request, response) => {
  const job = getJobRecord(request.params.id);
  if (!job) return response.status(404).json({ error: 'Jobben finnes ikke.' });
  if (job.status !== 'completed') return response.status(409).json({ error: 'Filen er ikke klar ennå.' });

  return response.download(job.outputFile, job.filename, async (error) => {
    if (error) {
      if (!response.headersSent) response.status(500).json({ error: 'Kunne ikke sende filen.' });
      return;
    }
    await removeJobFiles(job.jobId);
    job.status = 'expired';
    job.outputFile = null;
  });
});

app.use(express.static(publicDirectory));

app.use('/api', (request, response) => {
  response.status(404).json({ error: 'API-endepunktet finnes ikke.' });
});

app.use((error, request, response, next) => {
  if (error instanceof SyntaxError && error.status === 400 && error.body) {
    return response.status(400).json({ error: 'Ugyldig JSON i forespørselen.' });
  }

  console.error('[ERROR] Uventet serverfeil', error);
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