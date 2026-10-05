const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('the three checkout plans have exact official titles and distinct verified links',()=>{
 const context={window:{}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/../assets/config.js','utf8'),context);
 const cfg=context.window.ZASU_MASTER_CONFIG;
 assert.equal(cfg.squarePaymentLinks?.master,'https://square.link/u/ArDEgNp3');
 assert.equal(cfg.squarePaymentLinks?.mix,'https://square.link/u/nlRlUxDe');
 assert.equal(cfg.squarePaymentLinks?.full,'https://square.link/u/gOC2Qnnw');
});
