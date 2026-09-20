const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { removeJobFiles, runDownload } = require('./media-downloader');
const { addSystemLog } = require('./log-store');

const jobs = new Map();
const maxConcurrentJobs = Number(process.env.MAX_CONCURRENT_JOBS) || 5;
let activeJobs = 0;
let nextJobNumber = 1;

function createJob({ url, format, quality, saveMode = 'temporary', speedMode = 'info' }) {
  const job = {
    jobId: randomUUID(),
    jobNumber: nextJobNumber++,
    url,
    format,
    quality,
    saveMode,
    speedMode,
    status: 'queued',
    progress: 0,
    phase: 'Venter i kø',
    transfer: null,
    latestLog: null,
    metadata: null,
    items: [],
    createdAt: new Date().toISOString(),
    outputFile: null
  };

  jobs.set(job.jobId, job);
  console.log(`[INFO] Job created ${job.jobId} (${job.status})`);
  processQueue();
  return publicJob(job);
}

function getJob(jobId) {
  const job = jobs.get(jobId);
  return job ? publicJob(job) : null;
}

function getJobRecord(jobId) {
  return jobs.get(jobId) || null;
}

function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (['completed', 'failed', 'cancelled', 'expired'].includes(job.status)) return job;
  job.cancelRequested = true;
  job.status = 'cancelled';
  addLog(job, 'Jobb avbrutt av brukeren.');
  if (job.process) job.process.kill('SIGTERM');
  return job;
}

function publicJob(job) {
  return {
    jobId: job.jobId,
    jobNumber: job.jobNumber,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    ...(job.transfer ? { transfer: job.transfer } : {}),
    ...(job.latestLog ? { latestLog: job.latestLog } : {}),
    format: job.format,
    speedMode: job.speedMode,
    saveMode: job.saveMode,
    ...(job.metadata ? { metadata: job.metadata } : {}),
    ...(job.items.length ? { items: job.items } : {}),
    ...(job.filename ? { filename: job.filename } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(job.directory ? { directory: job.directory } : {}),
    ...(job.partial ? { partial: true, partialError: job.partialError } : {}),
    ...(job.logs ? { logCount: job.logs.length } : {}),
    createdAt: job.createdAt
  };
}

function processQueue() {
  if (activeJobs >= maxConcurrentJobs) return;
  const nextJob = [...jobs.values()].find((job) => job.status === 'queued');
  if (!nextJob) return;

  activeJobs += 1;
  nextJob.status = 'processing';
  nextJob.phase = 'Henter metadata';
  addLog(nextJob, `Jobb startet: ${nextJob.format}, lagring=${nextJob.saveMode}`);
  addSystemLog('INFO', `Jobb ${nextJob.jobNumber} startet`);
  console.log(`[INFO] Job started ${nextJob.jobId}`);

  runDownload({
    ...nextJob,
    onProgress: (progress) => { nextJob.progress = progress; },
    onTransfer: (transfer) => {
      nextJob.transfer = transfer;
      nextJob.progress = Math.max(nextJob.progress, transfer.percent);
    },
    onMetadata: (metadata) => {
      nextJob.metadata = metadata;
      nextJob.phase = 'Laster ned';
      nextJob.items = (metadata.items || []).map((item) => ({ ...item, status: 'queued', progress: 0 }));
      addLog(nextJob, `Metadata mottatt: ${metadata.title}`);
    },
    onItemProgress: (index, progress, total) => {
      const item = nextJob.items.find((entry) => entry.index === index);
      if (item) { item.status = progress >= 100 ? 'completed' : 'processing'; item.progress = progress; }
      if (!item && total) nextJob.items.push({ index, title: `Element ${index}`, status: 'processing', progress });
    },
    onProcess: (process) => {
      nextJob.process = process;
      if (nextJob.cancelRequested) process.kill('SIGTERM');
    },
    onDirectory: (directory) => { nextJob.directory = directory; },
    onLog: (message, source) => addLog(nextJob, message, source)
  })
    .then(async ({ outputFile, partial, errorMessage }) => {
      nextJob.progress = 100;
      nextJob.partial = partial;
      nextJob.partialError = errorMessage;
      nextJob.phase = partial ? 'Delvis ferdig' : 'Ferdig';
      nextJob.status = 'completed';
      nextJob.outputFile = outputFile;
      nextJob.filename = outputFile.split(/[\\/]/).pop();
      addLog(nextJob, partial ? `Delvis ferdig: ${errorMessage || 'Noen elementer kunne ikke lastes ned.'}` : 'Nedlasting og behandling fullført.');
      addSystemLog('INFO', `Jobb ${nextJob.jobNumber} fullført`);
      console.log(`[INFO] Job completed ${nextJob.jobId}`);
    })
    .catch(async (error) => {
      if (nextJob.cancelRequested) {
        if (nextJob.saveMode !== 'media') {
          if (nextJob.directory) await fs.rm(nextJob.directory, { recursive: true, force: true });
          else await removeJobFiles(nextJob.jobId);
        }
        addSystemLog('INFO', `Jobb ${nextJob.jobNumber} avbrutt`);
        return;
      }
      nextJob.status = 'failed';
      nextJob.phase = 'Feilet';
      nextJob.error = error.message;
      addLog(nextJob, `FEIL: ${error.message}`);
      addSystemLog('ERROR', `Jobb ${nextJob.jobNumber}: ${error.message}`);
      if (nextJob.saveMode !== 'media') {
        if (nextJob.directory) await fs.rm(nextJob.directory, { recursive: true, force: true });
        else await removeJobFiles(nextJob.jobId);
      }
      console.error(`[ERROR] Job failed ${nextJob.jobId}: ${error.message}`);
    })
    .finally(() => {
      activeJobs -= 1;
      processQueue();
    });
}

function addLog(job, message, source = 'app') {
  if (!job.logs) job.logs = [];
  const entry = { time: new Date().toISOString(), source, message: String(message).slice(0, 500) };
  job.latestLog = entry;
  job.logs.push(entry);
  if (source === 'ytdlp' || source === 'ffmpeg') addSystemLog('INFO', message, source);
  if (job.logs.length > 200) job.logs.shift();
}

function getJobLogs(jobId) {
  const job = jobs.get(jobId);
  return job ? job.logs || [] : null;
}

function getJobStats() {
  let queued = 0;
  let processing = 0;
  for (const job of jobs.values()) {
    if (job.status === 'queued') queued += 1;
    if (job.status === 'processing') processing += 1;
  }
  return { active: processing, queued, total: jobs.size, maxConcurrent: maxConcurrentJobs };
}

function shutdownJobs() {
  for (const job of jobs.values()) {
    if (job.status === 'processing') {
      if (job.process) job.process.kill('SIGTERM');
      if (job.directory) fs.rm(job.directory, { recursive: true, force: true });
      else removeJobFiles(job.jobId);
    }
  }
}

module.exports = { cancelJob, createJob, getJob, getJobLogs, getJobRecord, getJobStats, shutdownJobs };
