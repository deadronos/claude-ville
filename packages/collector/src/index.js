// packages/collector/src/index.js
const { Collector } = require('./collector.js');
const { adapters } = require('./adapters/index.js');
module.exports = { Collector, adapters };
