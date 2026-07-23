import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('./pages.yml', import.meta.url), 'utf8');

test('pages workflow uses make targets instead of manually assembling the site directory', () => {
  assert.ok(workflow.includes('make test build'));
  assert.ok(!workflow.includes('mkdir -p site/'));
  assert.ok(!workflow.includes('cp Counter/* site/Counter'));
  assert.ok(!workflow.includes('cp -r packing/src/packing/* site/Packing/'));
});
