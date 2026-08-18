import { spawn } from 'node:child_process';
import readline from 'node:readline';

const PROTOCOL_VERSION = '2025-06-18';
const REQUIRED_TOOLS = Object.freeze(['headroom_compress', 'headroom_retrieve']);

function boundedMessage(error) {
  const code = typeof error?.code === 'string' ? error.code : 'unavailable';
  return `Headroom MCP ${code}`;
}
function parsedTextResult(result) {
  const text = (result?.content ?? [])
    .filter((entry) => entry?.type === 'text' && typeof entry.text === 'string')
    .map((entry) => entry.text)
    .join('\n');
  if (result?.isError) throw new Error('Headroom MCP tool error');
  let structured = result?.structuredContent;
  if (!structured && text) {
    try { structured = JSON.parse(text); } catch { /* text-only MCP result */ }
  }
  return { text, structured: structured && typeof structured === 'object' ? structured : {} };
}

function firstString(object, names) {
  for (const name of names) if (typeof object?.[name] === 'string') return object[name];
  return null;
}

export class HeadroomMcpClient {
  constructor({ command = 'headroom', args = ['mcp', 'serve'], timeoutMilliseconds = 5000, environment = process.env } = {}) {
    if (typeof command !== 'string' || !command.trim()) throw new Error('Headroom command is required');
    if (!Array.isArray(args) || args.some((entry) => typeof entry !== 'string')) throw new Error('Headroom args must be strings');
    if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 100 || timeoutMilliseconds > 120000) {
      throw new Error('Headroom timeout must be 100..120000 milliseconds');
    }
    this.command = command;
    this.args = [...args];
    this.timeoutMilliseconds = timeoutMilliseconds;
    this.environment = environment;
    this.child = null;
    this.reader = null;
    this.pending = new Map();
    this.nextId = 1;
    this.starting = null;
    this.tools = new Set();
  }

  async start() {
    if (this.child && !this.child.killed) return;
    if (this.starting) return this.starting;
    this.starting = this.#start();
    try { await this.starting; } finally { this.starting = null; }
  }

  async #start() {
    let child;
    try {
      child = spawn(this.command, this.args, {
        env: this.environment,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch (error) {
      throw new Error(boundedMessage(error));
    }
    this.child = child;
    this.reader = readline.createInterface({ input: child.stdout });
    this.reader.on('line', (line) => this.#receive(line));
    child.on('error', (error) => this.#failAll(new Error(boundedMessage(error))));
    child.on('exit', () => this.#failAll(new Error('Headroom MCP exited')));
    try {
      await this.#request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'helioterm', version: '0.4.1' },
      });
      this.#notify('notifications/initialized', {});
      const listed = await this.#request('tools/list', {});
      this.tools = new Set((listed?.tools ?? []).map((tool) => tool?.name).filter(Boolean));
      for (const name of REQUIRED_TOOLS) if (!this.tools.has(name)) throw new Error(`Headroom MCP missing ${name}`);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  #receive(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message?.id === undefined || message?.id === null) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(`Headroom MCP RPC ${message.error.code ?? 'error'}`));
    else pending.resolve(message.result);
  }

  #failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  #notify(method, params) {
    if (!this.child?.stdin?.writable) throw new Error('Headroom MCP unavailable');
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  #request(method, params) {
    if (!this.child?.stdin?.writable) return Promise.reject(new Error('Headroom MCP unavailable'));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Headroom MCP timeout'));
        this.close();
      }, this.timeoutMilliseconds);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(boundedMessage(error)));
      });
    });
  }

  async compress(content) {
    await this.start();
    const result = parsedTextResult(await this.#request('tools/call', {
      name: 'headroom_compress', arguments: { content },
    }));
    const compressed = firstString(result.structured, ['compressed', 'compressed_content', 'content', 'text']) ?? result.text;
    const hash = firstString(result.structured, ['hash', 'content_hash', 'id'])
      ?? /(?:^|\n)\s*(?:hash|content_hash)\s*[:=]\s*([A-Za-z0-9._-]{8,256})/iu.exec(result.text)?.[1]
      ?? null;
    if (!compressed) throw new Error('Headroom MCP returned no compressed content');
    return {
      content: compressed,
      hash,
      transforms: Array.isArray(result.structured.transforms) ? result.structured.transforms.map(String).slice(0, 16) : [],
      originalTokens: Number.isFinite(result.structured.original_tokens) ? result.structured.original_tokens : null,
      compressedTokens: Number.isFinite(result.structured.compressed_tokens) ? result.structured.compressed_tokens : null,
    };
  }

  async retrieve(hash, query = null) {
    await this.start();
    const result = parsedTextResult(await this.#request('tools/call', {
      name: 'headroom_retrieve', arguments: { hash, ...(query ? { query } : {}) },
    }));
    const content = firstString(result.structured, ['original', 'content', 'text', 'result']) ?? result.text;
    if (!content) throw new Error('Headroom MCP returned no retrieved content');
    return content;
  }

  async stats() {
    await this.start();
    if (!this.tools.has('headroom_stats')) return null;
    return parsedTextResult(await this.#request('tools/call', { name: 'headroom_stats', arguments: {} })).structured;
  }

  close() {
    const child = this.child;
    this.child = null;
    this.reader?.close();
    this.reader = null;
    this.#failAll(new Error('Headroom MCP closed'));
    if (!child) return;
    try { child.stdin?.end(); } catch { /* already closed */ }
    try { child.kill(); } catch { /* already exited */ }
  }
}
