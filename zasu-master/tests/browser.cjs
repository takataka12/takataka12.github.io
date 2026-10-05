const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const screenshotDir=process.env.ZASU_SCREENSHOT_DIR||path.join(require('node:os').tmpdir(),'zasu-audio-ui-checks');fs.mkdirSync(screenshotDir,{recursive:true});
const base=process.env.ZASU_TEST_URL||'http://127.0.0.1:8000/';
const wav=Buffer.alloc(48044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const file=name=>({name,mimeType:'audio/wav',buffer:wav});
async function setup(browser,width){
  const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const calls=[];let mixFull=false,masterFull=false,errorCode=null;
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.hostname==='checkout.test')return route.fulfill({contentType:'text/html',body:'Square test checkout'});
    if(url.hostname.includes('supabase.co')){
      if(url.pathname.includes('/storage/'))return route.fulfill({json:{ok:true}});
      const body=req.postDataJSON()||{};const slug=url.pathname.split('/').pop();calls.push({slug,body});
      if(errorCode&&['create_upload','create_job'].includes(body.action))return route.fulfill({status:400,json:{error:errorCode}});
      let response={ok:true};
      if(slug==='zasu-mix-api'){
        if(body.action==='create_job')response={job_id:'test-mix',access_token:'test-token-123456789',bucket:'mix-files',chunk_size:100000,vocal_tickets:[{path:'vocal',token:'signed'}],instrumental_tickets:[{path:'inst',token:'signed'}]};
        if(body.action==='status')response={status:'completed',stage:'completed',processing_phase:mixFull?'full':'preview',preview_after_url:base+'test-preview.wav',mix_style:'modern',output_sample_rate:48000,output_lufs:-12,output_true_peak:-1};
        if(body.action==='unlock_full'){mixFull=true;response={processing_phase:'full'}};
      }else if(slug==='convert-api'){
        if(body.action==='create_upload')response={job_id:'test-convert',access_token:'test-token-123456789',bucket:'convert-files',chunk_size:100000,tickets:[{path:'source',token:'signed'}]};
        if(body.action==='status')response={status:'completed',stage:'completed',output_format:'wav',sample_rate:44100,bit_depth:16,output_size_bytes:48044,output_name:'result.wav'};
      }else if(slug==='create-mix-upload')response={upload_id:'test-upload',bucket:'mix-uploads',path:'source',token:'signed'};
      else if(slug==='mastering-status')response={status:'completed',stage:'completed',processing_mode:masterFull?'full':'preview',job_id:'test-master',preview_url:base+'test-preview.wav',download_url:base+'test-download.wav',profile_label:'STANDARD',output_lufs:-10,output_dbtp:-1};
      else if(slug==='create-zasu-audio-checkout')response={payment_url:'https://checkout.test/pay',order_id:'test-order',order_access_token:'order-token-123456789'};
      else if(slug==='zasu-audio-payment-status')response={paid:true};
      else if(slug==='unlock-zasu-master-full'){masterFull=true;response={ok:true,job_id:'test-master-full'}}
      else if(slug==='submit-beta-application')response={status:'accepted',application_no:1,access_token:'master-token-123456789'};
      return route.fulfill({json:response});
    }
    if(url.hostname.endsWith('railway.app')||url.pathname==='/test-download.wav')return route.fulfill({contentType:'audio/wav',headers:{'content-disposition':'attachment; filename=result.wav'},body:wav});
    if(url.pathname==='/test-preview.wav')return route.fulfill({contentType:'audio/wav',body:wav});
    return route.continue();
  });
  await page.addInitScript(()=>{localStorage.setItem('zasu_beta_application_no','1');localStorage.setItem('zasu_beta_access_token','master-token-123456789')});
  return {page,context,calls,errors,setError:x=>errorCode=x};
}
async function checkout(s,plan){
  await s.page.waitForURL(url=>url.pathname.endsWith('/checkout.html')&&url.searchParams.get('plan')===plan);
  assert.match(await s.page.locator('#checkoutPrice').innerText(),plan==='full'?/800/:/500/);
  await s.page.locator('#checkoutButton').click();assert.match(await s.page.locator('#checkoutStatus').innerText(),/確認/);
  await s.page.locator('#legalConfirm').check();await s.page.locator('#checkoutButton').click();await s.page.waitForURL('https://checkout.test/pay');
  const call=s.calls.find(x=>x.slug==='create-zasu-audio-checkout');assert.equal(call.body.plan,plan);
  await s.page.goto(base+'checkout-return.html?order=test-order');
  await s.page.locator('#returnActions a').first().waitFor();assert.match(await s.page.locator('#returnText').innerText(),/完了/);
  await s.page.locator('#returnActions a').first().click();
}
(async()=>{
 const server=process.env.ZASU_TEST_URL?null:http.createServer((req,res)=>{
  const relative=decodeURIComponent(new URL(req.url,base).pathname);let target=path.join(__dirname,'..',relative);
  if(!target.startsWith(path.resolve(__dirname,'..'))){res.writeHead(403);res.end();return}
  if(fs.existsSync(target)&&fs.statSync(target).isDirectory())target=path.join(target,'index.html');
  try{let bytes=fs.readFileSync(target);if(path.extname(target)==='.html'&&fs.existsSync(__dirname+'/fontsource'))bytes=bytes.toString().replace('</head>','<link rel="stylesheet" href="/tests/fontsource/japanese-400.css"><link rel="stylesheet" href="/tests/fontsource/japanese-700.css"></head>');res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'application/javascript','.woff2':'font/woff2','.png':'image/png'})[path.extname(target)]||'application/octet-stream');res.end(bytes)}catch(e){res.writeHead(404);res.end()}
 });
 if(server)await new Promise(resolve=>server.listen(8000,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.ZASU_CHROME||chromium.executablePath(),args:['--no-sandbox','--disable-gpu','--disable-software-rasterizer']});let passed=0;
 try{
  for(const width of [1440,390]){
   for(const path of ['', 'mix/','upload.html','convert/','pricing.html','contact.html','privacy.html']){
    const s=await setup(browser,width);await s.page.goto(base+path);await s.page.locator('main').waitFor();
    const overflow=await s.page.evaluate(()=>({ok:document.documentElement.scrollWidth<=innerWidth,elements:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,class:e.className,text:e.textContent.slice(0,60),right:e.getBoundingClientRect().right})).slice(0,10)}));
    assert.equal(overflow.ok,true,'overflow '+width+' '+path+' '+JSON.stringify(overflow.elements));
    assert.equal(await s.page.locator('nav').isVisible(),true);
    assert.deepEqual(s.errors,[]);
    if(['','mix/','upload.html','convert/'].includes(path))await s.page.screenshot({path:require('node:path').join(screenshotDir,'check-'+width+'-'+(path.replace(/\W/g,'')||'home')+'.png'),fullPage:true});
    await s.context.close();passed++;
   }
   for(const plan of ['mix','full']){
    const s=await setup(browser,width);await s.page.goto(base+'mix/');
    await s.page.locator('#vocalFile').setInputFiles(file('vocal.wav'));await s.page.locator('#instFile').setInputFiles(file('inst.wav'));await s.page.locator('#mixButton').click();
    await s.page.locator('#previewGate').waitFor({state:'visible'});assert.equal(await s.page.locator('#fullDownloads').isVisible(),false);
    assert.ok(await s.page.locator('#previewAfterAudio').getAttribute('src'));
    await s.page.locator(plan==='full'?'#unlockFullButton':'#unlockMixButton').click();await checkout(s,plan);
    await s.page.locator('#fullDownloads').waitFor({state:'visible'});
    const download=s.page.waitForEvent('download');await s.page.locator('#mixDownload').click();assert.ok((await download).suggestedFilename());
    const upload=s.calls.find(x=>x.slug==='zasu-mix-api'&&x.body.action==='create_job');assert.equal(upload.body.mix_style,'modern');assert.equal(upload.body.auto_balance,true);
    assert.deepEqual(s.errors,[]);await s.context.close();passed++;
   }
   for(const profile of ['standard','loud_otv']){
    const s=await setup(browser,width);await s.page.goto(base+'upload.html');await s.page.locator('label.profile-choice').filter({has:s.page.locator('input[value="'+profile+'"]')}).click();
    await s.page.locator('#mixFile').setInputFiles(file('mix.wav'));await s.page.locator('#uploadButton').click();await s.page.locator('#uploadStatus a').waitFor();
    const upload=s.calls.find(x=>x.slug==='create-mix-upload');assert.equal(upload.body.mastering_profile,profile);assert.equal(upload.body.preview_only,true);
    await s.page.locator('#uploadStatus a').click();await s.page.locator('#previewMasterGate').waitFor({state:'visible'});assert.ok(await s.page.locator('#afterAudio').getAttribute('src'));
    await s.page.locator('#unlockMasterButton').click();await checkout(s,'master');
    await s.page.locator('#resultActions a').first().waitFor();const dl=s.page.waitForEvent('download');await s.page.locator('#resultActions a').first().click();assert.ok((await dl).suggestedFilename());
    assert.deepEqual(s.errors,[]);await s.context.close();passed++;
   }
   for(const format of ['wav','flac','alac']){
    const s=await setup(browser,width);await s.page.goto(base+'convert/');await s.page.locator('#audioFile').setInputFiles(file('source.wav'));await s.page.locator('#outputFormat').selectOption(format);await s.page.locator('#convertButton').click();
    await s.page.locator('#resultCard').waitFor({state:'visible'});assert.equal(s.calls.find(x=>x.body.action==='create_upload').body.output_format,format);
    const dl=s.page.waitForEvent('download');await s.page.locator('#downloadButton').click();assert.ok((await dl).suggestedFilename());
    assert.deepEqual(s.errors,[]);await s.context.close();passed++;
   }
  }
  for(const code of ['unsupported_input_format','same_file','job_timeout']){
   const s=await setup(browser,390);s.setError(code);await s.page.goto(base+'mix/');await s.page.locator('#vocalFile').setInputFiles(file('vocal.wav'));await s.page.locator('#instFile').setInputFiles(file('inst.wav'));await s.page.locator('#mixButton').click();
   await s.page.waitForFunction(()=>document.querySelector('#statusText').textContent.length>0);assert.match(await s.page.locator('#statusText').innerText(),/[ぁ-んァ-ヶ一-龠]/);assert.equal(await s.page.locator('#mixButton').isEnabled(),true);await s.context.close();passed++;
  }
  console.log('PASS '+passed+' browser checks: desktop/mobile, MIX/MASTER purchase recovery, CONVERT outputs and Japanese errors. Network services mocked; no payment charged.');
 }finally{await browser.close();if(server)server.close()}
})().catch(e=>{console.error(e);process.exit(1)});
