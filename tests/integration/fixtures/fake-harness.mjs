import http from 'node:http';

const args = process.argv.slice(2);

function optionValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

const host = optionValue('--host');
const port = Number(optionValue('--port'));
const validCommand = args.includes('web') && args.includes('--no-open');

if (
  !validCommand ||
  host === undefined ||
  !Number.isInteger(port) ||
  port <= 0 ||
  port > 65_535
) {
  process.exitCode = 2;
} else {
  const server = http.createServer((request, response) => {
    const url = request.url ?? '/';
    if (url !== '/' && url !== '/health') {
      response.writeHead(404);
      response.end();
      return;
    }

    const body = url === '/health' ? JSON.stringify({ status: 'ok' }) : 'DeepSeek Harness';
    response.writeHead(200, {
      'content-type': url === '/health' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'content-length': Buffer.byteLength(body, 'utf8'),
    });
    response.end(body);
  });

  let stopping = false;
  process.on('SIGTERM', () => {
    if (stopping) return;
    stopping = true;
    server.close(() => process.exit(0));
  });

  server.on('error', () => {
    process.exitCode = 3;
  });
  server.listen(port, host, () => {
    console.log('READY');
    if (args.includes('--crash')) {
      setImmediate(() => process.exit(23));
    }
  });
}
