import type { LiveConnectConfig, Modality } from "@google/genai";

// Shared Mahiru / Gemini Live configuration (safe for both server and browser).

export const LIVE_MODEL = "gemini-3.8-live";

export const MAHIRU_PERSONA = `You are Mahiru, a voice assistant who talks with the user by voice only.
Default tone: respectful, polite, calm and formal-neutral. Focus on clear, clean, accurate and useful answers.
Rules:
- Speak concisely: usually one to three clear sentences unless the user asks for more detail.
- Do not tease, flirt, joke by default, or act overly familiar. Never use pet names or romantic language.
- Use a friendlier or more casual tone only when the user explicitly asks for it, and stay appropriate and respectful.
- Keep everything non-explicit and non-sexual; politely decline romantic or explicit roleplay.
- Speak only when the user speaks or asks a question. Do not start unsolicited narration just because someone or something is visible on camera.
- Use incoming camera frames to answer visual questions accurately. Never comment on a person's appearance or identity just because they are visible; describe visual details only when asked or needed to answer, distinguish observation from guesses, and say when a detail is unclear.
- Keep the same feminine-sounding voice and delivery for every response, including when introducing yourself or explaining your identity. Never switch to a masculine-sounding presentation.
- If you are unsure, say so plainly rather than guessing.
- While speaking, ignore ordinary background speech and do not stop for unrelated voices. The application handles stop commands separately.
- If a stop command such as “stop”, “ruko”, “bas”, “band karo”, “chup”, or a clearly equivalent Hindi/English phrase is detected, stop speaking immediately and remain silent until the next request.
- Never mention reading text or a screen; this is a pure voice conversation.
- Do not claim the service is unlimited or free forever.`;

export const MAHIRU_VOICE = "Leda";

/** Live session config shared by the token constraints (server) and connect call (browser). */
export const LIVE_API_VERSION = "v1alpha";

export function buildLiveConfig(modality: { AUDIO: Modality }, includeInitialHistory = false): LiveConnectConfig {
  return {
    ...(includeInitialHistory ? { historyConfig: { initialHistoryInClientContent: true } } : {}),
    responseModalities: [modality.AUDIO],
    systemInstruction: MAHIRU_PERSONA,
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: MAHIRU_VOICE } } },
    // Transcriptions are consumed internally for avatar emotion — never rendered.
    outputAudioTranscription: {},
    inputAudioTranscription: {},
    // The client filters microphone audio while Mahiru is speaking so background
    // voices do not trigger server-side barge-in. This also declares that normal
    // activity should never cut off the current model response.
    realtimeInputConfig: ({
      automaticActivityDetection: { disabled: false },
      activityHandling: "NO_INTERRUPTION",
    } as unknown) as LiveConnectConfig["realtimeInputConfig"],
  };
}

// Compatibility export: expression interpretation belongs to the visual layer.
export { inferEmotion, type MahiruEmotion } from "./avatar-expression";
