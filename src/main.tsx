import React from 'react';
import { createRoot } from 'react-dom/client';
import '@m3e/web/all';
import '@m3e/web/content-pane';
import '@m3e/icons/rounded';
import App from './App';

document.addEventListener('contextmenu', event => event.preventDefault());

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
