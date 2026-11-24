import { createRoot } from 'react-dom/client';
import './map.css';
import MapView, { type MapApi, type MapCtrl } from './MapView.tsx';

declare global { interface Window { mountMap: (el: HTMLElement, api: MapApi) => MapCtrl } }

// The existing UI (app.js) mounts the map in its container and gets a handle to focus a file or adjust the view.
window.mountMap = (el, api) => {
  const ctrl: MapCtrl = {};
  createRoot(el).render(<MapView api={api} ctrl={ctrl} />);
  return ctrl;
};
