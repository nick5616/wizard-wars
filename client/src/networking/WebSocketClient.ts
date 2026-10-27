import { C2S, S2C } from "shared/events";
import { CLOCK_SYNC_INTERVAL } from "shared/constants";
import { ClockSync } from "./ClockSync";
import { useNetworkStore } from "../stores/networkStore";

const JITTER_SAMPLE_WINDOW = 30; // last N inter-tick gaps used to compute jitter
const CLOCK_BURST_DELAYS_MS = [120, 240, 400, 700]; // extra clock pings right after connect

type MessageHandler = (msg: Record<string, unknown>) => void;

export class WebSocketClient {
    private ws: WebSocket | null = null;
    private url: string;
    private clockSync: ClockSync;
    private clockSyncTimer: ReturnType<typeof setInterval> | null = null;
    private handlers = new Map<string, MessageHandler[]>();
    private reconnectDelay = 1000;
    private _destroyed = false;
    private _generation = 0;
    private _lastTickArrival: number | null = null;
    private _tickGaps: number[] = [];
    private _burstTimers: ReturnType<typeof setTimeout>[] = [];
    private _openHandlers: Array<(isReconnect: boolean) => void> = [];
    private _closeHandlers: Array<() => void> = [];
    private _hasConnectedBefore = false;

    constructor(url: string, clockSync: ClockSync) {
        this.url = url;
        this.clockSync = clockSync;
    }

    connect() {
        this._destroyed = false;
        const gen = ++this._generation;

        // Silence the old socket so its onclose doesn't trigger a reconnect loop.
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.close();
        }

        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            console.log("[WS] Connected");
            useNetworkStore.getState().setConnected(true);
            this.reconnectDelay = 1000;
            // New socket = new timeline: sequence/clock/jitter state from the
            // old one would otherwise poison the first seconds after a reconnect.
            const isReconnect = this._hasConnectedBefore;
            this._hasConnectedBefore = true;
            if (isReconnect) {
                this.clockSync.reset();
                this._lastTickArrival = null;
                this._tickGaps = [];
            }
            this._startClockSync();
            for (const h of this._openHandlers) h(isReconnect);
        };

        this.ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
                this._dispatch(msg);
            } catch {
                // ignore malformed
            }
        };

        this.ws.onclose = (event) => {
            if (gen !== this._generation) return; // stale socket, ignore
            console.log(`[WS] Disconnected (code=${event.code}, reason="${event.reason}", wasClean=${event.wasClean})`);
            useNetworkStore.getState().setConnected(false);
            this._stopClockSync();
            // 4001: another tab opened the same clientId and the server dropped us (see
            // GameServer.onConnection). Reconnecting would just kick that tab back out.
            if (event.code === 4001) {
                this._destroyed = true;
                useNetworkStore.getState().setReplaced(true);
                return;
            }
            for (const h of this._closeHandlers) h();
            if (!this._destroyed) {
                setTimeout(() => this.connect(), this.reconnectDelay);
                this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
            }
        };

        this.ws.onerror = (event) => {
            if (gen !== this._generation) return;
            console.error("[WS] Error:", event);
            this.ws?.close();
        };
    }

    disconnect() {
        this._destroyed = true;
        this._stopClockSync();
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.close();
        }
    }

    send(type: string, payload: Record<string, unknown> = {}) {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ type, ...payload }));
    }

    /** Fires on every socket open; `isReconnect` is false only for the very first one. */
    onOpen(handler: (isReconnect: boolean) => void) {
        this._openHandlers.push(handler);
        return () => { this._openHandlers = this._openHandlers.filter((h) => h !== handler); };
    }

    /** Fires when an established socket drops (before the auto-reconnect is scheduled). */
    onClose(handler: () => void) {
        this._closeHandlers.push(handler);
        return () => { this._closeHandlers = this._closeHandlers.filter((h) => h !== handler); };
    }

    on(type: string, handler: MessageHandler) {
        if (!this.handlers.has(type)) this.handlers.set(type, []);
        this.handlers.get(type)!.push(handler);
        return () => this.off(type, handler);
    }

    off(type: string, handler: MessageHandler) {
        const arr = this.handlers.get(type);
        if (arr) {
            const idx = arr.indexOf(handler);
            if (idx >= 0) arr.splice(idx, 1);
        }
    }

    private _dispatch(msg: Record<string, unknown>) {
        const type = msg.type as string;

        // Handle clock sync internally
        if (type === S2C.CLOCK_SYNC) {
            this.clockSync.onResponse(
                msg.t1 as number,
                msg.t2 as number,
                msg.t3 as number,
            );
            useNetworkStore.getState().setRtt(this.clockSync.rtt);
            return;
        }

        // Jitter: standard deviation of GAME_TICK inter-arrival gaps vs. the
        // expected tick interval. A far more responsive/truthful "is the
        // connection choppy right now" signal than the 5s clock-sync RTT
        // samples -- and it doubles as a way to see server tick-scheduling
        // jitter (see server/src/GameLoop.js) show up on the client.
        if (type === S2C.GAME_TICK) {
            const now = performance.now();
            if (this._lastTickArrival !== null) {
                this._tickGaps.push(now - this._lastTickArrival);
                if (this._tickGaps.length > JITTER_SAMPLE_WINDOW) this._tickGaps.shift();
            }
            this._lastTickArrival = now;

            if (this._tickGaps.length >= 4) {
                const mean = this._tickGaps.reduce((a, b) => a + b, 0) / this._tickGaps.length;
                const variance = this._tickGaps.reduce((a, b) => a + (b - mean) ** 2, 0) / this._tickGaps.length;
                useNetworkStore.getState().setJitter(Math.sqrt(variance));
            }
        }

        const handlers = this.handlers.get(type) ?? [];
        for (const h of handlers) h(msg);
    }

    private _startClockSync() {
        // A burst of pings right after connect so the clock is usable within
        // ~0.5s instead of after the first 5s interval; the min-RTT pick in
        // ClockSync then has several samples to choose from.
        this._sendClockSync();
        for (const delay of CLOCK_BURST_DELAYS_MS) {
            this._burstTimers.push(setTimeout(() => this._sendClockSync(), delay));
        }
        this.clockSyncTimer = setInterval(
            () => this._sendClockSync(),
            CLOCK_SYNC_INTERVAL,
        );
    }

    private _stopClockSync() {
        for (const t of this._burstTimers) clearTimeout(t);
        this._burstTimers = [];
        if (this.clockSyncTimer) {
            clearInterval(this.clockSyncTimer);
            this.clockSyncTimer = null;
        }
    }

    private _sendClockSync() {
        this.send(C2S.CLOCK_SYNC, { t1: Date.now() });
    }

    get rtt() {
        return this.clockSync.rtt;
    }
    get serverNow() {
        return this.clockSync.serverNow();
    }
}
