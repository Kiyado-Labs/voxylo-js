# SDK2 — voxylo-js (`@voxylo/client` + `@voxylo/react`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the public JavaScript SDK: a headless core, React hooks and a drop-in component, a Next.js example, and an npm release.

**Architecture:** A new public repo `Kiyado-Labs/voxylo-js` (pnpm monorepo). `@voxylo/client` owns sessions, the LiveKit room, the wire protocol, message state, client tools and context; it exposes an immutable snapshot + `subscribe` for any UI layer. `@voxylo/react` is a thin layer over that store via `useSyncExternalStore`.

**Tech Stack:** TypeScript 5 strict, pnpm 10 workspaces, tsup, vitest + jsdom + @testing-library/react, livekit-client ^2.15, React 18 and 19 (CI matrix), Next.js 16 App Router (example; the portfolio is on 16.4), Changesets, GitHub Actions, npm provenance.

**Reference consumer:** the portfolio's "Ask my AI" (`/Users/niyaz/Desktop/Personal/Personal Portfolio/apps/portfolio/src/components/voice/use-voice-session.ts` and `components/hero/hero.tsx`). Tasks 14A (voice) and 14B (agentic) integrate it; every earlier task should keep that integration small.

**Where:** a new directory `/Users/niyaz/Desktop/Personal/Kiyado Labs/voxylo-js` (its own git repo, so no worktree is needed and nothing in the Voxylo checkout is touched).

**Spec:** `docs/superpowers/specs/2026-11-07-public-sdk-design.md` (in the Voxylo monorepo; copy it to `docs/design.md` in the new repo in Task 1).

**Depends on:** Slice A depends on nothing new (production `/widget/v1/start` as it is today). Slices B and C need SDK1 deployed to production. See "Delivery slices".

## Global Constraints

- Repo `Kiyado-Labs/voxylo-js`, MIT license, copyright "Kiyado Labs". Private during Slices A and B; made public in Slice C, before the first npm publish.
- Package names `@voxylo/client`, `@voxylo/react`; server helper is the subpath `@voxylo/client/server`. If the npm org `voxylo` cannot be claimed, use `@voxylohq/*` everywhere (one search-and-replace before Task 13).
- Outputs: ESM + CJS + `.d.ts`; `sideEffects: false`; Node ≥18 for the server helper; no `window`/`document` access at import time in any entry.
- Every `@voxylo/react` entry file begins with `"use client";` (tsup `banner`).
- Default `apiBase` `"https://api.voxylo.cloud"`; default environment `"main"`; widget loader URL `"https://cdn.voxylo.cloud/widget/latest/loader.js"`.
- Protocol version sent: `1`. Topics, verbatim: `voxylo.turn`, `voxylo.rich`, `voxylo.session`, `voxylo.client.cmd`, `lk.transcription`; new text streams `voxylo.client.tools`, `voxylo.client.context`; RPC method `voxylo.client_tool`; attributes `voxylo.protocol`, `voxylo.sdk`, `lk.agent.state`.
- Client tool limits (must match the worker): ≤16 tools; name `^[a-zA-Z][a-zA-Z0-9_]{0,47}$`; description 1–1024 chars; `parameters.type === "object"`, ≤4096 bytes serialized; declaration ≤32768 bytes; `timeoutMs` 1000–60000, default 10000; tool result ≤15000 bytes serialized. Declarations debounced 50 ms; context debounced 100 ms; context ≤8192 bytes.
- `VoxyloError.code` values, verbatim: `not_found`, `origin_not_allowed`, `anonymous_sessions_disabled`, `rate_limited`, `agent_unavailable`, `protocol_unsupported`, `network`, `connection_failed`, `session_failed`, `microphone_denied`, `unknown`.
- Audio levels are `0..1`, sources `"agent" | "user" | "active"`, delivered at most once per animation frame and never through the state snapshot; `useAudioLevel` default `fps` 30.
- `useVoiceAgent().status` values, verbatim: `idle`, `connecting`, `listening`, `thinking`, `speaking`, `ended`, `error`.
- Resume storage key: `voxylo:resume:<projectId or "custom">:<environment>`.
- Public API names are exactly those in the spec's "Core API" and "React API" sections; anything else exported is prefixed `unstable_` or not exported.
- No secret key in any example, README or test fixture; examples read `VOXYLO_API_KEY` from server env only.

## Review Focus

1. **Next.js server render of a page using `VoxyloProvider`** — renders without touching `window`; connects only after hydration. Test in Task 10 (renderToString) and Task 12 (`next build`).
2. **React 18/19 Strict Mode double-mount** — exactly one live room after mount → unmount → mount; tools registered once. Test in Task 10.
3. **A client tool navigates (`router.push`) mid-conversation** — with the provider in the root layout the session, mic and agent audio carry on across the route change; the new page's `useAgentContext` value replaces the old one. Test in Task 11 (unit) and Task 12 (example, manual).
4. **Voice started from a click on Safari, or mic permission refused** — starting inside the click handler plays agent audio with no `audioBlocked`; a refused mic ends in `error` with `microphone_denied` and the app can retry in chat mode. Test in Task 8.
5. **Tool handler throws or returns non-JSON (a `Date`, a cycle, `undefined`)** — the agent gets `ok:false` with a message, the app keeps running. Test in Task 7.

## Delivery slices

Work in this order. Each slice ends with something running; nothing in Slice A needs SDK1 or any Voxylo deploy.

**Slice A — voice "Ask my AI" in the portfolio** (no platform changes, no npm publish, runs against production's existing `/widget/v1/start`):
- Task 1 in full, except the repo is created private and `release.yml` is added but not used yet.
- Tasks 2, 3, 5, 6 in full.
- Task 4: `state/types.ts` and `store.ts` with their tests only; `reduceMessages` is Slice C (voice keeps `messages` empty).
- Task 8, voice subset: construction, `connect`/`disconnect`/`destroy`/`forgetSession`, resume, status transitions, session end, reconnect, errors, voice/autoplay/`microphone_denied`, and audio levels. The `sendText`, `selectAction` and `toolCall` tests are Slice C / Slice B.
- Task 10 in full.
- Task 11, voice part: `useVoiceAgent` and `useAudioLevel` (Step 0's voice tests).
- Task 14A.

**Slice B — agentic portfolio** (needs SDK1 deployed to production): Task 7; Task 8's tool and context re-attach tests and the `toolCall` event; Task 11's `useClientTool` and `useAgentContext`; Task 14B.

**Slice C — public release:** Task 4's `reduceMessages`; Task 8's `sendText`/`selectAction` tests; Task 9; Task 11's `VoxyloWidget`; Task 12; make the repo public; Task 13; Task 15.

API names stay `unstable` in spirit until Task 13: if Task 14A shows a hook's shape is wrong, change it in the SDK rather than adapting in the portfolio.

---

### Task 1: Repository scaffold and release pipeline

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.workspace.ts`, `.changeset/config.json`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `LICENSE`, `README.md`, `docs/design.md`
- Create: `packages/client/{package.json,tsconfig.json,tsup.config.ts,src/index.ts,src/server.ts}`, `packages/react/{package.json,tsconfig.json,tsup.config.ts,src/index.ts}`
- Test: `packages/client/src/index.test.ts`, `packages/react/src/index.test.ts`

**Interfaces:**
- Produces: `packages/client` exports map `{ ".": …, "./server": … }`; `packages/react` depends on `"@voxylo/client": "workspace:^"`, peer `react >=18`.

- [ ] **Step 1:** `gh repo create Kiyado-Labs/voxylo-js --private` (ask the user first; it becomes public in Slice C), clone, scaffold the files. CI runs `pnpm install --frozen-lockfile`, `pnpm -r typecheck`, `pnpm -r test`, `pnpm -r build`, `pnpm -r exec publint`, `pnpm -r exec attw --pack .` on Node 18, 20 and 22. Release uses `changesets/action` with `NPM_TOKEN` and `--provenance`.
- [ ] **Step 2: Write smoke tests:** `import * as client from "@voxylo/client"` resolves; `import * as react from "@voxylo/react"` resolves under jsdom; the built `packages/react/dist/index.js` starts with `"use client";`.
- [ ] **Step 3: Run** `pnpm -r build && pnpm -r test` — PASS; `publint` and `attw` report no errors.
- [ ] **Step 4: Commit** `chore: Scaffold voxylo-js workspace` and push.

### Task 2: Wire protocol module

**Files:**
- Create: `packages/client/src/protocol/{types.ts,topics.ts,parsers.ts,index.ts}`, `packages/client/src/protocol/fixtures/*.json`
- Test: `packages/client/src/protocol/parsers.test.ts`

**Interfaces:**
- Produces: types `Turn`, `RichBlock`, `RichAction`, `RichCard`, `RichMessage`, `ToolCallView` (adds optional `source?: "server" | "client"`), `ClientCommand`, `SessionEndReason`, `SessionEvent = { type: "ended"; reason } | { type: "warning"; code: string; detail: string }`; `PROTOCOL_VERSION = 1`; topic constants; `parseTurn(raw: unknown): Turn | null`, `parseRichMessage(raw: unknown): RichMessage | null`, `parseSessionEvent(raw: unknown): SessionEvent | null`, `decodeJson(bytes: Uint8Array): unknown`.

- [ ] **Step 1:** Copy the type shapes from the monorepo's `packages/widget-shared/src/types.ts` and the behavior of `parsers.ts`, and capture one fixture per frame kind (partial turn, final turn with `toolCalls` and `blocks`, each rich block type, `ended` with each reason, `ended` with an unknown reason, `warning`).
- [ ] **Step 2: Write tests:** each fixture parses to the expected object; an unknown `ended` reason maps to `"completed"`; malformed frames (`null`, missing `turnId`, `role: "system"`) return `null`; a `warning` frame parses.
- [ ] **Step 3: Run** `pnpm --filter @voxylo/client exec vitest run src/protocol` — FAIL, then implement, then PASS.
- [ ] **Step 4: Commit** `feat(client): Add protocol v1 types and parsers`.

### Task 3: Sessions over HTTP and typed errors

**Files:**
- Create: `packages/client/src/errors.ts`, `packages/client/src/session.ts`
- Test: `packages/client/src/session.test.ts`

**Interfaces:**
- Produces: `class VoxyloError extends Error { code: VoxyloErrorCode; status?: number }`; `toVoxyloError(res: Response): Promise<VoxyloError>` (reads problem-JSON `code`; maps 404 → `not_found`, 429 → `rate_limited`, 503 → `agent_unavailable`, unknown codes → `unknown`); `interface VoxyloSession { livekitUrl; livekitToken; roomName; chatId; resumeToken?; resumed? }`; `startAnonymousSession(opts: { apiBase; projectId; environment; resumeToken?; caller?; initialMode?; sdk: { name; version }; fetch?: typeof fetch }): Promise<VoxyloSession>` (POST `/widget/v1/start` with `protocolVersion: 1`, `clientInfo` from user agent); `SDK_NAME`/`SDK_VERSION` constants injected at build time.

- [ ] **Step 1: Write tests** with a mocked `fetch`: request body has `projectId`, `environment`, `protocolVersion: 1`, `sdk`; 200 returns `data`; 403 `{code:"origin_not_allowed"}` → `VoxyloError` code `origin_not_allowed`, status 403; 503 `{code:"agent_unavailable"}` → `agent_unavailable`; `fetch` rejecting → `network`; HTML 502 body → `unknown` with status 502.
- [ ] **Step 2: Run** → FAIL; implement; run → PASS.
- [ ] **Step 3: Commit** `feat(client): Start anonymous sessions with typed errors`.

### Task 4: Message store

**Files:**
- Create: `packages/client/src/state/{types.ts,messages.ts,store.ts}`
- Test: `packages/client/src/state/messages.test.ts`, `store.test.ts`

**Interfaces:**
- Produces: `ClientState`, `Message`, `ConnectionStatus`, `AgentState` (spec shapes); `INITIAL_STATE`; `type MessageEvent = { kind: "turn"; turn: Turn } | { kind: "agentText"; streamId: string; text: string; done: boolean } | { kind: "rich"; message: RichMessage } | { kind: "localText"; id: string; text: string; atMs: number }`; `reduceMessages(messages: readonly Message[], e: MessageEvent): Message[]`; `createStore(initial: ClientState): { get(): ClientState; set(patch: Partial<ClientState> | ((s) => Partial<ClientState>)): void; subscribe(fn: () => void): () => void }` (no notify when nothing changed; snapshots are frozen in dev).

- [ ] **Step 1:** Read `packages/widget/src/components/chat/use-chat-session.ts` in the monorepo and port its reconciliation rules into `reduceMessages`. Write tests for each rule: a partial turn then a final turn with the same `turnId` → one message, `streaming:false`; `agentText` frames then the final `voxylo.turn` → one message with the turn's text; a local optimistic user message is replaced by the server's user turn with the same text; a live rich block attaches to the message with its `turnId`, or appends to the last agent message when `turnId` is absent; resume history (final turns with `blocks`) renders blocks once.
- [ ] **Step 2: Store tests:** `subscribe` fires once per effective change, not for identical patches; `get()` returns the same object reference between changes.
- [ ] **Step 3: Run** → FAIL; implement; → PASS.
- [ ] **Step 4: Commit** `feat(client): Add message reconciliation and snapshot store`.

### Task 5: Room adapter

**Files:**
- Create: `packages/client/src/room/{adapter.ts,fake-room.ts}` (`fake-room.ts` exported only to tests)
- Test: `packages/client/src/room/adapter.test.ts`

**Interfaces:**
- Consumes: Task 2 parsers.
- Produces: `interface RoomLike` (the subset of `livekit-client` `Room` the adapter uses: `connect`, `disconnect`, `on/off`, `localParticipant.{publishData, sendText, setAttributes, setMicrophoneEnabled, identity}`, `registerTextStreamHandler`, `registerRpcMethod`, `unregisterRpcMethod`, `remoteParticipants`, `startAudio`, `canPlaybackAudio`); `connectRoom(room: RoomLike, session: VoxyloSession, handlers: RoomHandlers, opts: { sdk: string }): Promise<RoomConnection>` where `RoomHandlers = { onTurn; onAgentText; onRich; onSessionEvent; onAgentState(s: AgentState); onDisconnected(reason?: string); onReconnecting(); onReconnected(); onAudioPlaybackChanged(canPlay: boolean) }` and `RoomConnection = { sendCommand(cmd: ClientCommand): Promise<void>; sendTextStream(topic: string, text: string): Promise<void>; setMic(on: boolean): Promise<void>; registerRpc(method: string, fn: RpcHandler): void; isAgent(identity: string): boolean; close(): Promise<void> }`.

- [ ] **Step 1: Write tests** against `FakeRoom`: after connect, attributes `{ "voxylo.protocol": "1", "voxylo.sdk": "<sdk>" }` are set; a `voxylo.turn` packet reaches `onTurn`; `voxylo.session` `ended` reaches `onSessionEvent`; a `lk.transcription` stream from the agent emits growing `onAgentText` and a final `done:true`, and one from the local identity is ignored; agent attribute `lk.agent.state = "thinking"` → `onAgentState("thinking")`; `sendCommand` publishes on `voxylo.client.cmd` reliably; `isAgent` is true only for a participant with kind agent.
- [ ] **Step 2: Run** → FAIL; implement; → PASS.
- [ ] **Step 3: Commit** `feat(client): Bridge the LiveKit room to protocol events`.

### Task 6: Resume storage

**Files:**
- Create: `packages/client/src/resume.ts`
- Test: `packages/client/src/resume.test.ts`

**Interfaces:**
- Produces: `createResumeStore(opts: VoxyloClientOptions["resume"], key: string): { get(): string | null; set(token: string): void; clear(): void }` — every storage call wrapped in try/catch; `false` → a no-op store; default storage `globalThis.localStorage` when present, else in-memory.

- [ ] **Step 1: Tests:** key format `voxylo:resume:proj_1:main` and `voxylo:resume:custom:main`; a throwing storage never throws out; `false` never stores.
- [ ] **Step 2: Run** → FAIL; implement; → PASS.
- [ ] **Step 3: Commit** `feat(client): Store resume tokens safely`.

### Task 7: Client tools and context

**Files:**
- Create: `packages/client/src/tools.ts`, `packages/client/src/context.ts`
- Test: `packages/client/src/tools.test.ts`, `context.test.ts`

**Interfaces:**
- Consumes: Task 5 `RoomConnection`.
- Produces: `interface ClientToolDefinition { name: string; description: string; parameters: JsonSchemaObject; timeoutMs?: number; handler(args: any, ctx: { callId: string; signal: AbortSignal }): unknown | Promise<unknown> }`; `class ToolRegistry { register(def): () => void; attach(conn: RoomConnection): void; detach(): void }` — validates on `register` (throws `TypeError` with the rule broken), sends `{ rev, tools }` on `voxylo.client.tools` debounced 50 ms and on every `attach`, handles RPC `voxylo.client_tool` (rejects non-agent callers, unknown names, results over 15000 bytes, non-serializable results, thrown errors — each as `{ ok:false, error }`), aborts in-flight handlers on `detach` and on timeout; `class ContextChannel { set(value): void; attach(conn): void; detach(): void }` — throws `RangeError` over 8192 bytes, debounced 100 ms, re-sent on `attach`.

- [ ] **Step 1: Write tests** with fake timers and a fake connection: two `register` calls within 50 ms → one declaration with `rev` 1 and both tools; unregister → new declaration without it, `rev` 2; 17th tool → `TypeError`; RPC for `showProducts` with `{ids:[1]}` → handler receives args, response `{"ok":true,"result":…}`; handler throws `new Error("boom")` → `{"ok":false,"error":"boom"}`; handler returns a cyclic object → `{"ok":false,"error":"result is not JSON-serializable"}`; result over 15000 bytes → `{"ok":false,"error":"result too large"}`; caller not an agent → `{"ok":false,"error":"forbidden"}`; `detach` aborts the handler's signal; context set twice within 100 ms → one send with the second value; re-attach re-sends the last context and declaration.
- [ ] **Step 2: Run** → FAIL; implement; → PASS.
- [ ] **Step 3: Commit** `feat(client): Register client tools and send page context`.

### Task 8: `createVoxyloClient`

**Files:**
- Create: `packages/client/src/client.ts`, `packages/client/src/audio.ts`
- Modify: `packages/client/src/index.ts` (public exports only)
- Test: `packages/client/src/client.test.ts`

**Interfaces:**
- Consumes: Tasks 2–7.
- Produces: `createVoxyloClient(options: VoxyloClientOptions): VoxyloClient` (spec shape, including `getAudioLevel(source)` and `subscribeAudioLevel(source, fn)`; `audio.ts` ports the analyser from the monorepo's `packages/widget/src/livekit-speaking.ts`) and internal `createClient(options, deps: { createRoom(): RoomLike; fetch: typeof fetch; now(): number })` used by tests.

- [ ] **Step 1: Write tests:**
  - Constructing with neither `projectId` nor `getSession` throws `TypeError`.
  - `connect()` status sequence `idle → connecting → connected`; stored resume token is sent; the new token is stored; `resumed:false` clears messages.
  - `getSession` provided → called with `{ resumeToken }` and no HTTP call; it throwing → status `error`, `error.code === "session_failed"`.
  - `sendText("hi")` while `connecting` (Review Focus 3) → published after connect, and an optimistic user message appears immediately; while `error` → rejects with that `VoxyloError`.
  - `selectAction(blockId, actionId)` sends `block_action` with the issued action's `label` and `value`; unknown ids reject with `TypeError`.
  - `ended` with `completed` → status `ended`, resume token cleared; with `idle` → token kept.
  - Room reconnecting/reconnected → status `reconnecting` → `connected`; tools and context re-attached.
  - Voice mode: `connect({ mode: "voice" })` calls `startAudio` and the mic request synchronously, before its first `await` (assert call order on the fakes); autoplay still blocked (fake `canPlaybackAudio=false`) → `audioBlocked:true`; `startAudio()` → `false`; the mic request rejecting with `NotAllowedError` → status `error`, `error.code === "microphone_denied"`, and a following `connect({ mode: "chat" })` succeeds (Review Focus 4).
  - `sendText("hi")` before connect finishes → sent once connected, never dropped.
  - Audio levels (`audio.ts`, fake `AnalyserNode` and `requestAnimationFrame`): `subscribeAudioLevel("agent", fn)` receives values in `0..1`, at most one per frame; `"active"` follows the agent while `agentState === "speaking"` and the mic otherwise; a muted mic reads 0; nothing is emitted while disconnected; unsubscribing stops the frame loop when no subscribers remain.
  - `on("toolCall", fn)` fires with `{ name, args, result | error, durationMs }`.
  - `destroy()` disconnects, removes listeners, and later calls are no-ops.
  - `forgetSession()` disconnects, clears the stored resume token and `messages`; the next `connect()` sends no `resumeToken`.
- [ ] **Step 2: Run** → FAIL; implement; → PASS.
- [ ] **Step 3: Commit** `feat(client): Add createVoxyloClient`.

### Task 9: Server helper

**Files:**
- Modify: `packages/client/src/server.ts`
- Test: `packages/client/src/server.test.ts`

**Interfaces:**
- Produces: `createSession(opts)` (spec shape) → POST `${apiBase}/api/v1/projects/${projectId}/environments/${environmentId}/sessions` with `Authorization: Bearer ${apiKey}`; returns `VoxyloSession`; errors via `toVoxyloError`.

- [ ] **Step 1: Tests:** correct URL, header and body; 403 maps to `VoxyloError`; when `globalThis.window` is defined it throws `Error("createSession must run on your server; never ship your API key to the browser")` before any fetch.
- [ ] **Step 2: Run** → FAIL; implement; → PASS.
- [ ] **Step 3: Commit** `feat(client): Add server-side createSession`.

### Task 10: React provider and state hooks

**Files:**
- Create: `packages/react/src/{provider.tsx,use-voxylo.ts,context.ts}`
- Test: `packages/react/src/provider.test.tsx`

**Interfaces:**
- Consumes: `createVoxyloClient`, `VoxyloClient`, `ClientState` from `@voxylo/client`.
- Produces: `VoxyloProvider(props: { options: VoxyloClientOptions; children } | { client: VoxyloClient; children })`, `useVoxylo(): { state: ClientState } & Pick<VoxyloClient, "connect" | "disconnect" | "forgetSession" | "sendText" | "selectAction" | "setMicEnabled" | "setSpeakerEnabled" | "startAudio" | "setContext" | "registerTool">`, `useVoxyloState<T>(selector: (s: ClientState) => T): T`, `useVoxyloClient(): VoxyloClient`. Using a hook outside the provider throws `Error("useVoxylo must be used inside <VoxyloProvider>")`.

- [ ] **Step 1: Write tests:** `renderToString(<VoxyloProvider options={…}><Status/></VoxyloProvider>)` with `window` deleted does not throw and renders `idle` (Review Focus 1); Strict Mode mount → one client alive after effects settle and `destroy` called on unmount (Review Focus 2); `useVoxyloState(s => s.status)` re-renders only when status changes; changing `options` after mount logs one dev warning and keeps the same client; action functions keep identity across renders.
- [ ] **Step 2: Run** `pnpm --filter @voxylo/react exec vitest run` → FAIL; implement; → PASS.
- [ ] **Step 3: Commit** `feat(react): Add VoxyloProvider and state hooks`.

### Task 11: React voice, tool, context and widget hooks

**Files:**
- Create: `packages/react/src/{use-voice-agent.ts,use-audio-level.ts,use-client-tool.ts,use-agent-context.ts,voxylo-widget.tsx}`
- Test: `packages/react/src/use-voice-agent.test.tsx`, `use-audio-level.test.tsx`, `use-client-tool.test.tsx`, `use-agent-context.test.tsx`, `voxylo-widget.test.tsx`

**Interfaces:**
- Produces: `useVoiceAgent()` and `useAudioLevel(source?, opts?)` (spec shapes), `useClientTool(def: ClientToolDefinition): void`, `useAgentContext(value: Record<string, unknown> | null): void`, `VoxyloWidget(props: { projectId: string; environment?: string; apiBase?: string }): null`.

- [ ] **Step 0: Write voice tests first:** `useVoiceAgent().status` is `connecting` while connecting, `listening` when connected with `agentState` `idle` or `listening`, `thinking`/`speaking` from `agentState`, `ended` after the session ends, `error` with `error` set; `muted` mirrors `!micEnabled`; `start` calls `connect({ mode: "voice" })` synchronously in the same tick (so a click handler keeps its gesture); `toggleMute` flips the mic. `useAudioLevel("active", { fps: 30 })` updates React state at most 30 times per second from a fake `subscribeAudioLevel` emitting every frame, and unsubscribes on unmount. A component that registers a tool and context, then is replaced by another page's component inside the same provider (simulated route change, Review Focus 3), leaves the client connected, the old tool unregistered, and the new context sent.

- [ ] **Step 1: Write tests:** `useClientTool` registers on mount and unregisters on unmount; re-rendering with a new inline `handler` does not re-register, and the RPC calls the newest handler; changing `description` re-registers; Strict Mode leaves exactly one registration. `useAgentContext({page:"a"})` re-rendered with an equal new object → one `setContext` call; `{page:"b"}` → second call; unmount → `setContext(null)`. `VoxyloWidget` appends exactly one `<script src="https://cdn.voxylo.cloud/widget/latest/loader.js" data-project-id=…>` even when rendered twice, and renders nothing.
- [ ] **Step 2: Run** → FAIL; implement; → PASS.
- [ ] **Step 3: Commit** `feat(react): Add useClientTool, useAgentContext and VoxyloWidget`.

### Task 12: Next.js example and READMEs

**Files:**
- Create: `examples/nextjs/` (App Router, Next 16): `app/layout.tsx` (mounts `VoxyloProvider` once for the whole app), `app/page.tsx` (anonymous chat), `app/signed-in/page.tsx` + `app/api/voxylo-session/route.ts` (server-minted session via `createSession`, `runtime = "edge"`), `app/shop/page.tsx` + `app/shop/[id]/page.tsx` (client tools `showProducts`, `openProduct` that calls `router.push`, context `{ page, productId }`, renders the products the agent picks), `app/voice/page.tsx` (a single custom mic button driven by `useVoiceAgent` and `useAudioLevel`, Esc to end; no transcript), `.env.example` (`NEXT_PUBLIC_VOXYLO_PROJECT_ID=`, `VOXYLO_API_KEY=`, `VOXYLO_PROJECT_ID=`, `VOXYLO_ENVIRONMENT_ID=`)
- Create/Modify: `README.md`, `packages/client/README.md`, `packages/react/README.md`
- Test: CI job `pnpm --filter nextjs-example build`

- [ ] **Step 1:** Build the example against the workspace packages. The signed-in route reads the app's own user (a hard-coded demo user is fine) and never returns the API key.
- [ ] **Step 2:** READMEs: 5-minute quick start (anonymous), signed-in sessions, client tools, context, voice, errors table (every `VoxyloError.code` with what to show the user), security notes (never ship `pvk_` keys; set allowed origins).
- [ ] **Step 3: Run** `pnpm --filter nextjs-example build` → PASS; `grep -r "pvk_" examples packages --include=*.ts*` → no matches.
- [ ] **Step 4: Manual check** against production (SDK1 deployed), using a test project: the shop page's "Show me something under $50" makes the agent call `showProducts` and the products render; refreshing resumes the chat; voice page speaks and shows `agentState`.
- [ ] **Step 5: Commit** `docs: Add Next.js example and package READMEs`.

### Task 13: Pre-release to `next`

- [ ] **Step 1:** User claims the npm org `voxylo` (or decides on `@voxylohq`) and adds `NPM_TOKEN` to the repo secrets. Ask before any publish.
- [ ] **Step 2:** `pnpm changeset` → minor for both packages (`0.1.0`); merge the "Version Packages" PR; release workflow publishes with `--tag next --provenance`.
- [ ] **Step 3:** In a fresh `npx create-next-app` project: `npm i @voxylo/react@next`, run the README quick start against production (SDK1 must be deployed) — a reply arrives.

### Task 14A: Voice "Ask my AI" in the portfolio (Slice A)

Runs in the portfolio repo (`/Users/niyaz/Desktop/Personal/Personal Portfolio`: pnpm 12, Node ≥22, Next 16.4, React 19.3). Its `main` checkout has unrelated uncommitted CMS edits, so work in a worktree: `git worktree add ../portfolio-voxylo-voice -b feat/voxylo-voice` (ask first). Commits there follow the same ask-first rule.

**Prereq (user, Voxylo dashboard, production):** a `webchat` project "Ask my AI" with voice modality; agent prompt written as Niyas's assistant; knowledge base with the CV and project write-ups; widget config published (`/widget/v1/start` refuses a project without one). Note the project ID.

**Files (portfolio):**
- Modify: `apps/portfolio/package.json` — `@voxylo/react` and `@voxylo/client` as `file:` tarballs from `pnpm pack` in `voxylo-js/packages/*` (not `link:`: a symlinked package resolves its own `react` and breaks hooks with two Reacts), plus a `pnpm.overrides` entry pointing `@voxylo/client` at its tarball.
- Modify: `apps/portfolio/src/app/layout.tsx` (mount `VoxyloProvider` with `options={{ projectId: process.env.NEXT_PUBLIC_VOXYLO_PROJECT_ID }}`), `apps/portfolio/.env.example` (`NEXT_PUBLIC_VOXYLO_PROJECT_ID=`), `apps/portfolio/src/components/voice/use-voice-session.ts` (bodies replaced; returned `{ status, muted, level, press, end }` unchanged; the "DEMO DRIVER" comment replaced by one line naming the SDK).

- [ ] **Step 1:** Replace the fake driver: `status` = `useVoiceAgent().status` mapped (`thinking` → `listening`, `ended`/`error` → `idle`), `muted`, `level` = `useAudioLevel("active")`, `press` = idle ? `start` : `toggleMute`, `end`. The existing Esc handler stays. `hero.tsx` and `voice-key.tsx` must not change (`git diff --stat` shows neither).
- [ ] **Step 2:** `pnpm typecheck`, `pnpm lint`, `pnpm --filter portfolio build` from the portfolio root — PASS.
- [ ] **Step 3: Manual check** at `http://localhost:3000` (Chrome, then Safari): press the keycap → Connecting → Listening; speak → the keycap animates with your voice; the agent answers → Speaking with the agent's level; mute, unmute and Esc work; reload mid-conversation and start again → the chat resumes; deny the mic → the keycap returns to idle with no console errors left unhandled.
- [ ] **Step 4:** List every place the integration needed more than the hook promised; fix it in the SDK (re-pack, reinstall) rather than in the portfolio.
- [ ] **Step 5:** Do not deploy the portfolio with this until Slice B's allowed origins are live, unless the user accepts the open-endpoint exposure (anyone holding the project ID can start sessions, capped by the 60/min start rate limit).

### Task 14B: Agentic "Ask my AI" (Slice B)

**Prereq:** SDK1 deployed to production; in the dashboard's Access card, `allowedOrigins` = the portfolio's production origin and `http://localhost:3000`.

**Files (portfolio):**
- Create: `apps/portfolio/src/components/voice/portfolio-agent-tools.tsx` (`openProject(slug)` → `router.push("/projects/" + slug)` after checking the slug against the published projects; `scrollToSection(id: "work" | "projects" | "about")`; `useAgentContext({ path, projectSlug })`), mounted once inside the provider in `layout.tsx`.

- [ ] **Step 1:** Re-pack and reinstall the SDK tarballs with Slice B's hooks; add the tools component.
- [ ] **Step 2:** `pnpm typecheck`, `pnpm lint`, `pnpm --filter portfolio build` — PASS.
- [ ] **Step 3: Manual check:** "Show me your latest project" → the agent calls `openProject`, the page navigates and the conversation keeps going; "Take me to your work" → it scrolls to the Work section; on a project page, "What did you do here?" → the answer is about that project (context).
- [ ] **Step 4 (Slice C, after Task 13):** switch the dependencies from tarballs to `@voxylo/react@next` and add `@voxylo/*` to `minimumReleaseAgeExclude` in the portfolio's `pnpm-workspace.yaml` (otherwise pnpm refuses a just-published version).

### Task 15: Promote to `latest`

- [ ] **Step 1:** `npm dist-tag add @voxylo/client@<version> latest` and the same for `@voxylo/react` (ask first). Tag the repo `v<version>` with release notes.
