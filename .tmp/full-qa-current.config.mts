import path from 'node:path';
import config from '../packages/react/vite.config.mts';
const repo = path.resolve('../..');
export default {
  ...config,
  cacheDir: path.join(repo, '.tmp/full-qa/vite-current'),
  root: path.join(repo, '.tmp/full-qa/app'),
  server: {host: '127.0.0.1', port: 1246, fs: {allow: [repo]}},
  resolve: {
    alias: [
      {find: /^@floating-ui\/react$/, replacement: path.join(repo, 'packages/react/src/index.ts')},
      {find: /^react(?=\/|$)/, replacement: path.join(repo, 'packages/react/node_modules/react')},
      {find: /^react-dom(?=\/|$)/, replacement: path.join(repo, 'packages/react/node_modules/react-dom')},
      {find: /^react-dom\/client$/, replacement: path.join(repo, 'packages/react/node_modules/react-dom/client.js')},
    ],
    dedupe: ['react', 'react-dom'],
  },
  test: {...config.test, server: {deps: {inline: [/@floating-ui\//]}}},
};