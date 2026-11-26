import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { build } from '../content/build.ts';
import { AdminApp } from './AdminApp.tsx';
import { createAdminApi } from './api.ts';
import './admin.css';

// Entry of the admin area (admin/index.html → dist/admin/index.html). SWA serves it to role `admin`
// only; public pages never import anything from src/admin/.
const root = document.getElementById('root');
if (root === null) {
  throw new Error('admin/index.html has no #root element');
}

createRoot(root).render(
  <StrictMode>
    <AdminApp api={createAdminApi()} timeZone={build.rsvpTimeZone} />
  </StrictMode>,
);
