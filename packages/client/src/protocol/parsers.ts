import type {
  RichAction,
  RichBlock,
  RichCard,
  RichMessage,
  SessionEndReason,
  SessionEvent,
  ToolCallView,
  Turn,
} from "./types";

const MAX_BLOCKS_PER_TURN = 5;
const MAX_ID = 64;
const MAX_LABEL = 40;
const MAX_TITLE = 80;
const MAX_TEXT = 300;
const MAX_VALUE = 200;
const MAX_URL = 2048;
const MAX_BUTTONS = 6;
const MAX_CARD_ACTIONS = 3;
const MAX_CARDS = 3;
const MIN_CAROUSEL_CARDS = 2;
const MAX_CAROUSEL_CARDS = 10;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function boundedString(x: unknown, min: number, max: number): string | null {
  return typeof x === "string" && x.length >= min && x.length <= max ? x : null;
}

function finite(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}

function httpsUrl(x: unknown): string | null {
  if (typeof x !== "string" || x.length > MAX_URL) return null;
  try {
    return new URL(x).protocol === "https:" ? x : null;
  } catch {
    return null;
  }
}

function parseToolCall(x: unknown): ToolCallView | null {
  if (!isRecord(x) || typeof x.name !== "string" || typeof x.toolId !== "string" || !isRecord(x.args)) {
    return null;
  }
  const call: ToolCallView = { toolId: x.toolId, name: x.name, args: x.args };
  if ("result" in x) call.result = x.result;
  const latencyMs = finite(x.latencyMs);
  if (latencyMs !== undefined) call.latencyMs = latencyMs;
  if (x.source === "server" || x.source === "client") call.source = x.source;
  return call;
}

function parseRichAction(raw: unknown): RichAction | null {
  if (!isRecord(raw)) return null;
  const id = boundedString(raw.id, 1, MAX_ID);
  const label = boundedString(raw.label, 1, MAX_LABEL);
  if (id === null || label === null) return null;
  if (raw.kind === "reply") {
    const value = boundedString(raw.value, 1, MAX_VALUE);
    return value === null ? null : { id, kind: "reply", label, value };
  }
  if (raw.kind === "url") {
    const url = httpsUrl(raw.url);
    return url === null ? null : { id, kind: "url", label, url };
  }
  return null;
}

// Only a structurally valid link with a non-https url is dropped alone; anything else rejects the block
function isUnsafeUrlAction(x: unknown): boolean {
  return (
    isRecord(x) &&
    x.kind === "url" &&
    boundedString(x.id, 1, MAX_ID) !== null &&
    boundedString(x.label, 1, MAX_LABEL) !== null &&
    typeof x.url === "string" &&
    x.url.length <= MAX_URL &&
    httpsUrl(x.url) === null
  );
}

function parseRichActions(raw: unknown, min: number, max: number): RichAction[] | null {
  if (!Array.isArray(raw) || raw.length > max) return null;
  const actions: RichAction[] = [];
  for (const item of raw) {
    if (isUnsafeUrlAction(item)) continue;
    const action = parseRichAction(item);
    if (!action) return null;
    actions.push(action);
  }
  return actions.length >= min ? actions : null;
}

function parseRichCard(raw: unknown): RichCard | null {
  if (!isRecord(raw)) return null;
  const title = boundedString(raw.title, 1, MAX_TITLE);
  if (title === null) return null;
  const card: RichCard = { title };
  if (raw.description !== undefined) {
    const description = boundedString(raw.description, 0, MAX_TEXT);
    if (description === null) return null;
    card.description = description;
  }
  if (raw.imageUrl !== undefined) {
    const imageUrl = httpsUrl(raw.imageUrl);
    if (imageUrl === null) return null;
    card.imageUrl = imageUrl;
  }
  if (raw.actions !== undefined) {
    const actions = parseRichActions(raw.actions, 0, MAX_CARD_ACTIONS);
    if (!actions) return null;
    if (actions.length > 0) card.actions = actions;
  }
  return card;
}

function parseRichCards(raw: unknown, min: number, max: number): RichCard[] | null {
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) return null;
  const cards: RichCard[] = [];
  for (const item of raw) {
    const card = parseRichCard(item);
    if (!card) return null;
    cards.push(card);
  }
  return cards;
}

function parseRichBlock(raw: unknown): RichBlock | null {
  if (!isRecord(raw)) return null;
  const id = boundedString(raw.id, 1, MAX_ID);
  if (id === null) return null;
  if (raw.type === "buttons") {
    const actions = parseRichActions(raw.actions, 1, MAX_BUTTONS);
    if (!actions) return null;
    if (raw.prompt === undefined) return { type: "buttons", id, actions };
    const prompt = boundedString(raw.prompt, 0, MAX_TEXT);
    return prompt === null ? null : { type: "buttons", id, prompt, actions };
  }
  if (raw.type === "cards") {
    const cards = parseRichCards(raw.cards, 1, MAX_CARDS);
    return cards ? { type: "cards", id, cards } : null;
  }
  if (raw.type === "carousel") {
    const cards = parseRichCards(raw.cards, MIN_CAROUSEL_CARDS, MAX_CAROUSEL_CARDS);
    return cards ? { type: "carousel", id, cards } : null;
  }
  return null;
}

function parseRichBlocks(raw: unknown): RichBlock[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BLOCKS_PER_TURN) return null;
  const blocks: RichBlock[] = [];
  for (const item of raw) {
    const block = parseRichBlock(item);
    if (!block) return null;
    blocks.push(block);
  }
  return blocks;
}

export function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

export function parseRichMessage(raw: unknown): RichMessage | null {
  if (!isRecord(raw)) return null;
  const atMs = finite(raw.atMs);
  if (atMs === undefined) return null;
  if (raw.turnId !== undefined && typeof raw.turnId !== "string") return null;
  const block = parseRichBlock(raw.block);
  if (!block) return null;
  return { ...(typeof raw.turnId === "string" ? { turnId: raw.turnId } : {}), atMs, block };
}

export function parseTurn(raw: unknown): Turn | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.turnId !== "string" || typeof raw.content !== "string") return null;
  const atMs = finite(raw.atMs);
  if (atMs === undefined) return null;

  let role: Turn["role"];
  if (raw.role === "user") role = "user";
  else if (raw.role === "agent" || raw.role === "assistant") role = "agent";
  else return null;

  const turn: Turn = { turnId: raw.turnId, role, content: raw.content, atMs };
  if (raw.inputMode === "voice" || raw.inputMode === "text") turn.inputMode = raw.inputMode;
  const latencyMs = finite(raw.latencyMs);
  if (latencyMs !== undefined) turn.latencyMs = latencyMs;
  if (Array.isArray(raw.toolCalls)) {
    const calls = raw.toolCalls.map(parseToolCall).filter((c): c is ToolCallView => c !== null);
    if (calls.length > 0) turn.toolCalls = calls;
  }
  // A bad blocks field drops only itself so the turn text still renders
  const blocks = parseRichBlocks(raw.blocks);
  if (blocks) turn.blocks = blocks;
  if (typeof raw.partial === "boolean") turn.partial = raw.partial;
  return turn;
}

const SESSION_END_REASONS: ReadonlySet<string> = new Set<SessionEndReason>(["completed", "idle", "error", "unavailable"]);

export function parseSessionEvent(raw: unknown): SessionEvent | null {
  if (!isRecord(raw)) return null;
  if (raw.type === "ended") {
    // Unknown reasons from a newer worker still end the session
    const reason = SESSION_END_REASONS.has(raw.reason as string) ? (raw.reason as SessionEndReason) : "completed";
    return { type: "ended", reason };
  }
  if (raw.type === "warning" && typeof raw.code === "string" && typeof raw.detail === "string") {
    return { type: "warning", code: raw.code, detail: raw.detail };
  }
  return null;
}
