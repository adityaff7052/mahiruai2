import { describe, it, expect } from 'vitest';
import { appendMemory, emptyMemory, restoreMemory, saveMemory, resetConversationMemory, MEMORY_KEY } from '../lib/conversation-memory';
import { PresencePolicy, PRESENCE_DEFAULTS } from '../lib/presence-policy';
import { mouthAmplitude } from '../lib/avatar-motion';
describe('private current conversation', () => {
 it('saves restores and resets memory', () => { localStorage.clear(); const memory = appendMemory(emptyMemory(), 'user', 'My cat is Luna'); saveMemory(localStorage, memory); expect(restoreMemory(localStorage).turns[0]?.text).toBe('My cat is Luna'); resetConversationMemory(localStorage); expect(restoreMemory(localStorage).turns).toEqual([]); });
 it('bounds memory and rejects malformed storage', () => { let memory=emptyMemory(); for(let i=0;i<100;i++) memory=appendMemory(memory,'model','a'.repeat(2000)); expect(memory.turns.length).toBeLessThanOrEqual(16); expect(JSON.stringify(memory).length).toBeLessThan(13000); localStorage.setItem(MEMORY_KEY,'{bad'); expect(restoreMemory(localStorage).turns).toEqual([]); });
});
describe('proactive attention policy', () => {
 it('requires sustained attention and a two minute cooldown', () => { const p=new PresencePolicy({ ...PRESENCE_DEFAULTS, enabled: true }); expect(p.update(0,true,true,false)).toBe(false); expect(p.update(6999,true,true,false)).toBe(false); expect(p.update(7000,true,true,false)).toBe(true); expect(p.update(8000,true,true,false)).toBe(false); expect(p.update(126999,true,true,false)).toBe(false); expect(p.update(127000,true,true,false)).toBe(true); });
 it('speech cancels pending attention and disconnected/muted blocks it', () => { const p=new PresencePolicy({ ...PRESENCE_DEFAULTS, enabled: true }); p.update(0,true,true,false); expect(p.update(7000,true,true,true)).toBe(false); expect(p.update(8000,true,true,false)).toBe(false); expect(p.update(20000,true,false,false)).toBe(false); });
 it('closes mouth immediately on interruption regardless of amplitude', () => { expect(mouthAmplitude(.9,1,false,16)).toBe(0); expect(mouthAmplitude(0,.1,true,16)).toBeGreaterThan(0); });
});
