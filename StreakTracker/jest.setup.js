require('fake-indexeddb/auto');

if (typeof global.structuredClone !== 'function') {
  global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}
