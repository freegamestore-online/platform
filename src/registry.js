const fs = require('fs');
const path = require('path');

/** Load and validate the game registry. */
function loadRegistry(registryPath) {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  return registry.games;
}

module.exports = { loadRegistry };
