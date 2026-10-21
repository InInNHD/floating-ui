const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {stripVTControlCharacters} = require('node:util');
const repo = path.resolve(__dirname, '../..');
const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const processes = [];
const files = [];
const portBase = Number(process.env.FULL_QA_PORT_BASE || 1245);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  try {
    for (const [variant, port] of [['legacy', portBase], ['current', portBase + 1]]) {
      const log = fs.openSync(path.join(__dirname, `server-${variant}.log`), 'w');
      files.push(log);
      const child = spawn(process.execPath, [vite, '--config', path.join(repo, `.tmp/full-qa-${variant}.config.mts`), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
        cwd: path.join(repo, 'packages/react'),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let spawnError;
      let serverOutput = '';
      child.on('error', error => {spawnError = error;});
      const ended = new Promise(resolve => child.once('close', resolve));
      processes.push({child, ended});
      const record = chunk => {
        fs.writeSync(log, chunk);
        serverOutput = (serverOutput + chunk.toString()).slice(-8192);
      };
      child.stdout.on('data', record);
      child.stderr.on('data', record);
      const url = `http://127.0.0.1:${port}/`;
      const deadline = Date.now() + 60000;
      while (true) {
        if (spawnError) throw spawnError;
        if (Date.now() > deadline || child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`${variant} test server did not become ready; see server-${variant}.log\n${stripVTControlCharacters(serverOutput)}`);
        }
        const plainOutput = stripVTControlCharacters(serverOutput);
        if (/\bready in\b/.test(plainOutput) && plainOutput.includes(url)) {
          try {
            const response = await fetch(url, {signal: AbortSignal.timeout(2000)});
            if (response.ok && child.exitCode === null && child.signalCode === null && !spawnError) break;
          } catch {}
        }
        await pause(250);
      }
    }
    const runner = spawn(process.execPath, [path.join(__dirname, 'run.cjs')], {cwd: repo, stdio: 'inherit', windowsHide: true});
    process.exitCode = await new Promise((resolve, reject) => {
      runner.on('error', reject);
      runner.on('exit', code => resolve(code ?? 1));
    });
  } finally {
    await Promise.all(processes.map(async ({child, ended}) => {
      if (child.pid && child.exitCode === null && child.signalCode === null) child.kill();
      await ended;
    }));
    for (const file of files) fs.closeSync(file);
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
