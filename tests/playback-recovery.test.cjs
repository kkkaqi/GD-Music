const {test}=require('node:test');
const assert=require('node:assert/strict');
const {setup,deferred,ok,track}=require('./helpers/renderer.cjs');
const tick=()=>new Promise(setImmediate);

test('媒体失败先刷新同源链接并保留进度，成功后不搜索其他源',async()=>{
  const calls=[];let searches=0;
  const {a}=setup({url:async p=>{calls.push(p);return ok({url:`https://example.test/${p.refresh?'fresh':'old'}.mp3`});},
    search:async()=>{searches++;return ok([]);}});
  a.setQueue([track,{...track,id:'2'}],0,false);await a.loadAndPlay();
  a.audio.emit('loadedmetadata');a.audio.currentTime=73;
  a.audio.emit('error');await tick();a.audio.emit('loadedmetadata');
  assert.equal(calls.length,2);assert.equal(calls[1].refresh,true);
  assert.match(a.audio.src,/fresh/);assert.equal(a.audio.currentTime,73);
  assert.equal(a.S.queueIndex,0);assert.equal(searches,0);
});

test('刷新链接仍加载失败时自动匹配同曲其他源，不采用异名歌曲',async()=>{
  const calls=[],searches=[];
  const {a}=setup({url:async p=>{calls.push(p);return ok({url:`https://example.test/${p.source}.mp3`});},
    search:async p=>{searches.push(p.source);return ok([{...track,source:p.source,name:'不是这首歌'},{...track,source:p.source}]);}});
  a.setQueue([track],0,false);await a.loadAndPlay();
  const play=a.audio.play.bind(a.audio);
  a.audio.play=()=>{
    if(a.audio.src.includes('netease')) {a.audio.emit('error');return Promise.reject(Error('decode failure'));}
    return play();
  };
  a.audio.emit('error');await tick();
  assert.equal(a.currentTrack.value.source,'tencent');assert.equal(a.currentTrack.value.name,track.name);
  assert.equal(a.audio.paused,false);assert.equal(calls.filter(p=>p.source==='netease'&&p.refresh).length,1);
  assert.deepEqual(searches,['tencent']);
});

test('暂停状态的媒体错误恢复后仍暂停，失败也不自动跳歌',async()=>{
  let broken=false;
  const {a,fire,timers}=setup({url:async p=>{
    if(broken&&p.refresh)throw Error('unavailable');
    return ok({url:'https://example.test/song.mp3'});
  }});
  a.setQueue([track,{...track,id:'2'}],0,false);await a.loadAndPlay(false);
  a.audio.emit('error');await tick();
  assert.equal(a.audio.paused,true);assert.equal(a.audio.plays,0);
  broken=true;a.audio.emit('error');await tick();fire(900);fire(1500);await tick();
  assert.equal(a.S.queueIndex,0);assert.equal(a.audio.paused,true);
  assert.ok(![...timers.values()].some(timer=>[900,1500].includes(timer.ms)));
});

test('换源持续解码失败时每个来源有界尝试，最终才跳过',async()=>{
  const searches=[];const calls=[];
  const {a,fire}=setup({url:async p=>{calls.push(p);return ok({url:`https://example.test/${p.source}.mp3`});},
    search:async p=>{searches.push(p.source);return ok([{...track,source:p.source}]);}});
  a.setQueue([track,{...track,id:'2'}],0,false);await a.loadAndPlay();
  a.audio.play=()=>{a.audio.emit('error');return Promise.reject(Error('decode failure'));};
  a.audio.emit('error');await tick();
  assert.ok(searches.length>0);assert.equal(new Set(searches).size,searches.length);
  assert.ok(calls.length<=a.SOURCES.length*2);
  assert.equal(a.S.queueIndex,0);fire(900);assert.equal(a.S.queueIndex,1);
});

test('用户新选歌曲后，迟到的媒体恢复结果不能覆盖新歌',async()=>{
  const fresh=deferred();
  const {a}=setup({url:async p=>p.refresh?fresh.promise:ok({url:`https://example.test/${p.id}.mp3`})});
  a.setQueue([track,{...track,id:'2'}],0,false);await a.loadAndPlay();
  a.audio.emit('error');await tick();a.S.queueIndex=1;await a.loadAndPlay();
  fresh.resolve(ok({url:'https://example.test/stale.mp3'}));await tick();
  assert.match(a.audio.src,/\/2.mp3$/);assert.equal(a.S.queueIndex,1);
});

test('用户在媒体恢复过程中暂停，迟到的地址不会自动播放',async()=>{
  const fresh=deferred();
  const {a}=setup({url:async p=>p.refresh?fresh.promise:ok({url:'https://example.test/old.mp3'})});
  a.setQueue([track],0,false);await a.loadAndPlay();
  a.audio.emit('error');await tick();a.togglePlay();
  fresh.resolve(ok({url:'https://example.test/fresh.mp3'}));await tick();
  assert.equal(a.audio.paused,true);assert.match(a.audio.src,/fresh/);
});

test('首次恢复播放使用保存的73秒，新选歌曲仍从零开始',async()=>{
  const {a}=setup();a.setQueue([track],0,false);a.S.lastTime=73;a.player.position=73;
  a.togglePlay();await tick();a.audio.emit('loadedmetadata');
  assert.equal(a.audio.currentTime,73);assert.equal(a.S.lastTime,73);
  a.setQueue([{...track,id:'2'}],0,true);await tick();a.audio.emit('loadedmetadata');
  assert.equal(a.audio.currentTime,0);assert.equal(a.S.lastTime,0);
});

test('恢复期间切换音质保留播放意图，旧恢复结果不能覆盖新音质',async()=>{
  const fresh=deferred();
  const {a}=setup({url:async p=>p.refresh?fresh.promise:ok({url:`https://example.test/${p.br}.mp3`})});
  a.setQueue([track],0,false);await a.loadAndPlay();a.audio.emit('loadedmetadata');a.audio.currentTime=42;
  a.audio.emit('error');await tick();await a.setQuality('740');a.audio.emit('loadedmetadata');
  fresh.resolve(ok({url:'https://example.test/stale.mp3'}));await tick();
  assert.match(a.audio.src,/740/);assert.equal(a.audio.paused,false);assert.equal(a.audio.currentTime,42);
});
