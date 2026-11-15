// Local prototype instrumentation. Never reads auth state or app user data.
const WebSocket = require('ws');
const [device, expression] = process.argv.slice(2);
(async () => {
  const targets = await (await fetch('http://127.0.0.1:8081/json/list')).json();
  const target = targets.find(entry =>
    `${entry.title} ${entry.deviceName}`.includes(device),
  );
  if (!target) throw new Error(`No Metro runtime for ${device}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl, {
    origin: 'http://localhost:8081',
  });
  let poll;
  let finished = false;
  const finish = error => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    clearInterval(poll);
    socket.close();
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  };
  const timeout = setTimeout(() => finish('Runtime request timed out'), 15000);
  const send = (id, code) =>
    socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression: code, returnByValue: true },
      }),
    );
  socket.on('open', () =>
    send(
      1,
      `globalThis.__skyvistColorProbe = null; Promise.resolve(${expression}).then(value => { globalThis.__skyvistColorProbe = JSON.stringify({value}); }, error => { globalThis.__skyvistColorProbe = JSON.stringify({error: String(error)}); }); true;`,
    ),
  );
  socket.on('message', data => {
    const response = JSON.parse(String(data));
    if (finished || !response.id) return;
    if (response.error || response.result?.exceptionDetails) {
      finish(
        JSON.stringify(response.error ?? response.result.exceptionDetails),
      );
      return;
    }
    if (response.id === 1) {
      poll = setInterval(() => send(2, 'globalThis.__skyvistColorProbe'), 100);
      return;
    }
    const value = response.result?.result?.value;
    if (typeof value !== 'string') return;
    const result = JSON.parse(value);
    if (result.error) finish(result.error);
    else {
      console.log(JSON.stringify(result.value ?? null, null, 2));
      finish();
    }
  });
  socket.on('error', error => finish(error.message));
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
