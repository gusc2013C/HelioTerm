import readline from 'node:readline';
import { createHash } from 'node:crypto';

const originals = new Map();
function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id == null) return;
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake-headroom', version: 'test' } } });
    return;
  }
  if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: [
      { name: 'headroom_compress', inputSchema: { type: 'object' } },
      { name: 'headroom_retrieve', inputSchema: { type: 'object' } },
      { name: 'headroom_stats', inputSchema: { type: 'object' } },
    ] } });
    return;
  }
  if (message.method === 'tools/call' && message.params.name === 'headroom_compress') {
    const content = String(message.params.arguments.content ?? '');
    const hash = createHash('sha256').update(content).digest('hex');
    originals.set(hash, content);
    send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'compressed by fixture' }], structuredContent: {
      compressed: `HEADROOM:${content.slice(0, 24)}`,
      hash,
      original_tokens: 100,
      compressed_tokens: 10,
      transforms: ['fixture'],
    } } });
    return;
  }
  if (message.method === 'tools/call' && message.params.name === 'headroom_retrieve') {
    const content = originals.get(message.params.arguments.hash) ?? '';
    const query = message.params.arguments.query;
    const result = query ? content.split(/\r?\n/u).filter((entry) => entry.includes(query)).join('\n') : content;
    send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: result }], structuredContent: { content: result } } });
    return;
  }
  if (message.method === 'tools/call' && message.params.name === 'headroom_stats') {
    send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: '{}' }], structuredContent: { compressions: originals.size } } });
    return;
  }
  send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'not found' } });
});
