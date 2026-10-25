<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Gemini key stays server-side; browser gets single-use ephemeral tokens from `mintLiveToken` (src/lib/live-token.functions.ts). Why: never ship long-lived keys.
- Live config/persona lives in src/lib/mahiru-config.ts and is used both for token constraints and the connect call. Why: one source of truth.
- Audio I/O lives in src/lib/audio/pipeline.ts; session logic in src/hooks/use-mahiru-live.ts. Why: separation of transport and UI.
- Transcripts are kept in refs only, never rendered. Why: voice-only product requirement.
- Camera presence detection must never trigger speech; Mahiru speaks only in response to the user. Why: product rule against unsolicited remarks.
- Avatar expression mapping lives in a presentation-only module, re-exported by the shared config. Why: expand visual emotions without altering Live transport or token configuration.
- Avatar artwork masks and hair pivots live in `src/lib/avatar-rig.ts`, with motion helpers in `avatar-motion.ts`; parts are derived at load time from Mahiru's raster artwork. Why: keep the procedural rig separate from media and avoid duplicate character art.

- Camera capture is isolated in src/lib/video-pipeline.ts and started only by a ready Live session. Why: enforce frame limits and session cleanup without persisting media.
- Use the shared typed Live configuration and API version for tokens and connections; this SDK requires v1alpha for ephemeral tokens. Why: prevent mismatched constrained-session protocols.

- The entry code gate is client-only (src/lib/entry-gate.ts). Why: casual exhibition gate, not security.
- Live session is stored on connect; frames/mic start on setupComplete with a 12s timeout. Why: setupComplete can arrive after connect resolves.
