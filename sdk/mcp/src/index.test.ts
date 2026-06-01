/**
 * MCP server smoke tests — exercises the server via stdio JSON-RPC protocol.
 * Spawns the actual server process and verifies protocol compliance.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dir, 'index.ts');

function spawnServer(): ChildProcessWithoutNullStreams {
  return spawn('npx', ['tsx', SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function sendMessage(proc: ChildProcessWithoutNullStreams, msg: Record<string, unknown>): void {
  proc.stdin.write(JSON.stringify(msg) + '\n');
}

function readNextMessage(proc: ChildProcessWithoutNullStreams, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('MCP response timeout')), timeoutMs);

    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        clearTimeout(timer);
        proc.stdout.off('data', onData);
        try {
          resolve(JSON.parse(buf.slice(0, nl)));
        } catch {
          reject(new Error(`Invalid JSON: ${buf.slice(0, nl)}`));
        }
      }
    };

    proc.stdout.on('data', onData);
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

// ── Protocol smoke tests ──────────────────────────────────────────────────

describe('MCP server — initialize', () => {
  let proc: ChildProcessWithoutNullStreams;

  before(() => { proc = spawnServer(); });
  after(() => { proc.kill(); });

  it('responds to initialize with serverInfo', async () => {
    sendMessage(proc, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    }});

    const response = await readNextMessage(proc);
    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, 1);

    const result = response.result as Record<string, unknown>;
    assert.ok(result, 'result should be present');

    const serverInfo = result.serverInfo as Record<string, unknown>;
    assert.equal(serverInfo.name, 'letsfg');
    assert.ok(serverInfo.version, 'version should be set');

    const capabilities = result.capabilities as Record<string, unknown>;
    assert.ok(capabilities.tools !== undefined, 'should advertise tools capability');
  });
});

describe('MCP server — tools/list', () => {
  let proc: ChildProcessWithoutNullStreams;

  before(() => { proc = spawnServer(); });
  after(() => { proc.kill(); });

  it('returns expected tools', async () => {
    // Initialize first
    sendMessage(proc, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' },
    }});
    await readNextMessage(proc);

    // List tools
    sendMessage(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const response = await readNextMessage(proc);

    const result = response.result as Record<string, unknown>;
    const tools = result.tools as Array<{ name: string }>;
    assert.ok(Array.isArray(tools), 'tools should be an array');

    const toolNames = tools.map(t => t.name);
    const requiredTools = ['search_flights', 'resolve_location', 'unlock_flight_offer', 'book_flight'];
    for (const name of requiredTools) {
      assert.ok(toolNames.includes(name), `missing required tool: ${name}`);
    }
  });

  it('each tool has name, description, and inputSchema', async () => {
    sendMessage(proc, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' },
    }});
    await readNextMessage(proc);

    sendMessage(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const response = await readNextMessage(proc);

    const result = response.result as Record<string, unknown>;
    const tools = result.tools as Array<Record<string, unknown>>;

    for (const tool of tools) {
      assert.ok(typeof tool.name === 'string' && tool.name.length > 0, `tool.name missing on: ${JSON.stringify(tool)}`);
      assert.ok(typeof tool.description === 'string' && tool.description.length > 0, `tool.description missing on: ${tool.name}`);
      assert.ok(tool.inputSchema !== null && typeof tool.inputSchema === 'object', `tool.inputSchema missing on: ${tool.name}`);
    }
  });
});

describe('MCP server — resources/list', () => {
  let proc: ChildProcessWithoutNullStreams;

  before(() => { proc = spawnServer(); });
  after(() => { proc.kill(); });

  it('returns the guide resource', async () => {
    sendMessage(proc, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' },
    }});
    await readNextMessage(proc);

    sendMessage(proc, { jsonrpc: '2.0', id: 2, method: 'resources/list', params: {} });
    const response = await readNextMessage(proc);

    const result = response.result as Record<string, unknown>;
    const resources = result.resources as Array<{ uri: string }>;
    assert.ok(Array.isArray(resources), 'resources should be an array');

    const uris = resources.map(r => r.uri);
    assert.ok(uris.includes('letsfg://guide'), 'guide resource must be registered');
  });
});

describe('MCP server — unknown method', () => {
  let proc: ChildProcessWithoutNullStreams;

  before(() => { proc = spawnServer(); });
  after(() => { proc.kill(); });

  it('returns method-not-found error for unknown methods', async () => {
    sendMessage(proc, { jsonrpc: '2.0', id: 42, method: 'nonexistent/method', params: {} });
    const response = await readNextMessage(proc);

    assert.equal(response.id, 42);
    const error = response.error as Record<string, unknown>;
    assert.ok(error, 'error field should be present');
    assert.equal(error.code, -32601);
  });
});
