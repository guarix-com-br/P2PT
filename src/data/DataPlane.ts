/**
 * Data Plane contracts (spec §11–§15, Phase 1 interfaces only).
 *
 * The Data Plane carries application data (messages, RPC, files, binary
 * streams, state sync) over the logical channels defined in
 * `transport/channels.ts`. It is fully independent of the Media Plane.
 */

import type { ChannelName } from "../transport/channels.js";

/** Payload types accepted by the messaging API (spec §14). */
export type MessagePayload =
  string | number | boolean | null | JsonValue | Uint8Array | ArrayBuffer;

export type JsonValue =
  string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

/** A typed message envelope as delivered to subscribers. */
export interface Message<TPayload = MessagePayload, TMeta = JsonValue> {
  /** Unique id (assigned by sender) for acks/deduplication. */
  id: string;
  /** Application-level discriminator, e.g. "chat". */
  type: string;
  payload: TPayload;
  metadata?: TMeta;
  /** Sending peer id (filled in on receive). */
  from?: string;
  /** Send timestamp (ms epoch). */
  sentAt: number;
}

export interface SendMessageOptions {
  /** Logical channel override; defaults to "messages". */
  channel?: ChannelName;
}

export interface MessageSubscription {
  unsubscribe(): void;
}

/** Messaging surface exposed on `Peer` (implemented Phase 5). */
export interface MessagingApi {
  sendMessage(
    message: { type: string; payload: MessagePayload; metadata?: JsonValue },
    options?: SendMessageOptions,
  ): Promise<Message>;
  broadcast(
    message: { type: string; payload: MessagePayload; metadata?: JsonValue },
    options?: SendMessageOptions,
  ): Promise<void>;
  subscribe(handler: (message: Message) => void): MessageSubscription;
  unsubscribe(subscription: MessageSubscription): void;
}

/* --------------------------------- RPC -------------------------------- */

/** Info delivered with `rpc:request` events (server side). */
export interface RpcRequestInfo {
  requestId: string;
  peerId: string;
  method: string;
  params: JsonValue;
}

/** Info delivered with `rpc:response` events / returned to callers. */
export interface RpcResponseInfo {
  requestId: string;
  peerId: string;
  method: string;
  ok: boolean;
  result?: JsonValue;
  error?: { code: string; message: string };
}

export interface RpcCallOptions {
  /** Overrides config `requestTimeout`. */
  timeoutMs?: number;
  /** Cancel an in-flight request (spec §15: use AbortController). */
  signal?: AbortSignal;
}

export interface RpcRegistration {
  unregister(): void;
}

/** RPC surface (implemented Phase 6). */
export interface RpcApi {
  request(
    method: string,
    params?: JsonValue,
    options?: RpcCallOptions,
  ): Promise<JsonValue>;
  register(
    method: string,
    handler: (params: JsonValue, info: RpcRequestInfo) => Promise<JsonValue> | JsonValue,
  ): RpcRegistration;
}

/* ---------------------------- State sync ------------------------------ */

export interface StateSyncApi {
  /** Share a namespaced document between peers (CRDT-free last-writer-wins
   * first; conflict strategy pluggable later). Implemented Phase 5+. */
  define(namespace: string, initial: JsonValue): void;
  get<T extends JsonValue>(namespace: string): T | undefined;
  set(namespace: string, value: JsonValue): Promise<void>;
  watch(namespace: string, handler: (value: JsonValue) => void): () => void;
}

/** Facade held by `P2PClient.data`. */
export interface DataPlaneApi {
  readonly messaging: MessagingApi;
  readonly rpc: RpcApi;
  readonly state: StateSyncApi;
}
