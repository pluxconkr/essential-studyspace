# Backend setup — the three values the app needs

StudySpace has one server function, the anonymous check-in relay at `src/app/api/crowd+api.ts`. Everything else (hours, ranking, maps, timer, notifications) runs on the phone with no server. To make shared check-ins persist beyond one Metro process you supply exactly three values; the fourth is optional.

| Value | Who reads it | Where it comes from | Without it |
|---|---|---|---|
| `CROWD_STORE_URL` | the server route only (never shipped to the phone) | Upstash Redis → **REST API** → `UPSTASH_REDIS_REST_URL` | reports live in the Metro process memory: fine for a one-network demo, gone on restart; the app labels it "dev relay (memory)" |
| `CROWD_STORE_TOKEN` | the server route only | same panel → `UPSTASH_REDIS_REST_TOKEN` (read-write, not the read-only token) | same |
| `EXPO_PUBLIC_CROWD_URL` | the phone (inlined into the JS bundle at build time) | the origin `eas deploy` prints, plus `/api/crowd` | development builds and Expo Go use the Metro dev server automatically; a store build without it has no relay: levels come from the typical pattern, check-ins stay on the phone |
| `EXPO_PUBLIC_VENUES_URL` (optional) | the phone | any HTTPS URL serving JSON shaped like `assets/data/venues.json` (with a `version`) | the bundled directory stays the source of truth; a new venue needs an app update |

Nothing else is needed: no map key, no auth provider, no analytics, no push service (notifications are local).

## 1. Create the store (5 minutes)

1. [console.upstash.com](https://console.upstash.com) → **Create database** → type Redis, region `us-east-1` (closest to New Jersey), free tier.
2. Open the database → **REST API** tab → copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

The relay talks to Upstash over HTTPS (`/pipeline`), so a `redis://` connection string will not work; it must be the REST URL.

## 2. Run it locally

```bash
cp .env.example .env.local      # .env*.local is git-ignored
# fill in:
# CROWD_STORE_URL=https://<db>.upstash.io
# CROWD_STORE_TOKEN=<token>
npx expo start
```

Expo CLI loads `.env.local` for the API route. Check it took:

```bash
curl "http://localhost:8081/api/crowd?venues=alexander-library"
# {"ok":true,"configured":true,"storage":"redis","retentionHours":3,"serverTime":"…","reports":{"alexander-library":[]}}
```

`"storage":"memory"` means the variables were not read (typo, or Metro started before the file was saved; restart it). Post one report and read it back:

```bash
curl -X POST "http://localhost:8081/api/crowd" -H 'content-type: application/json' \
  -d "{\"venueId\":\"alexander-library\",\"level\":2,\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"weight\":1,\"noise\":1,\"amenities\":[\"outlets\"]}"
# {"ok":true,"kept":{…}}  ← GET again: the report is listed for 3 hours
```

Request shape (`ReportSchema` in the route): `venueId` `[a-z0-9-]`, `zoneId` optional, `level` 0–4 (Empty…Full), `at` ISO 8601 with offset (rounded to the minute server-side), `weight` 0–1 (proof strength), `noise` 0–3 optional, `amenities` from the list in `src/domain/types.ts`. Anything else → `{"error":"bad-request"}` (400); a timestamp older than 3 hours or more than 5 minutes ahead → `{"error":"stale"}` (422); over the limit → `{"error":"rate-limited"}` (429). Limit: 300 posts per 10 minutes per IP. Retention: 3 hours. No name, device id, note or coordinate is accepted.

In the app: Offline data → **Live levels** row shows the relay size and time; the "dev relay (memory)" suffix disappears after the next refresh (pull down on Now).

## 3. Deploy the route (EAS Hosting)

```bash
eas login && eas init                     # once; writes extra.eas.projectId into app.json
eas env:set --name CROWD_STORE_URL   --value https://<db>.upstash.io --environment production --visibility sensitive
eas env:set --name CROWD_STORE_TOKEN --value <token>                  --environment production --visibility sensitive
npx expo export --platform web
eas deploy --prod --environment production   # prints https://<name>.expo.app
curl "https://<name>.expo.app/api/crowd?venues=alexander-library"    # expect "storage":"redis"
```

Repeat the two `eas env:set` lines with `--environment preview` if you build preview profiles. EAS Hosting reads server variables from the EAS environment, not from `.env.local`.

## 4. Point the phone at it

```bash
eas env:set --name EXPO_PUBLIC_CROWD_URL --value https://<name>.expo.app/api/crowd --environment production --visibility plaintext
eas build --platform ios --profile production      # the value is inlined at build time
```

Changing the URL later means a new build (or an EAS Update). Leave `EXPO_PUBLIC_CROWD_URL` out of `.env.local` unless you want your development app to talk to the deployed relay instead of the local one.
