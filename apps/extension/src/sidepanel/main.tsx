import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortBridge } from '../port-bridge';
import { PORT_NAME } from '../port-messages';
import { SidePanelApp } from './app';
import './sidepanel.css';

/** The side panel's Chrome glue: one port to the service worker, and the options page. */
const bridge = createPortBridge(chrome.runtime.connect({ name: PORT_NAME }));

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <SidePanelApp bridge={bridge} openOptions={() => void chrome.runtime.openOptionsPage()} />
    </StrictMode>,
  );
}
