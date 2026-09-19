const { randomUUID } = require('node:crypto');
const { removeJobFiles, runDownload } = require('./media-downloader');
const { addSystemLog } = require('./log-store');

const jobs = new Map();
const maxConcurrentJobs = Number(process.env.MAX_CONCURRENT_JOBS) || 5;
let activeJobs = 0;
let nextJobNumber = 1;

function createJob({ url, format, quality, saveMode = 'temporary' }) {
  const job = {
    jobId: randomUUID(),
    jobNumber: nextJobNumber++,
    url,
    format,
    quality,
    saveMode,
    status: 'queued',
    progress: 0,
    metadata: null,
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

function publicJob(job) {
  return {
    jobId: job.jobId,
    jobNumber: job.jobNumber,
    status: job.status,
    progress: job.progress,
    format: job.format,
    saveMode: job.saveMode,
    ...(job.metadata ? { metadata: job.metadata } : {}),
    ...(job.filename ? { filename: job.filename } : {}),
    ...(job.error ? { error: job.error } : {}),
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
  addLog(nextJob, `Jobb startet: ${nextJob.format}, lagring=${nextJob.saveMode}`);
  addSystemLog('INFO', `Jobb ${nextJob.jobNumber} startet`);
  console.log(`[INFO] Job started ${nextJob.jobId}`);

  runDownload({
    ...nextJob,
    onProgress: (progress) => { nextJob.progress = progress; },
    onMetadata: (metadata) => { nextJob.metadata = metadata; addLog(nextJob, `Metadata mottatt: ${metadata.title}`); },
    onLog: (message) => addLog(nextJob, message)
  })
    .then((outputFile) => {
      nextJob.progress = 100;
      nextJob.status = 'completed';
      nextJob.outputFile = outputFile;
      nextJob.filename = outputFile.split(/[\\/]/).pop();
      addLog(nextJob, 'Nedlasting og behandling fullført.');
      addSystemLog('INFO', `Jobb ${nextJob.jobNumber} fullført`);
      console.log(`[INFO] Job completed ${nextJob.jobId}`);
    })
    .catch(async (error) => {
      nextJob.status = 'failed';
      nextJob.error = error.message;
      addLog(nextJob, `FEIL: ${error.message}`);
      addSystemLog('ERROR', `Jobb ${nextJob.jobNumber}: ${error.message}`);
      await removeJobFiles(nextJob.jobId, nextJob.saveMode);
      console.error(`[ERROR] Job failed ${nextJob.jobId}: ${error.message}`);
    })
    .finally(() => {
      activeJobs -= 1;
      processQueue();
    });
}

function addLog(job, message) {
  if (!job.logs) job.logs = [];
  job.logs.push({ time: new Date().toISOString(), message: String(message).slice(0, 500) });
  if (job.logs.length > 200) job.logs.shift();
}

function getJobLogs(jobId) {
  const job = jobs.get(jobId);
  return job ? job.logs || [] : null;
}

function shutdownJobs() {
  for (const job of jobs.values()) {
    if (job.status === 'processing') removeJobFiles(job.jobId, job.saveMode);
  }
}

module.exports = { createJob, getJob, getJobLogs, getJobRecord, shutdownJobs };
