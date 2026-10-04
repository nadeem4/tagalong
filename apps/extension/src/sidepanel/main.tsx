import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/** The side panel. Task 65 replaces this placeholder with the crew. */
function SidePanel() {
  return <p>Tagalong</p>;
}

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <SidePanel />
    </StrictMode>,
  );
}
