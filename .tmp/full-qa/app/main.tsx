import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {Main} from '../../../packages/react/test/visual/components/SelectVirtual';

const app = <Main />;
const strict = new URLSearchParams(location.search).get('strict') === '1';
createRoot(document.getElementById('root')!).render(
  strict ? <React.StrictMode>{app}</React.StrictMode> : app,
);
