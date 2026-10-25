# Mahiru AI — voice-first exhibition build

Mahiru uses the existing animated character and the stable Gemini 3.8 Live audio-to-audio model (`gemini-3.8-live`). The project keeps the simple black stage and voice-only interaction; it does not replace the avatar or add a chat transcript UI.

## Required server environment variables

Set these in **Vercel → Project → Settings → Environment Variables** (Production and Preview, if both are used):

| Variable | Required? | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Recommended | Primary server-side key used to mint single-use Gemini Live tokens. |
| `GEMINI_API_KEY_BACKUP` | Recommended | Separate backup key; the server checks whether it can mint a token and uses it when the primary key fails. |

Keep both values out of source files and GitHub. This repository intentionally contains no real API key. The `.env` file is ignored by Git. The project checks the backup key by attempting to mint a temporary token; only status labels (`ok`, `failed`, etc.) are logged, never the key values. A token-mint check confirms access to the temporary-token endpoint, not guaranteed future availability of the Live service.

`VITE_MAHIRU_MOCK=true` is an optional local UI test mode. It uses synthetic audio and does not test Gemini or API keys. Do not set it to `true` for the exhibition deployment.

## Install and run locally

Use Node.js 22 or later and npm:

```sh
npm install
cp .env.example .env
# Fill GEMINI_API_KEY and GEMINI_API_KEY_BACKUP in .env on your own machine only.
npm run dev
```

The app needs HTTPS or `localhost` for camera and microphone access. Opening `index.html` directly with `file://` will not work. Do not commit `.env`.

## What this build changes

- Keeps the existing avatar and animation system.
- Uses Gemini 3.8 Live (stable, replacing the old 3.1 Live preview model), preserves the `Leda` voice, and asks Mahiru to keep the same feminine-sounding delivery when introducing herself.
- Fixes restored conversation-history setup: when saved history exists, it is explicitly initialized and properly closed before the next spoken request, avoiding a session waiting indefinitely for the history exchange to finish.
- Stops forwarding ordinary microphone audio to Gemini while Mahiru is speaking. The browser's speech recognizer listens locally during playback for explicit English/Hindi stop commands such as `stop`, `pause`, `enough`, `ruko`, `ruk jao`, `bas`, `band karo`, `chup`, `रुको`, `रुक जाओ`, `बस करो`, `बंद करो`, and `मत बोलो`.
- Includes a backup-token endpoint and failover when the Live connection itself reports common quota/key-access errors.
- Sends JPEG camera frames with the longest edge up to 640 pixels, up to one frame per second, preserving portrait or landscape framing to improve on the previous 320×180 frames.
- Makes the three camera modes explicit and reattaches a fresh stream when turning the camera back on.

The camera continues to provide frames for visual question answering, but the app does not start unsolicited narration just because something is visible. This is intentional for the current build.

## Camera menu

1. **Camera on, preview hidden:** hardware camera remains on; preview is hidden; frames still go to Gemini.
2. **Camera on, preview visible:** camera and frame streaming are active; preview is visible.
3. **Camera off:** video tracks stop and frame streaming stops; microphone and voice conversation continue.

If the camera cannot be reopened after mode 3, the menu shows a camera error and keeps the voice session running.

## Voice and stop commands

The selected Gemini Live voice remains `Leda`. The application uses the browser's `SpeechRecognition`/`webkitSpeechRecognition` API only during Mahiru's spoken output to detect stop commands without sending ordinary background speech to Gemini. This is supported in many Chromium-based browsers, including many Android Chrome configurations, but not every browser provides this API. Test `stop` and `ruko` on the exact phone/browser you will use at the exhibition. A voice stop command depends on the browser speech-recognition service and may vary with microphone conditions or transcription accuracy.

## Test before the exhibition

```sh
npm test
npm run build
```

After deploying the ZIP to a new GitHub repository and redeploying in Vercel:

1. Set both server environment variables and redeploy.
2. Start Mahiru and check the browser console for `[mahiru] Gemini key check`. `primary: "ok"` and `backup: "ok"` mean both keys minted a temporary token during that session startup.
3. Ask a simple voice question and confirm audible output.
4. While Mahiru is speaking, say `stop`, then `ruko`, then try `बस करो`.
5. Cycle through all three camera modes. In hidden-preview mode, confirm the camera indicator remains active; in off mode, confirm the camera indicator turns off while voice still works; switch back on and confirm frames resume.
6. Test on the actual exhibition device, network, and Google account. Code tests cannot guarantee provider availability, quotas, or future changes on exhibition day.

## Other notes

The four-digit entry screen is a casual exhibition gate checked in the browser; it is not a security boundary. Gemini usage and quota are controlled by Google. A backup key is not an unlimited quota guarantee, especially if both keys belong to the same Google Cloud project.
