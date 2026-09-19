const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const downloadsDirectory = path.resolve(process.env.DOWNLOAD_DIR || path.join(__dirname, '..', 'downloads'));
const jobTimeout = Number(process.env.JOB_TIMEOUT) || 600000;

function isSpotifyUrl(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  return hostname === 'spotify.com' || hostname.endsWith('.spotify.com');
}

function buildCommand({ url, format, quality, jobDirectory }) {
  if (isSpotifyUrl(url)) {
    if (format !== 'mp3') throw new Error('Spotify støttes bare med MP3-format.');
    return {
      command: process.platform === 'win32' ? 'spotdl.exe' : 'spotdl',
      args: ['download', url, '--output', path.join(jobDirectory, '{artist} - {title}.{output-ext}'), '--format', 'mp3', '--bitrate', `${quality}k`]
    };
  }

  const outputTemplate = path.join(jobDirectory, '%(title)s-%(id)s.%(ext)s');
  const args = ['--no-playlist', '--newline', '--restrict-filenames', '--max-filesize', '500M', '--output', outputTemplate];
  if (format === 'mp3') {
    args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', `${quality}K`);
  } else {
    args.push('--format', `bestvideo*[height<=${quality}]+bestaudio/best[height<=${quality}]`, '--merge-output-format', 'mp4');
  }
  args.push(url);
  return { command: process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp', args };
}

function parseProgress(line) {
  const match = line.match(/(\d+(?:\.\d+)?)%/);
  return match ? Math.min(99, Math.round(Number(match[1]))) : null;
}

async function findOutputFile(jobDirectory) {
  const entries = await fs.readdir(jobDirectory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  if (files.length !== 1) throw new Error('Downloaderen returnerte ikke nøyaktig én fil.');
  return path.join(jobDirectory, files[0]);
}

async function runDownload({ jobId, url, format, quality, onProgress }) {
  const jobDirectory = path.join(downloadsDirectory, jobId);
  await fs.mkdir(jobDirectory, { recursive: true });
  const { command, args } = buildCommand({ url, format, quality, jobDirectory });
  console.log(`[INFO] Starter ${command} for jobb ${jobId}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error('Jobben tok for lang tid.'));
    }, jobTimeout);

    function finish(error, outputFile) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      error ? reject(error) : resolve(outputFile);
    }

    child.stdout.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        const progress = parseProgress(line);
        if (progress !== null) onProgress(progress);
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => finish(error.code === 'ENOENT' ? new Error(`${command} er ikke installert på serveren.`) : error));
    child.on('close', async (code) => {
      if (code !== 0) {
        const detail = stderr.trim().split('\n').pop() || `exit code ${code}`;
        finish(new Error(`Downloader feilet: ${detail}`));
        return;
      }
      try { finish(null, await findOutputFile(jobDirectory)); } catch (error) { finish(error); }
    });
  });
}

async function removeJobFiles(jobId) {
  await fs.rm(path.join(downloadsDirectory, jobId), { recursive: true, force: true });
}

async function cleanupDownloads() {
  const retentionMs = Number(process.env.FILE_RETENTION_MS) || 900000;
  const now = Date.now();
  await fs.mkdir(downloadsDirectory, { recursive: true });
  const entries = await fs.readdir(downloadsDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(downloadsDirectory, entry.name);
    const stats = await fs.stat(directory);
    if (now - stats.mtimeMs > retentionMs) {
      await fs.rm(directory, { recursive: true, force: true });
      console.log(`[INFO] Removed expired job files ${entry.name}`);
    }
  }
}

module.exports = { cleanupDownloads, downloadsDirectory, removeJobFiles, runDownload };