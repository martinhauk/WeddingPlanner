import { content } from 'virtual:site-content';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { build } from './content/build.ts';
import { Site } from './site/Site.tsx';
import './site/site.css';
// After site.css: the instance's theme overrides the default custom properties.
import 'virtual:site-theme.css';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('index.html has no #root element');
}

createRoot(root).render(
  <StrictMode>
    <Site content={content} build={build} />
  </StrictMode>,
);
