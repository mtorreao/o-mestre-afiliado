/**
 * Helper de teste — carrega log-sink-pure.js num contexto CLASSIC
 * (igual WorkerGlobalScope faz via importScripts) e expõe as funções
 * no escopo do teste. Não usa `import`/`export` porque o arquivo
 * do pure é classic por design (carregado pelo manifest da extensão).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'log-sink-pure.js'),
  'utf8',
);

const sandbox = { console };
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox);

// Re-exporta para o escopo CommonJS do teste
module.exports = sandbox.globalThis.extLogSinkPure;