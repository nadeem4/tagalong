// A tiny MCP server for the e2e suite: one write tool, add_note, which appends its text to
// the file named by the first argument. Speaks MCP over stdio by hand (newline-delimited
// JSON-RPC) so it needs no packages, and touches nothing but that one file.
import { appendFileSync } from 'node:fs';
import { argv, stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';

const file = argv[2];

const TOOLS = [
  {
    name: 'add_note',
    description: 'Adds a note.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  },
];

function reply(id, result) {
  stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function answer(method, params) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'notes', version: '1.0.0' },
      };
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call':
      appendFileSync(file, `${String(params.arguments?.text ?? '')}\n`);
      return { content: [{ type: 'text', text: 'Saved the note.' }] };
    default:
      return {};
  }
}

createInterface({ input: stdin }).on('line', (line) => {
  if (line.trim() === '') return;
  const message = JSON.parse(line);
  // Notifications carry no id and get no answer.
  if (message.id === undefined) return;
  reply(message.id, answer(message.method, message.params ?? {}));
});
