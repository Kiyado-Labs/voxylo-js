import type { RichBlock, RichMessage, Turn } from "../protocol";
import type { Message } from "./types";

export type MessageEvent =
  | { kind: "turn"; turn: Turn }
  | { kind: "agentText"; streamId: string; text: string; done: boolean }
  | { kind: "userText"; streamId: string; text: string; done: boolean }
  | { kind: "rich"; message: RichMessage };

/** Bookkeeping kept on each message; not part of the public Message type */
interface Tracked extends Message {
  streamId?: string;
  settled: boolean;
  /** A voice turn that arrived before its transcript stream; the stream adopts it instead of adding a line */
  awaitingStream?: boolean;
}

const tracked = (m: Message) => m as Tracked;

function mergeBlocks(a: readonly RichBlock[], b: readonly RichBlock[] | undefined): RichBlock[] {
  if (!b || b.length === 0) return a as RichBlock[];
  const seen = new Set(a.map((x) => x.id));
  return [...a, ...b.filter((x) => !seen.has(x.id))];
}

function replace(messages: readonly Message[], idx: number, next: Tracked): Message[] {
  const out = messages.slice();
  out[idx] = next;
  return out;
}

function applyStream(
  messages: readonly Message[],
  role: "user" | "agent",
  streamId: string,
  text: string,
  done: boolean,
  now: number,
): readonly Message[] {
  const idx = messages.findIndex((m) => m.role === role && tracked(m).streamId === streamId);
  if (idx === -1) {
    const waiting = messages.findIndex((m) => m.role === role && tracked(m).awaitingStream === true);
    if (waiting !== -1) {
      return replace(messages, waiting, { ...tracked(messages[waiting]!), streamId, awaitingStream: false });
    }
    if (!text) return messages;
    const fresh: Tracked = {
      id: `${role}-${streamId}`,
      role,
      text,
      streaming: !done,
      atMs: now,
      ...(role === "user" ? { inputMode: "voice" as const } : {}),
      blocks: [],
      toolCalls: [],
      streamId,
      settled: false,
    };
    return [...messages, fresh];
  }
  const cur = tracked(messages[idx]!);
  // The committed turn already landed; late stream frames must not overwrite it
  if (cur.settled || (cur.text === text && cur.streaming === !done)) return messages;
  return replace(messages, idx, { ...cur, text, streaming: !done });
}

function attachBlocks(messages: readonly Message[], blocks: readonly RichBlock[], now: number): readonly Message[] {
  const known = new Set(messages.flatMap((m) => m.blocks.map((b) => b.id)));
  const fresh = blocks.filter((b) => !known.has(b.id));
  if (fresh.length === 0) return messages;
  const last = messages.at(-1);
  if (last && last.role === "agent") {
    return replace(messages, messages.length - 1, { ...tracked(last), blocks: [...last.blocks, ...fresh] });
  }
  const holder: Tracked = {
    id: `blocks-${fresh[0]!.id}`,
    role: "agent",
    text: "",
    streaming: false,
    atMs: now,
    blocks: fresh,
    toolCalls: [],
    settled: true,
  };
  return [...messages, holder];
}

function applyTurn(messages: readonly Message[], t: Turn, now: number): readonly Message[] {
  if (t.partial) return applyStream(messages, t.role, t.turnId, t.content, false, now);
  // A turn that is only blocks belongs to the reply already on screen
  if (t.role === "agent" && t.content.trim() === "" && t.blocks?.length) return attachBlocks(messages, t.blocks, now);

  let idx = messages.findIndex((m) => m.role === t.role && tracked(m).streamId === t.turnId);
  // Typed input never had a live stream, so it must not land in a line someone is still speaking
  if (idx === -1 && !(t.role === "user" && t.inputMode === "text")) idx = pickStreamFor(messages, t);
  if (idx === -1) {
    const fresh: Tracked = {
      id: `turn-${t.turnId}`,
      role: t.role,
      text: t.content,
      streaming: false,
      atMs: t.atMs,
      ...(t.inputMode ? { inputMode: t.inputMode } : {}),
      blocks: t.blocks ?? [],
      toolCalls: t.toolCalls ?? [],
      settled: true,
      ...(t.role === "user" && t.inputMode === "voice" ? { awaitingStream: true } : {}),
    };
    return [...messages, fresh];
  }
  const cur = tracked(messages[idx]!);
  return replace(messages, idx, {
    ...cur,
    text: t.content,
    streaming: false,
    settled: true,
    ...(t.inputMode ? { inputMode: t.inputMode } : {}),
    blocks: mergeBlocks(cur.blocks, t.blocks),
    toolCalls: t.toolCalls ?? cur.toolCalls,
  });
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Which live line a final turn commits: the one with the same words; otherwise, for the user, the oldest whose
 * final transcript arrived (an utterance's turn follows its final stream), else the newest; for the agent, the
 * newest, since an older unfinished reply was interrupted and never got a turn.
 */
function pickStreamFor(messages: readonly Message[], t: Turn): number {
  const open: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === t.role && tracked(m).streamId !== undefined && !tracked(m).settled) open.push(i);
  });
  if (open.length === 0) return -1;
  const words = normalize(t.content);
  const same = open.find((i) => normalize(messages[i]!.text) === words);
  if (same !== undefined) return same;
  if (t.role === "user") {
    const finished = open.find((i) => !messages[i]!.streaming);
    if (finished !== undefined) return finished;
  }
  return open[open.length - 1]!;
}

/** Ends every live line, e.g. when the call ends mid-sentence, so later turns never land in them */
export function settleAll(messages: readonly Message[]): readonly Message[] {
  if (messages.every((m) => !m.streaming && tracked(m).settled !== false && !tracked(m).awaitingStream)) return messages;
  return messages.map((m) => {
    const cur = tracked(m);
    return cur.streaming || cur.settled === false || cur.awaitingStream
      ? { ...cur, streaming: false, settled: true, awaitingStream: false }
      : m;
  });
}

/** Folds live text streams, final turns and rich blocks into one ordered conversation; returns the same array when nothing changed */
export function reduceMessages(messages: readonly Message[], e: MessageEvent, now: number): readonly Message[] {
  switch (e.kind) {
    case "agentText":
      return applyStream(messages, "agent", e.streamId, e.text, e.done, now);
    case "userText":
      return applyStream(messages, "user", e.streamId, e.text, e.done, now);
    case "turn":
      return applyTurn(messages, e.turn, now);
    case "rich":
      return attachBlocks(messages, [e.message.block], now);
  }
}
