#!/usr/bin/env bash
set -euo pipefail

mkdir -p /tmp/fuwa-audio-src audio/sleep
UA='Fuwa-PWA/1.1.6 sleep-audio-build'

curl -L --fail --retry 4 --retry-all-errors -A "$UA" 'https://upload.wikimedia.org/wikipedia/commons/0/0e/Rain_%281%29.ogg' -o /tmp/fuwa-audio-src/rain.ogg
curl -L --fail --retry 4 --retry-all-errors -A "$UA" 'https://upload.wikimedia.org/wikipedia/commons/1/1f/Waves.ogg' -o /tmp/fuwa-audio-src/waves.ogg
curl -L --fail --retry 4 --retry-all-errors -A "$UA" 'https://upload.wikimedia.org/wikipedia/commons/8/80/Bones_breaking_wood_fire_ice_crackling.ogg' -o /tmp/fuwa-audio-src/fire.ogg
curl -L --fail --retry 4 --retry-all-errors -A "$UA" 'https://upload.wikimedia.org/wikipedia/commons/2/2d/Howling_wind.ogg' -o /tmp/fuwa-audio-src/wind.ogg
curl -L --fail --retry 4 --retry-all-errors -A "$UA" 'https://upload.wikimedia.org/wikipedia/commons/0/0a/20090610_0_ambience.ogg' -o /tmp/fuwa-audio-src/forest.ogg
curl -L --fail --retry 4 --retry-all-errors -A "$UA" 'https://upload.wikimedia.org/wikipedia/commons/5/54/Cafe_ambiance.ogg' -o /tmp/fuwa-audio-src/cafe.ogg

for f in /tmp/fuwa-audio-src/*.ogg; do
  test -s "$f"
  ffprobe -v error "$f" >/dev/null
done

COMMON='loudnorm=I=-21:TP=-2:LRA=11'
ffmpeg -hide_banner -loglevel error -y -stream_loop -1 -i /tmp/fuwa-audio-src/rain.ogg -t 150 -af "highpass=f=70,lowpass=f=11000,${COMMON}" -ar 48000 -ac 2 -c:a libmp3lame -b:a 160k -map_metadata -1 -metadata title='Gentle Rain' audio/sleep/gentle-rain.mp3
ffmpeg -hide_banner -loglevel error -y -ss 20 -i /tmp/fuwa-audio-src/waves.ogg -t 150 -af "highpass=f=40,lowpass=f=12000,${COMMON}" -ar 48000 -ac 2 -c:a libmp3lame -b:a 160k -map_metadata -1 -metadata title='Ocean Drift' audio/sleep/ocean-drift.mp3
ffmpeg -hide_banner -loglevel error -y -stream_loop -1 -i /tmp/fuwa-audio-src/fire.ogg -t 150 -af "highpass=f=70,lowpass=f=7500,equalizer=f=3500:t=q:w=1:g=-5,loudnorm=I=-22:TP=-2:LRA=10" -ar 48000 -ac 2 -c:a libmp3lame -b:a 160k -map_metadata -1 -metadata title='Warm Hearth' audio/sleep/warm-hearth.mp3
ffmpeg -hide_banner -loglevel error -y -ss 4 -i /tmp/fuwa-audio-src/wind.ogg -t 120 -af "highpass=f=55,lowpass=f=6500,equalizer=f=2000:t=q:w=1:g=-3,loudnorm=I=-22:TP=-2:LRA=10" -ar 48000 -ac 2 -c:a libmp3lame -b:a 160k -map_metadata -1 -metadata title='Evening Breeze' audio/sleep/evening-breeze.mp3
ffmpeg -hide_banner -loglevel error -y -ss 2 -i /tmp/fuwa-audio-src/forest.ogg -t 120 -af "highpass=f=90,lowpass=f=9000,loudnorm=I=-23:TP=-2:LRA=12" -ar 48000 -ac 2 -c:a libmp3lame -b:a 160k -map_metadata -1 -metadata title='Quiet Forest' audio/sleep/quiet-forest.mp3
ffmpeg -hide_banner -loglevel error -y -ss 60 -i /tmp/fuwa-audio-src/cafe.ogg -t 150 -af "highpass=f=80,lowpass=f=5200,equalizer=f=2400:t=q:w=1:g=-2,loudnorm=I=-24:TP=-2:LRA=10" -ar 48000 -ac 2 -c:a libmp3lame -b:a 160k -map_metadata -1 -metadata title='Cozy Room' audio/sleep/cozy-room.mp3
ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'anoisesrc=color=brown:amplitude=0.22:sample_rate=48000:duration=150' -af 'highpass=f=30,lowpass=f=1100,loudnorm=I=-24:TP=-3:LRA=7' -ar 48000 -ac 2 -c:a libmp3lame -b:a 160k -map_metadata -1 -metadata title='Deep Hush' audio/sleep/deep-hush.mp3
ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'anoisesrc=color=pink:amplitude=0.18:sample_rate=48000:duration=150' -af 'highpass=f=80,lowpass=f=4200,equalizer=f=2500:t=q:w=1:g=-3,loudnorm=I=-25:TP=-3:LRA=7' -ar 48000 -ac 2 -c:a libmp3lame -b:a 160k -map_metadata -1 -metadata title='Soft Air' audio/sleep/soft-air.mp3

cat > audio/sleep/README-LICENSES.txt <<'TXT'
Fuwa Sleep Corner — local audio source notes
Build: v91 / Fuwa 1.1.6

Natural ambience recordings are sourced from Wikimedia Commons and mastered locally for Fuwa. Fuwa changes include trimming/loop preparation, filtering, loudness balancing, resampling, and MP3 encoding.

Gentle Rain — Rain (1).ogg — ezwa / PDSounds — Public Domain
https://commons.wikimedia.org/wiki/File:Rain_(1).ogg

Ocean Drift — Waves.ogg — Dsw4 — Public Domain
https://commons.wikimedia.org/wiki/File:Waves.ogg

Warm Hearth — Bones breaking wood fire ice crackling.ogg — stephan / PDSounds — Public Domain
https://commons.wikimedia.org/wiki/File:Bones_breaking_wood_fire_ice_crackling.ogg

Evening Breeze — Howling wind.ogg — Tvabutzku1234 — CC0 1.0 Universal / Public Domain Dedication
https://commons.wikimedia.org/wiki/File:Howling_wind.ogg

Quiet Forest — 20090610 0 ambience.ogg — nille / PDSounds — Public Domain
https://commons.wikimedia.org/wiki/File:20090610_0_ambience.ogg

Cozy Room — Cafe ambiance.ogg — Marble Toast — CC0 1.0 Universal / Public Domain Dedication
https://commons.wikimedia.org/wiki/File:Cafe_ambiance.ogg

Deep Hush and Soft Air are generated specifically for Fuwa during the release build with FFmpeg noise sources, then filtered and mastered offline. No third-party audio asset is embedded for these two tracks.
TXT

expected=(gentle-rain ocean-drift warm-hearth evening-breeze quiet-forest cozy-room deep-hush soft-air)
for name in "${expected[@]}"; do
  f="audio/sleep/${name}.mp3"
  test -s "$f"
  codec=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$f")
  rate=$(ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate -of default=nw=1:nk=1 "$f")
  channels=$(ffprobe -v error -select_streams a:0 -show_entries stream=channels -of default=nw=1:nk=1 "$f")
  duration=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$f")
  echo "$name codec=$codec rate=$rate channels=$channels duration=$duration"
  test "$codec" = mp3
  test "$rate" = 48000
  test "$channels" = 2
  awk -v d="$duration" 'BEGIN{exit !(d >= 115)}'
  ffmpeg -v error -i "$f" -f null -
done

du -sh audio/sleep
