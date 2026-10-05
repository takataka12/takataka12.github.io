// Exact typography artwork; run with Playwright and @fontsource/noto-sans-jp installed.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
 const fontRoot=process.env.ZASU_FONT_DIR||path.dirname(require.resolve('@fontsource/noto-sans-jp/package.json'));
 const font=fs.readFileSync(path.join(fontRoot,'files/noto-sans-jp-japanese-700-normal.woff2')).toString('base64');
 const browser=await chromium.launch({headless:true,executablePath:process.env.ZASU_CHROME||chromium.executablePath(),args:['--no-sandbox','--disable-gpu','--disable-software-rasterizer']});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:630},deviceScaleFactor:1});
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
  @font-face{font-family:JP;src:url(data:font/woff2;base64,${font});font-weight:700}*{box-sizing:border-box}body{margin:0;background:#090d10;color:#f5f5f3;width:1200px;height:630px;font:700 24px JP,Arial,sans-serif;padding:55px 64px;position:relative}body:after{content:'';position:absolute;right:64px;top:114px;width:8px;height:330px;background:#64d6e8;border-radius:8px}.brand{font:700 18px Arial,sans-serif;letter-spacing:2px;color:#a2b3b9}.logo{font:900 92px Arial,sans-serif;letter-spacing:-6px;margin:32px 0 0}.tagline{font:800 31px Arial,sans-serif;color:#64d6e8;margin:8px 0 34px;letter-spacing:-.5px}h1{font:700 39px JP,sans-serif;margin:0 0 12px;letter-spacing:-1px}.lead{font-size:23px;color:#c6d0d4;margin:0}.bottom{position:absolute;bottom:54px;left:64px;right:84px;border-top:1px solid #314049;padding-top:20px;display:flex;justify-content:space-between;align-items:center;font-size:18px}.bottom span:last-child{font:700 19px Arial,sans-serif;color:#64d6e8}
  </style><div class="brand">ZASU WORKS / WEB AUDIO SERVICE</div><div class="logo">ZASU AUDIO</div><div class="tagline">MIX. MASTER. CONVERT.</div><h1>音源をアップロードするだけ。</h1><p class="lead">MIXからマスタリングまで、もっとシンプルに。</p><div class="bottom"><span>ボーカルMIX ／ マスタリング ／ 音源変換</span><span>zasumaster.com</span></div>`);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(__dirname,'../assets/ogp-ja.png')});
  console.log('OGP generated: 1200 × 630');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
