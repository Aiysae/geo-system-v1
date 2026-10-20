const test = require('node:test');
const assert = require('node:assert/strict');
const meipian = require('../platform-adapters/meipian.cjs');

test('Meipian identity requires the authenticated page and an online account id', () => {
  assert.equal(meipian.normalizeIdentity({ loggedIn: false }).code, 'AUTH');
  assert.equal(meipian.normalizeIdentity({ loggedIn: true }).code, 'IDENTITY_UNVERIFIED');
  assert.deepEqual(meipian.normalizeIdentity({ loggedIn: true, id: 123, name: '作者' }), {
    ok: true,
    identity: { id: '123', name: '作者' },
  });
});

test('Meipian draft route remains closed until a durable draft is verified', async () => {
  assert.deepEqual(meipian.draftTypes, []);
  const result = await meipian.saveDraft({ article: { title: '测试草稿' } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DRAFT_UNVERIFIED');
});
