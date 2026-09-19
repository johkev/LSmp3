const { randomUUID } = require('node:crypto');
const { removeJobFiles, runDownload } = require('./media-downloader');

const jobs = new Map();
const maxConcurrentJobs = Number(process.env.MAX_CONCURRENT_JOBS) || 2;
let activeJobs = 0;

function createJob({ url, format, quality }) {
  const job = {
    jobId: randomUUID(),
    url,
    format,
    quality,
    status: 'queued',
    progress: 0,
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
    status: job.status,
    progress: job.progress,
    format: job.format,
    ...(job.filename ? { filename: job.filename } : {}),
    ...(job.error ? { error: job.error } : {}),
    createdAt: job.createdAt
  };
}

function processQueue() {
  if (activeJobs >= maxConcurrentJobs) return;
  const nextJob = [...jobs.values()].find((job) => job.status === 'queued');
  if (!nextJob) return;

  activeJobs += 1;
  nextJob.status = 'processing';
  console.log(`[INFO] Job started ${nextJob.jobId}`);

  runDownload({ ...nextJob, onProgress: (progress) => { nextJob.progress = progress; } })
    .then((outputFile) => {
      nextJob.progress = 100;
      nextJob.status = 'completed';
      nextJob.outputFile = outputFile;
      nextJob.filename = outputFile.split(/[\\/]/).pop();
      console.log(`[INFO] Job completed ${nextJob.jobId}`);
    })
    .catch(async (error) => {
      nextJob.status = 'failed';
      nextJob.error = error.message;
      await removeJobFiles(nextJob.jobId);
      console.error(`[ERROR] Job failed ${nextJob.jobId}: ${error.message}`);
    })
    .finally(() => {
      activeJobs -= 1;
      processQueue();
    });
}

function shutdownJobs() {
  for (const job of jobs.values()) {
    if (job.status === 'processing') removeJobFiles(job.jobId);
  }
}

module.exports = { createJob, getJob, getJobRecord, shutdownJobs };
