# Lænsmann MP3

Lænsmann MP3 er en enkel webapplikasjon for å gjøre medieinnhold du har rett til å bruke tilgjengelig som lydfil eller video. Backend har health check, jobb-kø og automatisk cleanup.

## FASE 2: Test lokalt

Du trenger Node.js installert.

1. Åpne en terminal i prosjektmappen.
2. Installer avhengighetene:

```bash
npm install
```

3. Start applikasjonen:

```bash
npm start
```

4. Åpne `http://127.0.0.1:3002`.
5. Test health check ved å åpne `http://127.0.0.1:3002/api/health`.

Frontend kobler nå til backendens jobb-API. Ekte behandling krever at medieverktøyene under er installert.

## Tester

Kjør API-testene med:

```bash
npm test
```

Testene starter en midlertidig server på port `3127` og kontrollerer health check, frontend/favicons, Spotify-validering og kvalitetsvalidering.

## Struktur

- `public/index.html` - sidens struktur og innhold
- `public/style.css` - layout, farger og responsivt design
- `public/app.js` - URL-validering, jobbstart og statuspolling
- `server/index.js` - Express-server, API-ruter og cleanup
- `server/job-store.js` - in-memory jobb-kø og worker-livssyklus
- `server/media-downloader.js` - yt-dlp/spotDL-integrasjon og filhåndtering
- `package.json` - prosjektinformasjon, scripts og Express-avhengighet

## Ansvarlig bruk

Tjenesten skal bare brukes med innhold du har rett til å laste ned eller konvertere. Den skal ikke brukes til å omgå DRM, betalingsmurer, tilgangskontroller eller andre tekniske beskyttelser.

## Medieverktøy

FASE 4 bruker `yt-dlp` for kompatible mediekilder og `FFmpeg` for MP3/MP4-behandling. Spotify-URL-er sendes separat til `spotDL`, som må være installert og konfigurert på serveren. Spotify støttes bare som MP3 i denne versjonen.
FASE 4 bruker `yt-dlp` for kompatible mediekilder og `FFmpeg` for lyd/video-behandling. Spotify-URL-er sendes separat til `spotDL`. spotDL finner musikk på YouTube og legger på Spotify-metadata/albumart; det henter ikke beskyttet lyd direkte fra Spotify. Bruk bare innhold du har rett til å bruke.

På Debian-serveren installeres grunnverktøyene normalt slik, én kommando om gangen:

```bash
sudo apt update
sudo apt install ffmpeg python3 python3-venv
python3 -m venv ~/laensmann-tools
~/laensmann-tools/bin/pip install -U yt-dlp spotdl
spotdl --download-deno
```

Test deretter verktøyene:

```bash
~/laensmann-tools/bin/yt-dlp --version
~/laensmann-tools/bin/spotdl --version
ffmpeg -version
```

På Windows må `yt-dlp.exe`, `spotdl.exe` og `ffmpeg.exe` være installert og tilgjengelige i `PATH` når `npm start` kjøres. Serveren bruker `spawn()` med argument-array og setter aldri brukerens URL inn i en shell-streng.
På Windows må `yt-dlp.exe`, `spotdl.exe` og `ffmpeg.exe` være installert og tilgjengelige i `PATH` når `npm start` kjøres. Serveren bruker `spawn()` med argument-array og setter aldri brukerens URL inn i en shell-streng.

## Jobb-API

Jobb-systemet er in-memory. Det betyr at jobbene forsvinner hvis serveren starter på nytt. Maksimalt to jobber behandles samtidig som standard.

Opprett en jobb:

```bash
curl -X POST http://127.0.0.1:3002/api/jobs -H "Content-Type: application/json" -d "{\"url\":\"https://example.com/media\",\"format\":\"mp3\",\"quality\":\"320\"}"
```

Bruk `jobId` fra svaret for å hente status:

```bash
curl http://127.0.0.1:3002/api/jobs/JOB_ID
```

Mulige statuser er `queued`, `processing`, `completed`, `failed` og `expired`.

## FASE 4: Lyd og video

`format` kan være `mp3` eller `mp4`. MP3 bruker valgt bitrate. MP4 bruker valgt oppløsning (`1080`, `720`, `480` eller `360`). Ferdige filer lastes ned fra `/api/jobs/:id/download` og slettes etter vellykket sending.
`format` kan være `mp3`, `m4a`, `flac`, `ogg`, `opus`, `wav`, `mp4`, `mkv` eller `webm`. Lyd bruker bitrate (`96` til `320 kbps`), og video bruker oppløsning (`360p` til `2160p / 4K`). Spotify støtter lydformatene som spotDL dokumenterer: MP3, FLAC, OGG/OPUS, M4A og WAV. Ferdige filer lastes ned fra `/api/jobs/:id/download`.

Arbeidsmodus kan velges per jobb. `Informasjonsmodus` henter metadata og thumbnail før nedlasting og bygger inn metadata i resultatet. `Rask modus` starter yt-dlp direkte og hopper over forhåndsmetadata og embedding for kortere oppstartstid.

Yt-dlp bruker `YTDLP_CONCURRENT_FRAGMENTS` fragmenter samtidig. FFmpeg bruker `FFMPEG_THREADS`; `0` betyr automatisk CPU-bruk. Disse kan justeres i `.env`, men for mange samtidige jobber og for mange tråder kan gjøre serveren tregere totalt.

Hvis YouTube gir `HTTP 403`, kan Debian bruke `YTDLP_IMPERSONATE=chrome`. Dette krever at yt-dlp-miljøet har `curl_cffi`. Innstillingen etterligner nettleserens HTTP-fingeravtrykk, men omgår ikke DRM, private videoer eller tilgangskontroller.

YouTube-spillelister kan behandles som flere filer. Statuspanelet viser tilgjengelig tittel, thumbnail, antall elementer, samlet varighet og estimert størrelse. Når en jobb inneholder flere filer, pakkes resultatet automatisk som én ZIP-fil før nedlasting.

Søkefeltet tilbyr YouTube og SoundCloud. Spotify og YouTube Music er ikke søkekilder, men Spotify-lenker kan fortsatt limes inn direkte og behandles av spotDL. YouTube-resultater får en direkte `watch`-URL og fallback-thumbnail når søket bare returnerer en video-ID.

Playlist-status oppdateres per element mens yt-dlp rapporterer hvilket element som lastes ned. Ferdige filer som velger serverlagring flyttes direkte til `MEDIA_DIR`; jobb-ID-mapper brukes bare midlertidig under behandling.

Lagringsmålet kan velges som midlertidig eller serverbibliotek. `temporary` bruker `downloads/` og slettes etter nedlasting. `media` bruker `MEDIA_DIR`, som standard `/mnt/media2/Lænsmann Studio`, og blir liggende der.

Et lite **status**-punkt nederst på siden åpner jobbloggen for feilsøking. API-et er `GET /api/jobs/:id/logs`.

Kopier `.env.example` til `.env` hvis du trenger andre lokale innstillinger. `.env` skal ikke committes.

## Cleanup og sikkerhet

Det er ingen brukerbasert rate limit eller kvote. Brukeren kan starte så mange jobber som ønskelig. Jobbfiler slettes automatisk etter 15 minutter som standard, og de slettes også etter en vellykket download.

Serveren beholder tekniske grenser for stabilitet: maksimalt to samtidige workers, maksimal filstørrelse på 500 MB og timeout på 10 minutter per jobb. Disse hindrer én feil eller ekstrem jobb fra å stoppe hele serveren, men begrenser ikke hvor mange jobber brukeren kan kjøre totalt.

## Neste fase

Neste arbeid er testdekning og deretter Apache/systemd-deployment. Backend skal ikke eksponeres direkte mot internett.
