/**
 * File transfer & streaming contracts (spec §16–§18, Phase 1 types only).
 *
 * The protocol message names are fixed in `protocol/MessageTypes.ts`
 * (FILE_START … FILE_ERROR). This module defines the data shapes that flow
 * through them. Chunker / Reassembler / FlowController implementations
 * arrive in Phases 7–8; nothing here performs I/O yet.
 */
export type TransferId = string;
/** Metadata advertised at FILE_START (spec §17 example). */
export interface TransferMetadata {
    transferId: TransferId;
    fileName: string;
    mimeType: string;
    /** Total size in bytes. */
    size: number;
    /** Negotiated chunk size in bytes. */
    chunkSize: number;
    /** Algorithm name, e.g. "sha-256"; empty string means unchecked. */
    checksumAlgorithm: string;
    /** Hex digest of the whole payload (computed incrementally on receive). */
    checksum?: string;
    /** Bytes already transferred when resuming a paused session. */
    resumeOffset?: number;
}
export interface FileTransferProgress {
    /** Bytes acknowledged by the remote side so far. */
    transferredBytes: number;
    totalBytes: number;
    /** Instantaneous throughput in bytes/sec (smoothed by the manager). */
    bytesPerSecond: number;
    /** 0..1 convenience ratio. */
    fraction: number;
}
export interface TransferErrorInfo {
    code: "rejected" | "timeout" | "checksum-mismatch" | "peer-disconnected" | "limit-exceeded" | "cancelled" | "protocol-error";
    message: string;
}
export type TransferDirection = "send" | "receive";
export type TransferState = "proposed" | "accepted" | "transferring" | "paused" | "completed" | "cancelled" | "failed";
/** Handle returned to applications when they start/accept a transfer. */
export interface FileTransferHandle {
    readonly transferId: TransferId;
    readonly peerId: string;
    readonly direction: TransferDirection;
    readonly state: TransferState;
    readonly metadata: TransferMetadata;
    pause(): Promise<void>;
    resume(): Promise<void>;
    cancel(reason?: string): Promise<void>;
    /** Accept an incoming proposed transfer and stream it into `sink`. */
    accept(sink: unknown): Promise<void>;
}
export type StreamId = string;
/**
 * Transport-agnostic streaming abstraction. File transfer is one consumer;
 * binary/application streams can register others without touching the
 * transport layer.
 */
export interface BinaryStreamOptions {
    id?: StreamId;
    /** Logical channel carrying the stream; defaults to "files". */
    channel?: "files" | "sync" | "messages";
    /** High-water mark for backpressure (bytes buffered before pausing). */
    highWaterMarkBytes?: number;
}
export interface StreamHandle {
    readonly id: StreamId;
    write(chunk: Uint8Array): Promise<void>;
    end(): Promise<void>;
    abort(reason?: string): void;
}
//# sourceMappingURL=types.d.ts.map