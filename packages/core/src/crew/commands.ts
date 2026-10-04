import type { Pet } from '@tagalong/protocol';

/** What an ask's text turns out to be once the crew syntax is read. */
export type CrewCommand =
  | { kind: 'ask'; text: string }
  | { kind: 'handoff'; target: Pet; request: string }
  | { kind: 'roundtable'; question: string };

const MENTION = /^@([\p{L}\p{N}_-]+)[\s,:]*/u;
const CREW = /^\/crew(?:\s+|$)/i;

/**
 * Reads the crew syntax at the start of an ask: `@Ink …` hands the thread to Ink and
 * `/crew …` puts the question to the whole crew. Parsed here, in core, so every host that
 * can send an ask — the desktop panel and the Chrome side panel alike — gets the crew
 * without a line of host code. Only a leading mention counts: "ask @Ink later" is a sentence.
 */
export function parseCrewCommand(
  text: string,
  pets: readonly Pet[],
  currentPetId: string,
): CrewCommand {
  const trimmed = text.trim();

  if (CREW.test(trimmed)) {
    const question = trimmed.replace(CREW, '').trim();
    return question.length > 0 ? { kind: 'roundtable', question } : { kind: 'ask', text: trimmed };
  }

  const mention = MENTION.exec(trimmed);
  if (mention !== null) {
    const name = (mention[1] ?? '').toLowerCase();
    const target = pets.find(
      (pet) => pet.id.toLowerCase() === name || pet.name.toLowerCase() === name,
    );
    if (target !== undefined) {
      const rest = trimmed.slice(mention[0].length).trim();
      return target.id === currentPetId
        ? { kind: 'ask', text: rest }
        : { kind: 'handoff', target, request: rest };
    }
  }

  return { kind: 'ask', text: trimmed };
}
