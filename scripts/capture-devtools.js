'use strict';

const fs = require('node:fs/promises');

async function devtools(method, params = {}) {
  const targets = await fetch('http://127.0.0.1:9222/json').then((response) => response.json());
  const target = targets.find((item) => item.type === 'page' && /Wordloom/i.test(item.title)) || targets.find((item) => item.type === 'page');
  if (!target) throw new Error('No Electron page target found.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const id = 1;
  socket.send(JSON.stringify({ id, method, params }));
  const response = await new Promise((resolve, reject) => {
    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id === id) resolve(payload);
    });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.close();
  if (response.error) throw new Error(response.error.message);
  return response.result;
}

async function main() {
  if (process.argv.includes('--test-api')) {
    const response = await devtools('Runtime.evaluate', { expression: 'window.wordloom.testApi({})', awaitPromise: true, returnByValue: true });
    console.log(JSON.stringify(response.result?.value));
    return;
  }
  const fullFlowArgument = process.argv.find((argument) => argument.startsWith('--full-flow='));
  if (fullFlowArgument) {
    const word = fullFlowArgument.slice('--full-flow='.length);
    const expression = `(async () => {
      const lookup = await window.wordloom.lookup(${JSON.stringify(word)}, 'full-flow-check');
      if (!lookup.ok) return { ok: false, phase: 'lookup', error: lookup.error };
      const result = lookup.result;
      const add = await window.wordloom.addToNote(lookup.resultId);
      return {
        ok: add.ok,
        phase: add.ok ? 'complete' : 'write',
        dictionary: {
          word: result.query,
          levels: result.levels,
          entries: result.entries.length,
          senses: result.entries.reduce((count, entry) => count + entry.senses.length, 0),
          source: result.source.name
        },
        ai: {
          warning: lookup.aiWarning,
          hasSummary: Boolean(result.enrichment?.summaryZh),
          collocations: result.enrichment?.collocations?.length || 0,
          hasIeltsUsage: Boolean(result.enrichment?.ieltsUsage)
        },
        write: add
      };
    })()`;
    const response = await devtools('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    console.log(JSON.stringify(response.result?.value));
    return;
  }
  if (process.argv.includes('--bootstrap')) {
    const response = await devtools('Runtime.evaluate', { expression: 'window.wordloom.bootstrap()', awaitPromise: true, returnByValue: true });
    console.log(JSON.stringify(response.result?.value));
    return;
  }
  const lookupArgument = process.argv.find((argument) => argument.startsWith('--lookup='));
  if (lookupArgument) {
    const word = lookupArgument.slice('--lookup='.length);
    const expression = `window.wordloom.lookup(${JSON.stringify(word)}, 'devtools-check')`;
    const response = await devtools('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    console.log(JSON.stringify(response.result?.value));
    return;
  }
  if (process.argv.includes('--close')) {
    await devtools('Runtime.evaluate', { expression: "window.wordloom.windowAction('close')" });
    return;
  }
  if (process.argv.includes('--settings')) {
    await devtools('Runtime.evaluate', { expression: "document.querySelector('[data-view=settings]').click()" });
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const output = process.argv.find((argument) => argument.endsWith('.png')) || '/tmp/wordloom-ui.png';
  const result = await devtools('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(output, Buffer.from(result.data, 'base64'));
  console.log(output);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
