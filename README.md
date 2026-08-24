# TEBOW

A Jarvis-style voice console for talking to Claude, built as one self-contained
HTML file. Electric-blue HUD, a particle orb at the center, six parallel chats
living as colored slices of the orb, live telemetry, and hands-free voice with
a "hey Tebow" wake phrase.

**Live console:** https://jacef8.github.io/Tebow/console.html
(served by GitHub Pages from this branch — every push updates it in a minute or two)

## Using it

1. Open the live console in Chrome or Edge.
2. Click **KEY** and paste an Anthropic API key from console.anthropic.com
   (the key is never stored — paste it each visit).
3. Tap the orb's center and talk, or type in the bar at the bottom.
4. Click **HELP** in the top bar for the full guide.

The six colored slices of the orb are six separate conversations, each with its
own memory. Click a slice, a tab, or a name in the Chats list to switch. A
slice widens as its chat carries more of the conversation. **ASK ALL** sends
one question to all six at once; **WAKE** arms the "hey Tebow" wake phrase.

## What's in the file

- Three.js r128 particle sphere (6,000 points) with equatorial disc, meridian
  wires, gyro hoops, camera-facing reticle rings, and a starfield.
- Continuous speech recognition with barge-in and a wake phrase; replies are
  spoken with the best voice installed on the device and streamed into the
  transcript as they generate.
- Real telemetry only: clock, weather via open-meteo (geolocation or a typed
  US zip resolved through zippopotam.us), battery, network, uptime, latency.
  Nothing faked, nothing stored.

## Companion

The **TEBOW Daily Hub** — a private daily organizer page in the same style,
curated from live email and calendar data — lives as a Claude artifact and is
maintained by scheduled Claude runs, not by this repository.
