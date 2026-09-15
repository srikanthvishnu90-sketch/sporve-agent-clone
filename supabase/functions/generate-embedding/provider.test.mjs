import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Decision D4: OpenAI embeddings, one provider, one key. External-dependency
// checklist item 8 retired the EMBEDDING_PROVIDER switch and the Voyage stub;
// this keeps them retired, and keeps credential literals out of scripts/.
const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

test('generate-embedding has exactly one provider and it is OpenAI', () => {
  assert.ok(/text-embedding-3-small/.test(src), 'OpenAI model named');
  assert.ok(!/EMBEDDING_PROVIDER\s*=\s*\(?Deno\.env/.test(src), 'no env-selected provider');
  assert.ok(!/voyage|VOYAGE_API_KEY|cohere|gemini/i.test(src), 'no second provider anywhere in the function');
  assert.ok(/const EMBED_DIM = 1536/.test(src), 'the 1536-d column contract is still asserted');
});

test('no script in scripts/ carries a password or email literal as a default', () => {
  const dir = new URL('../../../scripts/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
    const s = readFileSync(new URL(f, dir), 'utf8');
    assert.ok(!/process\.env\.\w*(PW|PASSWORD)\w*\s*\|\|\s*["'`][^"'`]+["'`]/.test(s), `${f} defaults a password literal`);
    assert.ok(!/process\.env\.\w*EMAIL\w*\s*\|\|\s*["'`][^"'`]*@[^"'`]+["'`]/.test(s), `${f} defaults an email literal`);
  }
});
