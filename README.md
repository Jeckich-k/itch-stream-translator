# Live Chat & Speech Translator (Twitch & YouTube)

A browser extension (Manifest V3) that provides automatic translation of chat messages and on‑screen video subtitles in real time on Twitch and YouTube.

## Key features

- 💬 **Real‑time chat translation**: automatic translation of messages on Twitch (including 7TV, BTTV, FFZ) and YouTube Live.
- 🎙️ **On‑screen subtitles over video**: automatic translation of recognized speech with a floating overlay on the player.
- ⏱️ **Adjusting the speed and duration of subtitles**: a slider from 3 to 20 seconds + presets (“Slow”, “Normal”, “Fast”) with a two‑line buffer for comfortable reading.
- 🌐 **Selecting language directions**: the ability to translate into any selected language (Russian, English, Korean, Japanese, etc.) from all or selected languages.
- 🌍 **Multilingual interface (RU / EN)**: quick one-click switching of the extension interface language (Russian / English).
- ⚡ **Smart queue and rate limit protection**: protection against Google Translate blocks (HTTP 429) with an automatic backup endpoint.

## Installing the extension

1. Download or clone the repository:
   ```bash
   git clone https://github.com/Jeckich-k/itch-stream-translator.git
   ```
2. Open the extensions page in your browser: `chrome://extensions/` (or `edge://extensions/`).
3. Turn on **Developer mode** in the upper-right corner.
4. Click **Load unpacked** and select the project folder.
