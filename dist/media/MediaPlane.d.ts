/**
 * Media Plane contracts (spec §19–§24, Phase 1 interfaces only).
 *
 * Audio/video/screen travel on WebRTC *tracks*, never DataChannels. The
 * managers below sit on top of `MediaTransport`, which hides whether the
 * underlying architecture is mesh P2P or a future SFU.
 */
import type { MediaKind, ManagedMediaTrack } from "../transport/MediaTransport.js";
/** Local capture constraints passed through to the host runtime. */
export interface AudioConstraints {
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    autoGainControl?: boolean;
    deviceId?: string;
}
export interface VideoConstraints {
    width?: number;
    height?: number;
    frameRate?: number;
    facingMode?: "user" | "environment";
    deviceId?: string;
}
export interface ScreenShareConstraints {
    /** Ask for system audio where supported. */
    audio?: boolean;
    /** Prefer tab/window/screen capture hints where supported. */
    video?: {
        cursor?: "always" | "move" | "never";
    };
}
export interface RemoteTrackInfo {
    peerId: string;
    trackId: string;
    kind: MediaKind;
}
/** Common surface shared by AudioManager / VideoManager / ScreenShareManager. */
export interface MediaManagerBase<TConstraints> {
    readonly kind: MediaKind;
    /** Start local capture and send it to connected peers. */
    start(constraints?: TConstraints): Promise<ManagedMediaTrack>;
    /** Stop local capture entirely. */
    stop(): Promise<void>;
    /** Temporarily silence/blacken without renegotiating. */
    setEnabled(enabled: boolean): Promise<void>;
    getLocal(): ManagedMediaTrack | undefined;
    listRemote(): readonly RemoteTrackInfo[];
    /** Attach a locally-held track instead of capturing (e.g. canvas stream). */
    useTrack(track: unknown): Promise<ManagedMediaTrack>;
}
export type AudioManagerApi = MediaManagerBase<AudioConstraints>;
export type VideoManagerApi = MediaManagerBase<VideoConstraints>;
export type ScreenShareManagerApi = MediaManagerBase<ScreenShareConstraints>;
/** Facade held by `P2PClient.media`. */
export interface MediaPlaneApi {
    readonly audio: AudioManagerApi;
    readonly video: VideoManagerApi;
    readonly screen: ScreenShareManagerApi;
}
//# sourceMappingURL=MediaPlane.d.ts.map