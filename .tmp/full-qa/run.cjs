const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {chromium, firefox, webkit} = require('@playwright/test');

const output = __dirname;
const headless = process.env.FULL_QA_HEADLESS !== 'false';
fs.mkdirSync(path.join(output, 'screenshots'), {recursive: true});
const engines = [
  ['chrome', chromium, process.env.FULL_QA_CHROME_PATH
    ? {executablePath: process.env.FULL_QA_CHROME_PATH}
    : {channel: 'chrome'}],
  ['edge', chromium, {channel: 'msedge', args: ['--headless=new']}],
  ['chromium', chromium, {}],
  ['firefox', firefox, {}],
  ['webkit', webkit, {}],
].filter(([name]) => (!process.env.FULL_QA_ENGINE || name === process.env.FULL_QA_ENGINE)
  && (!process.env.FULL_QA_ENGINES || process.env.FULL_QA_ENGINES.split(',').includes(name)));
const expectedEngines = [...new Set(process.env.FULL_QA_ENGINE
  ? [process.env.FULL_QA_ENGINE]
  : process.env.FULL_QA_ENGINES
    ? process.env.FULL_QA_ENGINES.split(',').map(name => name.trim()).filter(Boolean)
    : engines.map(([name]) => name))];
const portBase = Number(process.env.FULL_QA_PORT_BASE || 1245);
const versions = [['legacy-0.24.8', portBase], ['current-0.27.20', portBase + 1]];
const report = {
  startedAt: new Date().toISOString(),
  host: {platform: os.platform(), release: os.release(), arch: os.arch()},
  playwright: require('@playwright/test/package.json').version,
  headless,
  expectedEngines,
  chromeExecutable: process.env.FULL_QA_CHROME_PATH || 'channel:chrome',
  requiredEnvironment: process.platform === 'darwin'
    ? 'Real macOS host; verify actual Chrome version is 155'
    : 'Real macOS + Chrome 155: unavailable, not accepted',
  results: [],
};
function save() {
  fs.writeFileSync(path.join(output, process.env.FULL_QA_OUTPUT || 'results.json'), JSON.stringify(report, null, 2));
}
async function settle(page) {
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function snapshot(page) {
  return page.evaluate(() => {
    const reference = document.querySelector('[role=combobox]');
    const options = [...document.querySelectorAll('[role=option]')];
    const banana = options.find(item => item.textContent === 'Banana');
    const activeId = reference?.getAttribute('aria-activedescendant') || null;
    const target = activeId ? document.getElementById(activeId) : null;
    const focused = document.activeElement;
    return {
      expanded: reference?.getAttribute('aria-expanded') === 'true',
      activeId,
      bananaId: banana?.id || null,
      targetLabel: target?.textContent || null,
      validTarget: !!target && options.includes(target),
      matchesBanana: !!banana && target === banana,
      focus: focused === reference ? 'reference' : focused?.getAttribute('role') || focused?.tagName || null,
      focusedLabel: focused?.textContent?.slice(0, 100) || null,
    };
  });
}
async function selectBanana(page, url) {
  await page.goto(url);
  await page.getByRole('combobox').click();
  await page.getByRole('option', {name: 'Banana', exact: true}).click();
  await settle(page);
  return snapshot(page);
}

(async () => {
  for (const [engine, browserType, options] of engines) {
    let browser;
    try {
      browser = await browserType.launch({headless, ...options});
      for (const [version, port] of versions) {
        for (const strict of [false, true]) {
          const page = await browser.newPage({viewport: {width: 1280, height: 720}});
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          const row = {engine, browserVersion: browser.version(), version, strict, errors};
          const url = `http://127.0.0.1:${port}/?strict=${strict ? 1 : 0}`;
          try {
            row.userAgent = await page.evaluate(() => navigator.userAgent);
            row.afterSelection = await selectBanana(page, url);
            await page.keyboard.press('Tab');
            await settle(page);
            row.afterRawTab = await snapshot(page);
            await page.keyboard.press('Enter');
            await settle(page);
            row.rawFlow = await snapshot(page);
            row.rawOutcome = !row.rawFlow.expanded ? 'not-reopened' : row.rawFlow.matchesBanana ? 'id-match' : 'id-mismatch';

            // A separate keyboard-return scenario, never mixed with the raw Issue steps.
            await selectBanana(page, url);
            await page.keyboard.press('Tab');
            await settle(page);
            if ((await snapshot(page)).focus !== 'reference') {
              await page.keyboard.press('Shift+Tab');
              await settle(page);
              row.returnedWithShiftTab = true;
            }
            row.beforeKeyboardReopen = await snapshot(page);
            if (row.beforeKeyboardReopen.focus !== 'reference') {
              throw new Error('Keyboard return did not reach reference; no programmatic focus was used');
            }
            await page.keyboard.press('Enter');
            await settle(page);
            row.keyboardReopen = await snapshot(page);
            await page.screenshot({path: path.join(output, 'screenshots', `${engine}-${version}-${strict ? 'strict' : 'plain'}.png`)});

            await page.keyboard.press('ArrowUp');
            await settle(page);
            row.arrowUp = await snapshot(page);
            await page.keyboard.press('ArrowDown');
            await settle(page);
            row.arrowDown = await snapshot(page);

            row.pointerReopens = [];
            await page.keyboard.press('Escape');
            await settle(page);
            for (let cycle = 0; cycle < 3; cycle++) {
              await page.getByRole('combobox').click();
              await settle(page);
              row.pointerReopens.push(await snapshot(page));
              await page.keyboard.press('Escape');
              await settle(page);
            }
            row.functionalChecks = {
              keyboardReopen: row.keyboardReopen.expanded && row.keyboardReopen.matchesBanana,
              arrowUp: row.arrowUp.validTarget && row.arrowUp.targetLabel === 'Watermelon',
              arrowDown: row.arrowDown.validTarget && row.arrowDown.targetLabel === 'Banana',
              pointerReopenThreeTimes: row.pointerReopens.every(item => item.expanded && item.matchesBanana),
              noPageErrors: errors.length === 0,
            };
            row.functionalStatus = Object.values(row.functionalChecks).every(Boolean) ? 'pass' : 'fail';
          } catch (error) {
            row.infrastructureError = error.stack || String(error);
          } finally {
            report.results.push(row);
            save();
            console.log(JSON.stringify({engine, browserVersion: row.browserVersion, version, strict, raw: row.rawOutcome, functionality: row.functionalStatus, error: row.infrastructureError?.split('\n')[0]}));
            await page.close();
          }
        }
      }
    } catch (error) {
      report.results.push({engine, infrastructureError: error.stack || String(error)});
      save();
      console.log(`${engine}: unavailable: ${error.message.split('\n')[0]}`);
    } finally {
      await browser?.close();
    }
  }
  report.completedAt = new Date().toISOString();
  report.blockedEngines = report.results.filter(row => !row.version && row.infrastructureError).map(row => row.engine);
  report.infrastructureFailures = report.results.filter(row => row.infrastructureError);
  report.matrixFailures = [];
  if (!expectedEngines.length || !engines.length) {
    report.matrixFailures.push({error: 'No requested browser engines are available in the configured matrix'});
  }
  for (const engine of expectedEngines) {
    for (const [version] of versions) {
      for (const strict of [false, true]) {
        const rows = report.results.filter(row => row.engine === engine && row.version === version && row.strict === strict);
        if (rows.length !== 1 || rows[0].infrastructureError) {
          report.matrixFailures.push({engine, version, strict, count: rows.length, error: rows[0]?.infrastructureError});
        }
      }
    }
  }
  report.legacyBaselineFailures = report.results.filter(row => row.version === 'legacy-0.24.8'
    && !(row.keyboardReopen?.expanded && row.keyboardReopen.activeId && row.keyboardReopen.bananaId
      && row.keyboardReopen.activeId !== row.keyboardReopen.bananaId && !row.errors.length));
  report.currentFailures = report.results.filter(row => row.version?.startsWith('current') && row.functionalStatus !== 'pass');
  const requiredMajor = process.env.FULL_QA_REQUIRE_CHROME_MAJOR || (process.platform === 'darwin' ? '155' : null);
  const chromeRows = report.results.filter(row => row.engine === 'chrome' && row.version);
  report.chromeVersionMismatch = requiredMajor
    ? !chromeRows.length || chromeRows.some(row => row.browserVersion?.split('.')[0] !== requiredMajor)
    : false;
  const macChromeRows = chromeRows.filter(row => row.version.startsWith('current'));
  report.macRawFlowNotAccepted = process.platform === 'darwin'
    && (!macChromeRows.length || macChromeRows.some(row => row.rawOutcome !== 'id-match'));
  report.jobAccepted = !report.matrixFailures.length && !report.infrastructureFailures.length
    && !report.legacyBaselineFailures.length && !report.currentFailures.length
    && !report.chromeVersionMismatch && !report.macRawFlowNotAccepted;
  save();
  console.log(JSON.stringify({
    summary: true,
    host: report.host,
    jobAccepted: report.jobAccepted,
    matrixFailures: report.matrixFailures.length,
    infrastructureFailures: report.infrastructureFailures.length,
    legacyBaselineFailures: report.legacyBaselineFailures.length,
    currentFailures: report.currentFailures.length,
    chromeVersionMismatch: report.chromeVersionMismatch,
    macRawFlowNotAccepted: report.macRawFlowNotAccepted,
  }));
  if (!report.jobAccepted) process.exitCode = 1;
})().catch(error => {save(); console.error(error); process.exitCode = 1;});
