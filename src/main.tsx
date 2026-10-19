import React from 'react';
import { createRoot } from 'react-dom/client';
import '@m3e/web/all';
import '@m3e/icons/rounded';
import App from './App';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
