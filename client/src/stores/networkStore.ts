import { create } from 'zustand';

interface NetworkState {
  connected: boolean;
  rtt: number;
  jitter: number;
  localPlayerId: string | null;
  roomId: string | null;
  restoredUsername: string | null;
  setConnected: (v: boolean) => void;
  setRtt: (ms: number) => void;
  setJitter: (ms: number) => void;
  setLocalPlayerId: (id: string) => void;
  setRoomId: (id: string) => void;
  setRestoredUsername: (name: string | null) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  connected: false,
  rtt: 0,
  jitter: 0,
  localPlayerId: null,
  roomId: null,
  restoredUsername: null,
  setConnected: (v) => set({ connected: v }),
  setRtt: (ms) => set({ rtt: ms }),
  setJitter: (ms) => set({ jitter: ms }),
  setLocalPlayerId: (id) => set({ localPlayerId: id }),
  setRoomId: (id) => set({ roomId: id }),
  setRestoredUsername: (name) => set({ restoredUsername: name }),
}));
