/** Compact, local-only current conversation. No audio, video, or credentials. */
export const MEMORY_KEY = 'mahiru.conversation.v1';
export const MEMORY_LIMIT = 12000;
export type MemoryTurn = { role: 'user' | 'model'; text: string };
export type ConversationMemory = { version: 1; updatedAt: number; turns: MemoryTurn[] };
export const emptyMemory = (): ConversationMemory => ({ version: 1, updatedAt: Date.now(), turns: [] });
export function appendMemory(memory: ConversationMemory, role: MemoryTurn['role'], text: string): ConversationMemory {
  const clean = text.trim().slice(-1200);
  if (!clean) return memory;
  const turns = [...memory.turns, { role, text: clean }].slice(-16);
  while (JSON.stringify(turns).length > MEMORY_LIMIT) turns.shift();
  return { version: 1, updatedAt: Date.now(), turns };
}
export function restoreMemory(storage: Pick<Storage, 'getItem'>): ConversationMemory {
  try {
    const raw = storage.getItem(MEMORY_KEY);
    if (!raw || raw.length > MEMORY_LIMIT + 1000) return emptyMemory();
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Array.isArray(value.turns) || typeof value.updatedAt !== 'number' || Date.now() - value.updatedAt > 12 * 60 * 60 * 1000) return emptyMemory();
    let memory = emptyMemory();
    for (const turn of value.turns.slice(-16)) {
      if ((turn?.role === 'user' || turn?.role === 'model') && typeof turn.text === 'string') memory = appendMemory(memory, turn.role, turn.text);
    }
    return memory;
  } catch { return emptyMemory(); }
}
export function saveMemory(storage: Pick<Storage, 'setItem'>, memory: ConversationMemory) {
  try { storage.setItem(MEMORY_KEY, JSON.stringify(memory)); } catch { /* Private mode / storage quota: in-memory remains available. */ }
}
export function resetConversationMemory(storage: Pick<Storage, 'removeItem'>) { try { storage.removeItem(MEMORY_KEY); } catch { /* Storage unavailable. */ } return emptyMemory(); }
