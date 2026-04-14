'use strict';

/**
 * Phusion Passenger / some Plesk Node setups load the app with `require()`.
 * This file is real CommonJS; it dynamically imports the ESM bundle in dist/main.js.
 * Set the application startup file to: passenger.cjs
 */

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const mainUrl = pathToFileURL(path.join(__dirname, 'dist', 'main.js')).href;

import(mainUrl).catch((err) => {
  console.error(err);
  process.exit(1);
});
