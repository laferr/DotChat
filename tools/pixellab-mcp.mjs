import fs from 'node:fs';

// Token is supplied by the caller, never stored with generated assets.
const token = process.env.PIXELLAB_TOKEN;
if (!token) throw new Error('PIXELLAB_TOKEN is required');
let session;
let id = 0;
async function rpc(method, params, notification = false) {
  const response = await fetch('https://api.pixellab.ai/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(session ? { 'Mcp-Session-Id': session } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: ++id }), method, params }),
  });
  session = response.headers.get('mcp-session-id') ?? session;
  const body = await response.text();
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${body.slice(0, 1000)}`);
  if (!body) return;
  const messages = body.startsWith('event:') || body.startsWith('data:')
    ? body.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)))
    : [JSON.parse(body)];
  const message = messages.find(message => message.id === id) ?? messages.at(-1);
  if (message?.error) throw new Error(JSON.stringify(message.error));
  return message?.result;
}
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dotchat-assets', version: '1.0.0' } });
await rpc('notifications/initialized', {}, true);
const [name, input, output] = process.argv.slice(2);
const result = name === 'list' ? await rpc('tools/list', {})
  : await rpc('tools/call', { name, arguments: JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, '')) });
if (output) fs.writeFileSync(output, JSON.stringify(result, null, 2));
else console.log(JSON.stringify(result, null, 2));
