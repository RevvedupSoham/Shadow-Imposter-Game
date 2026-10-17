import { describe, expect, it } from "vitest";
import {
  isValidChatMessage,
  isValidClue,
  isValidNickname,
  isValidRoomCode,
  phaseDuration,
  secondsRemaining,
} from "./game";

describe("nickname validation", () => {
  it("accepts safe 2-20 character nicknames", () => {
    expect(isValidNickname("Soham_7")).toBe(true);
    expect(isValidNickname("Agent-02")).toBe(true);
  });

  it("rejects short, long, empty, and unsupported names", () => {
    expect(isValidNickname("A")).toBe(false);
    expect(isValidNickname("x".repeat(21))).toBe(false);
    expect(isValidNickname("  ")).toBe(false);
    expect(isValidNickname("<admin>")).toBe(false);
  });
});

describe("room code validation", () => {
  it("accepts exactly six alphanumeric characters, case-insensitively", () => {
    expect(isValidRoomCode("a1b2c3")).toBe(true);
    expect(isValidRoomCode("A1B2C3")).toBe(true);
  });

  it("rejects partial and malformed codes", () => {
    expect(isValidRoomCode("AB12")).toBe(false);
    expect(isValidRoomCode("ABC1234")).toBe(false);
    expect(isValidRoomCode("AB-123")).toBe(false);
  });
});

describe("game input limits", () => {
  it("enforces the server's clue length limit", () => {
    expect(isValidClue("A clue")).toBe(true);
    expect(isValidClue("  ")).toBe(false);
    expect(isValidClue("x".repeat(100))).toBe(true);
    expect(isValidClue("x".repeat(101))).toBe(false);
  });

  it("enforces chat message length limits", () => {
    expect(isValidChatMessage("Hello crew")).toBe(true);
    expect(isValidChatMessage("  ")).toBe(false);
    expect(isValidChatMessage("x".repeat(300))).toBe(true);
    expect(isValidChatMessage("x".repeat(301))).toBe(false);
  });
});

describe("phase timers", () => {
  it("uses the expected durations for timed phases", () => {
    expect(phaseDuration("clue")).toBe(30);
    expect(phaseDuration("discussion")).toBe(60);
    expect(phaseDuration("voting")).toBe(45);
    expect(phaseDuration("guess")).toBe(15);
    expect(phaseDuration("lobby")).toBe(0);
  });

  it("counts down from the server timestamp and never goes negative", () => {
    const startedAt = "2026-01-01T00:00:00.000Z";
    const start = new Date(startedAt).getTime();
    expect(secondsRemaining("clue", startedAt, start)).toBe(30);
    expect(secondsRemaining("clue", startedAt, start + 12_000)).toBe(18);
    expect(secondsRemaining("clue", startedAt, start + 45_000)).toBe(0);
  });

  it("fails safely if the server timestamp is missing or invalid", () => {
    expect(secondsRemaining("voting", undefined, 1000)).toBe(45);
    expect(secondsRemaining("voting", "not-a-date", 1000)).toBe(45);
  });
});
