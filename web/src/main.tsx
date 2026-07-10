import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Adopted DS token layer (REQ-F001-017), imported first so every screen resolves tokens via var().
import './design-system/tokens/tokens.css';
// Bridge: OS-driven light-theme selection dropped by verbatim token adoption (REQ-F001-052).
import './bridge/prefers-color-scheme.css';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
