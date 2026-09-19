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

På Debian-serveren installeres grunnverktøyene normalt slik, én kommando om gangen:

```bash
sudo apt update
sudo apt install ffmpeg python3 python3-venv
python3 -m venv ~/laensmann-tools
~/laensmann-tools/bin/pip install -U yt-dlp spotdl
```

Test deretter verktøyene:

```bash
~/laensmann-tools/bin/yt-dlp --version
~/laensmann-tools/bin/spotdl --version
ffmpeg -version
```

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

Kopier `.env.example` til `.env` hvis du trenger andre lokale innstillinger. `.env` skal ikke committes.

## Cleanup og sikkerhet

Det er ingen brukerbasert rate limit eller kvote. Brukeren kan starte så mange jobber som ønskelig. Jobbfiler slettes automatisk etter 15 minutter som standard, og de slettes også etter en vellykket download.

Serveren beholder tekniske grenser for stabilitet: maksimalt to samtidige workers, maksimal filstørrelse på 500 MB og timeout på 10 minutter per jobb. Disse hindrer én feil eller ekstrem jobb fra å stoppe hele serveren, men begrenser ikke hvor mange jobber brukeren kan kjøre totalt.

## Automatisk deployment

Workflowen [.github/workflows/deploy.yml](.github/workflows/deploy.yml) kjører tester på hver push til `main`. Hvis testene passerer, kobler GitHub Actions seg til Debian-serveren med SSH, henter siste commit, kjører `npm ci`, restarter `mp3-api.service` og sjekker health-endepunktet.

### GitHub Secrets

Opprett disse secrets under **Settings → Secrets and variables → Actions**:

- `SERVER_HOST` - offentlig IP eller hostname til Debian-serveren
- `SERVER_USER` - `kevin`
- `SERVER_SSH_KEY` - privat SSH-nøkkel for deployment
- `SERVER_KNOWN_HOSTS` - resultatet fra `ssh-keyscan` for serveren

Private key og `.env` skal aldri legges i repositoryet.

### Serverforberedelse

Deploy-brukeren må kunne restarte akkurat denne tjenesten uten passord. Dette konfigureres senere med en begrenset sudo-regel for `systemctl restart mp3-api.service` og `systemctl is-active mp3-api.service`. Ikke bruk full `NOPASSWD: ALL`.

Når secrets og serverregelen er klare, tester du deployment med en vanlig push til `main`. Backend skal ikke eksponeres direkte mot internett.
