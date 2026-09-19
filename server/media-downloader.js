const fs = require('node:fs/promises');
const path = require('node:path');
const { createWriteStream } = require('node:fs');
const { spawn } = require('node:child_process');
const archiver = require('archiver');

const downloadsDirectory = path.resolve(process.env.DOWNLOAD_DIR || path.join(__dirname, '..', 'downloads'));
const mediaDirectory = path.resolve(process.env.MEDIA_DIR || '/mnt/media2/Lænsmann Studio');
const jobTimeout = Number(process.env.JOB_TIMEOUT) || 600000;

function isSpotifyUrl(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  return hostname === 'spotify.com' || hostname.endsWith('.spotify.com');
}

function buildCommand({ url, format, quality, jobDirectory }) {
  if (isSpotifyUrl(url)) {
    if (!['mp3', 'm4a', 'flac', 'ogg', 'opus', 'wav'].includes(format)) {
      throw new Error('Spotify støtter bare lydformatene MP3, M4A, FLAC, OGG, OPUS og WAV.');
    }
    return {
      command: process.platform === 'win32' ? 'spotdl.exe' : 'spotdl',
      args: ['download', url, '--output', path.join(jobDirectory, '{artist} - {title}.{output-ext}'), '--format', format, '--bitrate', `${quality}k`]
    };
  }

  const outputTemplate = path.join(jobDirectory, '%(playlist_index&{} - |)s%(title)s-%(id)s.%(ext)s');
  const args = ['--yes-playlist', '--newline', '--restrict-filenames', '--max-filesize', '500M', '--output', outputTemplate];
  if (['mp3', 'm4a', 'flac', 'ogg', 'opus', 'wav'].includes(format)) {
    const audioFormat = format === 'ogg' ? 'vorbis' : format;
    args.push('--extract-audio', '--audio-format', audioFormat, '--audio-quality', `${quality}K`);
  } else {
    args.push('--format', `bestvideo*[height<=${quality}]+bestaudio/best[height<=${quality}]`, '--merge-output-format', format);
  }
  args.push(url);
  return { command: process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp', args };
}

function buildInspectCommand(url) {
  return {
    command: process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
    args: ['--flat-playlist', '--dump-single-json', '--no-warnings', url]
  };
}

function buildSearchCommand(source, query) {
  const prefix = source === 'soundcloud' ? 'scsearch5' : source === 'youtube-music' ? 'ytmsearch5' : 'ytsearch5';
  return {
    command: process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
    args: ['--flat-playlist', '--dump-single-json', '--no-warnings', `${prefix}:${query}`]
  };
}

function searchSpotify(query) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'spotdl.exe' : 'spotdl';
    const child = spawn(command, ['save', query, '--save-file', '-', '--headless'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => reject(error.code === 'ENOENT' ? new Error('spotDL er ikke installert på serveren.') : error));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim().split('\n').pop() || 'Spotify-søket feilet.'));
        return;
      }
      try {
        const saved = JSON.parse(stdout);
        const songs = Array.isArray(saved) ? saved : saved.songs || saved;
        resolve((Array.isArray(songs) ? songs : []).map((song) => ({
          id: song.song_id || song.id || song.name,
          title: song.name || song.title || 'Spotify-resultat',
          url: song.url || song.webpage_url || '',
          thumbnail: song.album?.image || song.album_art || null,
          duration: song.duration || 0,
          uploader: song.artist || song.artists?.join(', ') || 'Spotify'
        })).filter((result) => result.url));
      } catch {
        reject(new Error('spotDL returnerte ikke lesbare Spotify-resultater.'));
      }
    });
  });
}

async function searchMedia(source, query) {
  if (source === 'spotify') return searchSpotify(query);
  const { command, args } = buildSearchCommand(source, query);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => reject(error.code === 'ENOENT' ? new Error(`${command} er ikke installert på serveren.`) : error));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim().split('\n').pop() || 'Søket feilet.'));
        return;
      }
      try {
        const result = JSON.parse(stdout);
        resolve((result.entries || []).filter((entry) => entry && entry.url).map((entry) => ({
          id: entry.id || entry.url,
          title: entry.title || 'Uten tittel',
          url: entry.webpage_url || entry.url,
          thumbnail: entry.thumbnail || null,
          duration: entry.duration || 0,
          uploader: entry.uploader || entry.channel || source
        })));
      } catch {
        reject(new Error('Kunne ikke lese søkeresultatene.'));
      }
    });
  });
}

function formatMetadata(metadata) {
  const entries = metadata.entries || [metadata];
  const items = entries.filter((entry) => entry && (entry.title || entry.id));
  const first = items[0] || metadata || {};
  return {
    title: metadata.playlist_title || first.playlist_title || first.title || 'Mediejobb',
    thumbnail: metadata.thumbnail || first.thumbnail || null,
    itemCount: items.length || 1,
    duration: items.reduce((total, entry) => total + (Number(entry.duration) || 0), 0),
    estimatedSize: items.reduce((total, entry) => total + (Number(entry.filesize_approx) || 0), 0),
    isPlaylist: items.length > 1 || Boolean(metadata.playlist_count && metadata.playlist_count > 1)
  };
}

async function inspectMedia(url) {
  const { command, args } = buildInspectCommand(url);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => reject(error.code === 'ENOENT' ? new Error(`${command} er ikke installert på serveren.`) : error));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim().split('\n').pop() || 'Kunne ikke hente medieinformasjon.'));
        return;
      }
      try {
        const metadata = JSON.parse(stdout);
        resolve(formatMetadata(metadata));
      } catch {
        reject(new Error('Kunne ikke lese medieinformasjonen.'));
      }
    });
  });
}

function parseProgress(line) {
  const match = line.match(/(\d+(?:\.\d+)?)%/);
  return match ? Math.min(99, Math.round(Number(match[1]))) : null;
}

async function findOutputFiles(jobDirectory) {
  const entries = await fs.readdir(jobDirectory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  if (!files.length) throw new Error('Downloaderen returnerte ingen filer.');
  return files.map((file) => path.join(jobDirectory, file));
}

async function createArchive(jobDirectory, files) {
  const archivePath = path.join(jobDirectory, 'laensmann-playlist.zip');
  await new Promise((resolve, reject) => {
    const output = createWriteStream(archivePath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    for (const file of files) archive.file(file, { name: path.basename(file) });
    archive.finalize();
  });
  await Promise.all(files.map((file) => fs.unlink(file)));
  return archivePath;
}

async function runDownload({ jobId, url, format, quality, saveMode, onProgress, onMetadata, onLog }) {
  const rootDirectory = saveMode === 'media' ? mediaDirectory : downloadsDirectory;
  const jobDirectory = path.join(rootDirectory, jobId);
  await fs.mkdir(jobDirectory, { recursive: true });
  const metadata = isSpotifyUrl(url)
    ? { title: 'Spotify-jobb', thumbnail: null, itemCount: 1, duration: 0, estimatedSize: 0, isPlaylist: false }
    : await inspectMedia(url);
  onMetadata(metadata);
  const { command, args } = buildCommand({ url, format, quality, jobDirectory });
  onLog(`Starter ${command} (${format})`);
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
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      for (const line of text.split(/\r?\n/).filter(Boolean)) onLog(line.slice(0, 500));
    });
    child.on('error', (error) => finish(error.code === 'ENOENT' ? new Error(`${command} er ikke installert på serveren.`) : error));
    child.on('close', async (code) => {
      if (code !== 0) {
        finish(new Error(`Downloader feilet: ${stderr.trim().split('\n').pop() || `exit code ${code}`}`));
        return;
      }
      try {
        const files = await findOutputFiles(jobDirectory);
        finish(null, files.length === 1 ? files[0] : await createArchive(jobDirectory, files));
      } catch (error) {
        finish(error);
      }
    });
  });
}

async function removeJobFiles(jobId, saveMode = 'temporary') {
  if (saveMode === 'media') return;
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

module.exports = { cleanupDownloads, downloadsDirectory, inspectMedia, removeJobFiles, runDownload, searchMedia };
