# 🎸 ComJam — community jam karaoke queue

A tiny self-hosted app for community music jams. Everyone at the jam uses their
phone to **request any song** and **vote** on their favorites. The queue
re-sorts **live** — no refreshing. The host runs the show from the laptop (or
their own phone): mark a song as *now singing*, then *sung*, and it moves into
the "already sung tonight" list so it can't be requested again.

For every requested song, ComJam automatically searches Ultimate Guitar for the
chords (`"<song> chords"` scoped to ultimate-guitar.com, first hit) and shows a
🎼 button. The host clicks it on the laptop to project the chords — karaoke
style, but for jams.

## Quick start (Mac laptop)

1. Install Node.js (18 or newer). Easiest with [Homebrew](https://brew.sh):

   ```sh
   brew install node
   ```

2. Clone / copy this folder, then:

   ```sh
   npm install
   npm start
   ```

3. The terminal prints two addresses:

   ```
   On this computer:  http://localhost:3000
   On the same wifi:  http://192.168.x.x:3000
   ```

4. Open it on the laptop, hit **Start a jam**, and point the QR code at the
   room. Everyone on the same wifi scans it and lands in the jam — no app
   install, works on iPhone/Android/desktop browsers.

> Attendee phones must be on the **same wifi network** as the laptop
> (a phone hotspot shared by the laptop works too). Internet is only needed
> for the chords lookup — requesting and voting work fully offline on the LAN.

## How a jam night flows

| Who | What |
| --- | --- |
| Everyone | Scan the QR → type any song → tap ♥ to vote. The queue reorders live; 👑 marks the crowd favorite. |
| Host | Tap **🎤 Sing now** on a song → it lights up "Now singing" on every phone. Click **🎼 Open chords** on the laptop to project Ultimate Guitar. |
| Host | When it's done, tap **✓ Done — mark as sung** → the song moves to the *Already sung tonight* list and can't be requested again (requests for it are politely rejected). |

Duplicate requests are merged: requesting a song that's already queued just
adds your vote (matching is case-insensitive and ignores punctuation).

## Host controls from your phone

When you create a jam you get a 6-character **host key**. Open the jam on your
phone, tap **Host controls** at the bottom, and enter the key — now your phone
can mark songs as singing/sung, remove or restore songs, and manage chord
links. (The key is also embedded in the `/s/CODE#key=XXXXXX` link shown at
creation, and `/s/CODE/admin` prompts for it directly.)

## Chords lookup & cache

- Lookups hit a **case-insensitive cache** first (persisted in `data/chordcache.json`),
  so a song is only ever searched once.
- Live search tries DuckDuckGo (`site:tabs.ultimate-guitar.com`) and falls back
  to Ultimate Guitar's own search, preferring chord sheets over tabs.
- Hosts get a **Chord link cache** panel (bottom of the page) to pin the exact
  link a title should use, or delete bad entries. Pinned links immediately
  update any matching song in the queue. The 🔁 button on a song re-runs the
  search.

## Notes

- Sessions and the chord cache persist to the `data/` folder, so a laptop
  restart doesn't lose the night. Sessions expire after 36 hours.
- One vote per person per song (tracked per browser); tap ♥ again to unvote.
- `PORT=8080 npm start` to use a different port.
