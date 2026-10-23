const {test}=require('node:test');
const assert=require('node:assert/strict');
const {gestureBounds}=require('../src/main/window-geometry');
const bounds={x:100,y:80,width:1200,height:800};
const minimum=[1000,640];

test('空白拖动只移动位置，不改变窗口尺寸',()=>{
 assert.deepEqual(gestureBounds(bounds,'move','',-140,30,minimum),{x:-40,y:110,width:1200,height:800});
});
for(const [edge,expected] of Object.entries({
 n:{x:100,y:110,width:1200,height:770},s:{x:100,y:80,width:1200,height:830},
 w:{x:120,y:80,width:1180,height:800},e:{x:100,y:80,width:1220,height:800},
 nw:{x:120,y:110,width:1180,height:770},ne:{x:100,y:110,width:1220,height:770},
 sw:{x:120,y:80,width:1180,height:830},se:{x:100,y:80,width:1220,height:830},
}))test(`${edge}边缘拖拽按方向调整尺寸，保持对侧边缘固定`,()=>{
 assert.deepEqual(gestureBounds(bounds,'resize',edge,20,30,minimum),expected);
});
test('左上角缩到最小尺寸时不继续漂移，也不越过最小尺寸',()=>{
 assert.deepEqual(gestureBounds(bounds,'resize','nw',999,999,minimum),{x:300,y:240,width:1000,height:640});
 assert.deepEqual(gestureBounds(bounds,'resize','se',-999,-999,minimum),{x:100,y:80,width:1000,height:640});
});
test('无效边缘和异常坐标不能改变窗口',()=>{
 assert.equal(gestureBounds(bounds,'resize','invalid',1,1,minimum),null);
 assert.equal(gestureBounds(bounds,'move','',NaN,1,minimum),null);
});
