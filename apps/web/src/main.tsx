import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { site } from './content/content.ts';
import './styles.css';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('index.html has no #root element');
}

createRoot(root).render(
  <StrictMode>
    <App site={site} />
  </StrictMode>,
);
