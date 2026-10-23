const {test}=require('node:test');
const assert=require('node:assert/strict');
const {setup,deferred,ok,track}=require('./helpers/renderer.cjs');

for(const failure of [false,true]) test(`返回搜索A后，迟到的搜索B${failure?'错误':'结果'}不能修改A或历史`,async()=>{
  const late=deferred();
  const {a}=setup({search:async p=>p.name==='A'?ok([{...track,id:'A'}]):late.promise});
  await a.runSearch('A');const request=a.runSearch('B');a.goBack();
  if(failure)late.reject(Error('B failed'));else late.resolve(ok([{...track,id:'B'}]));
  await request;
  assert.equal(a.ui.search.q,'A');assert.deepEqual(Array.from(a.ui.search.tracks,t=>t.id),['A']);
  assert.equal(a.ui.search.loading,false);assert.equal(a.toasts.length,0);
  assert.equal(a.ui.history[0].search.q,'A');
  assert.deepEqual(Array.from(a.ui.history[0].search.tracks,t=>t.id),['A']);
});

test('在途分页离开搜索页后不能追加到当前或历史搜索',async()=>{
  const late=deferred();
  const {a}=setup({search:async p=>p.pages===1?ok(Array.from({length:20},(_,i)=>({...track,id:String(i)}))):late.promise});
  await a.runSearch('A');const request=a.runSearch('A',{append:true});
  a.goDiscover();assert.equal(a.ui.search.loading,false);
  late.resolve(ok([{...track,id:'late'}]));await request;
  a.goBack();
  assert.equal(a.ui.search.tracks.length,20);assert.equal(a.ui.search.page,1);
  assert.equal(a.ui.search.loading,false);assert.equal(a.ui.search.done,false);
});

test('返回后可以重新搜索并正常前进到历史查询',async()=>{
  const late=deferred();let calls=0;
  const {a}=setup({search:async p=>p.name==='B'&&++calls===1?late.promise:ok([{...track,id:p.name}])});
  await a.runSearch('A');const pending=a.runSearch('B');a.goBack();
  late.resolve(ok([{...track,id:'late-B'}]));await pending;
  a.goForward();await a.runSearch('B');
  assert.equal(a.ui.search.q,'B');assert.deepEqual(Array.from(a.ui.search.tracks,t=>t.id),['B']);
  assert.equal(a.ui.search.loading,false);
});
