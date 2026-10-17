export type GamePhase = "lobby" | "clue" | "discussion" | "voting" | "guess" | "results";

const PHASE_DURATIONS: Partial<Record<GamePhase, number>> = {
  clue: 30,
  discussion: 60,
  voting: 45,
  guess: 15,
};

export function isValidNickname(value: string): boolean {
  const name = value.trim();
  return name.length >= 2 && name.length <= 20 && /^[A-Za-z0-9 _.-]+$/.test(name);
}

export function isValidRoomCode(value: string): boolean {
  return /^[A-Z0-9]{6}$/.test(value.trim().toUpperCase());
}

export function isValidClue(value: string): boolean {
  const clue = value.trim();
  return clue.length >= 1 && clue.length <= 100;
}

export function isValidChatMessage(value: string): boolean {
  const message = value.trim();
  return message.length >= 1 && message.length <= 300;
}

export function phaseDuration(phase: GamePhase | undefined): number {
  return phase ? PHASE_DURATIONS[phase] ?? 0 : 0;
}

export function secondsRemaining(phase: GamePhase | undefined, startedAt: string | undefined, now: number): number {
  const duration = phaseDuration(phase);
  if (!duration) return 0;
  const parsedStart = startedAt ? new Date(startedAt).getTime() : now;
  const start = Number.isFinite(parsedStart) ? parsedStart : now;
  return Math.max(0, duration - Math.floor(Math.max(0, now - start) / 1000));
}
