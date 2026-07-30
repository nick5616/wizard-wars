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
