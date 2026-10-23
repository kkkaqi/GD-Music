const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, ok } = require('./helpers/renderer.cjs');
test('临时封面失败不能永久缓存空结果', async () => {
  let calls = 0;
  const { a } = setup({ pic: async () => { if (++calls === 1) throw Error('temporary'); return ok({ url: 'https://example.test/cover.jpg' }); } });
  const track = { source: 'netease', pic_id: '123' };
  assert.equal(await a.coverUrl(track), '');
  assert.equal(await a.coverUrl(track), 'https://example.test/cover.jpg');
});
test('推荐搜索按音源隔离缓存', async () => {
  const { a } = setup({ search: async p => ok([{ id: p.source }]) });
  a.S.source = 'netease';
  assert.equal((await a.searchCurated('摇滚'))[0].id, 'netease');
  a.S.source = 'joox';
  assert.equal((await a.searchCurated('摇滚'))[0].id, 'joox');
});
