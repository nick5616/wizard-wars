import { createRoot } from 'react-dom/client';
import App from './App';
import { audioManager } from './audio/AudioManager';

// Browsers require a user gesture before any audio can play -- unlock once and forget.
const unlockAudioOnce = () => {
  audioManager.unlock();
  window.removeEventListener('pointerdown', unlockAudioOnce);
  window.removeEventListener('keydown', unlockAudioOnce);
};
window.addEventListener('pointerdown', unlockAudioOnce);
window.addEventListener('keydown', unlockAudioOnce);

createRoot(document.getElementById('root')!).render(<App />);

// Dev-only handles so automated playtests (scripts/playtest/browser-playtest.mjs)
// can read store state and drive flows without scraping the DOM.
if (import.meta.env.DEV) {
  void Promise.all([import('./stores/gameStore'), import('./stores/networkStore')]).then(([g, n]) => {
    (window as unknown as Record<string, unknown>).useGameStore = g.useGameStore;
    (window as unknown as Record<string, unknown>).useNetworkStore = n.useNetworkStore;
    (window as unknown as Record<string, unknown>).__audio = audioManager;
  });
}
