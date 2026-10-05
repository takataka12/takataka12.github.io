const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('API error codes produce Japanese recovery guidance without leaking internals',()=>{
  const context={window:{}};
  const file=__dirname+'/../assets/ui-copy.js';
  assert.ok(fs.existsSync(file),'shared Japanese copy must exist');
  vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
  const ui=context.window.ZASU_I18N;
  for(const code of ['unsupported_input_format','file_too_large','same_file','chunk_upload_failed','zasu_mix_api_failed','master_failed','convert_api_failed','payment_required','download_failed','job_timeout','processing_cancelled']){
    const message=ui.error(code,'mix');
    assert.match(message,/[ぁ-んァ-ヶ一-龠]/);
    assert.match(message,/ください|確認|試し|選び|待って/);
    assert.ok(!message.includes(code));
  }
  assert.equal(ui.error('SQL failure token=secret','master').includes('secret'),false);
  assert.match(ui.error(new Error('Failed to fetch'),'mix'),/通信/);
  assert.match(ui.error('短時間にアクセスが集中しています。約2分後にもう一度お試しください。','mix'),/2分/);
});
