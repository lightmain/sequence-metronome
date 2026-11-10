import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
import './v2.css';
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
