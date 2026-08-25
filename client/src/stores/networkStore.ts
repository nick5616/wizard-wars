import { create } from 'zustand';
import type { WizardClass } from '../types/game.types';

interface NetworkState {
  connected: boolean;
  rtt: number;
  jitter: number;
  localPlayerId: string | null;
  roomId: string | null;
  restoredUsername: string | null;
  // Set from S2C.ROOM_JOINED when a previous session is restored -- read by
  // the main menu's "Multiplayer" button so it can jump straight back into
  // the arena instead of re-showing class select, without forcing that
  // decision the instant the app connects (see App.tsx's ROOM_JOINED handler).
  restoredClass: WizardClass | null;
  setConnected: (v: boolean) => void;
  setRtt: (ms: number) => void;
  setJitter: (ms: number) => void;
  setLocalPlayerId: (id: string) => void;
  setRoomId: (id: string) => void;
  setRestoredUsername: (name: string | null) => void;
  setRestoredClass: (c: WizardClass | null) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  connected: false,
  rtt: 0,
  jitter: 0,
  localPlayerId: null,
  roomId: null,
  restoredUsername: null,
  restoredClass: null,
  setConnected: (v) => set({ connected: v }),
  setRtt: (ms) => set({ rtt: ms }),
  setJitter: (ms) => set({ jitter: ms }),
  setLocalPlayerId: (id) => set({ localPlayerId: id }),
  setRoomId: (id) => set({ roomId: id }),
  setRestoredUsername: (name) => set({ restoredUsername: name }),
  setRestoredClass: (c) => set({ restoredClass: c }),
}));
