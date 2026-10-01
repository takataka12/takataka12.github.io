const cfg=window.ZASU_MIX_CONFIG||{};
const q=s=>document.querySelector(s);
let vocal=null,inst=null,style="modern",job=null,pollTimer=null,readyMix=null;
const devMode=new URLSearchParams(location.search).get("dev")==="1";
const STYLE_CONTROL_DEFAULTS={
  natural:{gain:0.5,reverb:8,body:0,presence:0,air:0},
  modern:{gain:2.0,reverb:14,body:0,presence:0,air:0.5},
  rock:{gain:1.5,reverb:12,body:0.5,presence:0.5,air:0},
  loud:{gain:2.5,reverb:10,body:0,presence:1.0,air:0}
};

function humanBytes(n){n=Number(n||0);if(n<1024*1024)return(n/1024).toFixed(1)+" KB";return(n/1024/1024).toFixed(1)+" MB"}
function authHeaders(){return{"Content-Type":"application/json","apikey":cfg.publishableKey,"Authorization":"Bearer "+cfg.anonKey}}
async function api(action,payload={}){
  const r=await fetch(cfg.api,{method:"POST",headers:authHeaders(),body:JSON.stringify({action,...payload})});
  const b=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(b.error||"request_failed");
  return b;
}
function setProgress(p,title,text){q("#jobProgress").hidden=false;q("#progressBar").style.width=Math.max(0,Math.min(100,p))+"%";q("#progressTitle").textContent=title;q("#progressText").textContent=text}
function formatDuration(seconds){
  const n=Math.max(0,Number(seconds||0));
  const m=Math.floor(n/60),sec=Math.round(n%60);
  return m+":"+String(sec).padStart(2,"0");
}
function resetPreflightUi(){
  const panel=q("#preflightPanel");
  if(!panel)return;
  panel.hidden=true;
  panel.classList.remove("pass","warning");
  q("#preflightWarnings").innerHTML="";
  q("#preflightActions").hidden=true;
}
function renderPreflight(report,status="pass"){
  const panel=q("#preflightPanel");
  if(!panel||!report||typeof report!=="object")return;
  const warning=status==="warning"||report.requires_review===true||report.verdict==="warning";
  panel.hidden=false;
  panel.classList.toggle("warning",warning);
  panel.classList.toggle("pass",!warning);
  q("#preflightTitle").textContent=warning?"CHECK RECOMMENDED":"PRE-FLIGHT OK";
  q("#preflightLead").textContent=warning
    ?"MIX前に1点以上確認してください。問題なければそのまま続行できます。"
    :"長さ・頭出しリスク・入力レベルに大きな問題は見つかりませんでした。";
  q("#preflightVocalDuration").textContent=formatDuration(report.vocal_duration_seconds);
  q("#preflightInstDuration").textContent=formatDuration(report.instrumental_duration_seconds);
  q("#preflightVocalLevel").textContent=Number.isFinite(Number(report.vocal_lufs))
    ?Number(report.vocal_lufs).toFixed(1)+" LUFS / "+Number(report.vocal_true_peak_dbtp).toFixed(1)+" dBTP"
    :"—";
  q("#preflightInstLevel").textContent=Number.isFinite(Number(report.instrumental_lufs))
    ?Number(report.instrumental_lufs).toFixed(1)+" LUFS / "+Number(report.instrumental_true_peak_dbtp).toFixed(1)+" dBTP"
    :"—";
  const vocalLead=Number(report.vocal_leading_silence_seconds||0);
  const ratio=Number(report.duration_ratio||0);
  q("#preflightHead").textContent=warning?"CHECK":"OK";
  q("#preflightHead").nextElementSibling.textContent=
    "Vocal head "+vocalLead.toFixed(2)+"s / Length "+(ratio>0?(ratio*100).toFixed(0)+"%":"—");
  const warnings=q("#preflightWarnings");
  warnings.innerHTML="";
  for(const item of (Array.isArray(report.checks)?report.checks:[])){
    const box=document.createElement("div");
    box.className="preflight-warning";
    const strong=document.createElement("strong");
    strong.textContent=String(item.title||item.code||"CHECK");
    const span=document.createElement("span");
    span.textContent=String(item.message||"音源を確認してください。");
    box.append(strong,span);
    warnings.appendChild(box);
  }
  q("#preflightActions").hidden=!warning;
}
function pick(kind,file){
  if(kind==="vocal")vocal=file||null;else inst=file||null;
  const el=q(kind==="vocal"?"#vocalMeta":"#instMeta");
  const f=kind==="vocal"?vocal:inst;
  el.textContent=f?(f.name+" — "+humanBytes(f.size)):(kind==="vocal"?"ボーカル未選択":"インスト未選択");
  el.classList.toggle("ready",!!f);
  resetPreflightUi();
}
// iOS/Safari can suppress "change" when the same file is selected again.
// Reset only the native file-input value before the picker opens; the current
// File object in vocal/inst remains available if the user cancels.
q("#vocalFile").addEventListener("click",()=>{q("#vocalFile").value="";});
q("#instFile").addEventListener("click",()=>{q("#instFile").value="";});
q("#vocalFile").addEventListener("change",()=>pick("vocal",q("#vocalFile").files?.[0]));
q("#instFile").addEventListener("change",()=>pick("inst",q("#instFile").files?.[0]));
for(const [id,kind] of [["#vocalDrop","vocal"],["#instDrop","inst"]]){
  const el=q(id);
  ["dragenter","dragover"].forEach(t=>el.addEventListener(t,e=>{e.preventDefault();el.classList.add("drag")}));
  ["dragleave","drop"].forEach(t=>el.addEventListener(t,e=>{e.preventDefault();el.classList.remove("drag")}));
  el.addEventListener("drop",e=>pick(kind,e.dataTransfer?.files?.[0]));
}
function dbText(v){
  const n=Number(v||0);return (n>0?"+":"")+n.toFixed(1)+" dB";
}
function syncAutoBalanceUi(){
  const on=q("#autoBalance").checked;
  q("#vocalGain").disabled=on;
  q("#vocalGainValue").textContent=on?"AUTO":dbText(q("#vocalGain").value);
  q("#autoBalanceHint").textContent=on
    ?"ON — VOCAL LEVELは素材に合わせて自動決定します。"
    :"OFF — VOCAL LEVELを手動で調整できます。";
  q("#autoBalanceHint").classList.toggle("manual",!on);
}
function syncControlLabels(){
  if(!q("#autoBalance").checked)q("#vocalGainValue").textContent=dbText(q("#vocalGain").value);
  q("#reverbValue").textContent=Math.round(Number(q("#reverbAmount").value||0))+"%";
  q("#eqBodyValue").textContent=dbText(q("#eqBody").value);
  q("#eqPresenceValue").textContent=dbText(q("#eqPresence").value);
  q("#eqAirValue").textContent=dbText(q("#eqAir").value);
}
function applyStyleControls(name){
  const d=STYLE_CONTROL_DEFAULTS[name]||STYLE_CONTROL_DEFAULTS.modern;
  q("#vocalGain").value=String(d.gain);
  q("#reverbAmount").value=String(d.reverb);
  q("#eqBody").value=String(d.body);
  q("#eqPresence").value=String(d.presence);
  q("#eqAir").value=String(d.air);
  syncControlLabels();
}
["#vocalGain","#reverbAmount","#eqBody","#eqPresence","#eqAir"].forEach(id=>q(id).addEventListener("input",syncControlLabels));
q("#autoBalance").addEventListener("change",()=>{syncControlLabels();syncAutoBalanceUi()});
document.querySelectorAll(".style").forEach(x=>x.onclick=()=>{
  style=x.dataset.style;
  document.querySelectorAll(".style").forEach(y=>y.classList.toggle("active",y===x));
  applyStyleControls(style);
});
applyStyleControls("modern");
syncAutoBalanceUi();

async function uploadSet(ticketList,file,bucket,chunkSize,label,startPct,endPct){
  const total=ticketList.length;
  for(let i=0;i<total;i++){
    const t=ticketList[i],start=i*chunkSize,end=Math.min(file.size,start+chunkSize),blob=file.slice(start,end);
    const url=cfg.supabaseUrl.replace(/\/$/,"")+"/storage/v1/object/upload/sign/"+encodeURIComponent(bucket)+"/"+t.path.split("/").map(encodeURIComponent).join("/")+"?token="+encodeURIComponent(t.token);
    const fd=new FormData();fd.append("cacheControl","3600");fd.append("",blob,label+"-"+String(i).padStart(3,"0"));
    const r=await fetch(url,{method:"PUT",headers:{"apikey":cfg.publishableKey,"x-upsert":"false"},body:fd});
    if(!r.ok)throw new Error(label+"_upload_failed");
    const pct=Math.round(startPct+((i+1)/total)*(endPct-startPct));
    setProgress(pct,"UPLOADING",label.toUpperCase()+" — "+(i+1)+" / "+total);
  }
}

async function start(){
  if(!vocal||!inst){q("#statusText").textContent="DRY VOCALとINSTRUMENTALの両方を選択してください。";return}
  if(vocal.size>cfg.maxBytes||inst.size>cfg.maxBytes){q("#statusText").textContent="各ファイル最大500MBです。";return}
  const b=q("#mixButton");b.disabled=true;q("#resultCard").hidden=true;q("#statusText").textContent="";resetPreflightUi();
  try{
    setProgress(3,"PREPARING","MIXジョブを準備しています。");
    const ticket=await api("create_job",{
      vocal_name:vocal.name,vocal_size_bytes:vocal.size,vocal_mime_type:vocal.type||"application/octet-stream",
      instrumental_name:inst.name,instrumental_size_bytes:inst.size,instrumental_mime_type:inst.type||"application/octet-stream",
      mix_style:style,
      auto_balance:q("#autoBalance").checked,
      vocal_gain_db:Number(q("#vocalGain").value),
      reverb_amount:Number(q("#reverbAmount").value),
      eq_body_db:Number(q("#eqBody").value),
      eq_presence_db:Number(q("#eqPresence").value),
      eq_air_db:Number(q("#eqAir").value)
    });
    job={id:ticket.job_id,token:ticket.access_token};
    sessionStorage.setItem("zasu_mix_job",JSON.stringify(job));
    await uploadSet(ticket.vocal_tickets,vocal,ticket.bucket,ticket.chunk_size,"vocal",5,23);
    await uploadSet(ticket.instrumental_tickets,inst,ticket.bucket,ticket.chunk_size,"instrumental",23,42);
    await api("complete_upload",{job_id:job.id,access_token:job.token});
    setProgress(45,"QUEUED","AUTO MIX ENGINEを待っています。");
    poll();
  }catch(e){
    b.disabled=false;
    q("#statusText").textContent="開始できませんでした。音源や通信状態を確認してください。";
  }
}
q("#mixButton").onclick=start;

const stageCopy={
  uploading:["UPLOADING","音源をアップロードしています。"],
  preflight_queued:["PRE-FLIGHT","音源チェックを待っています。"],
  preflight_claimed:["PRE-FLIGHT","音源チェックを開始しています。"],
  preflight_analyzing:["PRE-FLIGHT","長さ・頭出し・入力レベルを確認しています。"],
  preflight_ok:["PRE-FLIGHT OK","チェック完了。AUTO MIXへ進みます。"],
  preflight_review:["CHECK REQUIRED","MIX前に音源を確認してください。"],
  queued:["QUEUED","MIXサーバーを待っています。"],
  claimed:["STARTING","AUTO MIX ENGINEを起動しています。"],
  downloading:["DOWNLOADING","音源を処理サーバーへ転送しています。"],
  preview_select:["PREVIEW","30秒の試聴区間を準備しています。"],
  analyzing:["ANALYZING","音量・マスキング・フォーマットを解析しています。"],
  mixing:["AUTO MIXING","EQ / De-esser / Compressor / Vocal Level / Reverbを反映しています。"],
  preparing_results:["RENDERING","24-bit WAVを書き出しています。"],
  uploading_results:["SAVING","完成ファイルを保存しています。"],
  finalizing:["FINALIZING","最終確認しています。"],
  retrying:["RETRYING","一時的なエラーのため再試行しています。"],
  preview_ready:["PREVIEW READY","無料試聴が完成しました。"],
  completed:["READY","AUTO MIXが完成しました。"]
};

async function poll(){
  clearTimeout(pollTimer);if(!job)return;
  try{
    const s=await api("status",{job_id:job.id,access_token:job.token});
    const copy=stageCopy[s.stage]||["PROCESSING","AUTO MIX処理中です。"];
    setProgress(Number(s.progress||0),copy[0],copy[1]);
    if(s.preflight_report&&Object.keys(s.preflight_report).length){
      renderPreflight(s.preflight_report,s.stage==="preflight_review"?"warning":s.preflight_status);
    }
    if(s.stage==="preflight_review"||s.status==="awaiting_review"){
      showPreflightReview(s);
      return;
    }
    if(s.status==="completed"){
      if(s.processing_phase==="preview"){showPreview(s);return}
      showResult(s);return
    }
    if(s.status==="failed"){q("#mixButton").disabled=false;q("#statusText").textContent=s.user_message||"MIXに失敗しました。";return}
    pollTimer=setTimeout(poll,2500);
  }catch(_){
    q("#statusText").textContent="接続を再確認しています…";
    pollTimer=setTimeout(poll,6000);
  }
}

function showPreflightReview(s){
  clearTimeout(pollTimer);
  renderPreflight(s.preflight_report||{},"warning");
  q("#mixButton").disabled=true;
  q("#statusText").textContent="Preflightで確認項目があります。音源を確認するか、このまま続行してください。";
  q("#preflightPanel").scrollIntoView({behavior:"smooth",block:"center"});
}

async function continueAfterPreflight(){
  if(!job?.id||!job?.token)return;
  const button=q("#preflightContinue");
  const change=q("#preflightChangeFiles");
  button.disabled=true;change.disabled=true;
  q("#statusText").textContent="確認済みとしてAUTO MIXを再開します。";
  try{
    const body=await api("approve_preflight",{job_id:job.id,access_token:job.token});
    if(body.status!=="queued")throw new Error("preflight_resume_failed");
    q("#preflightActions").hidden=true;
    q("#preflightTitle").textContent="CHECKED / CONTINUING";
    q("#preflightLead").textContent="確認済みとしてAUTO MIXを続行します。";
    setProgress(10,"QUEUED","AUTO MIX ENGINEを待っています。");
    poll();
  }catch(e){
    q("#statusText").textContent=e?.message||"MIXを再開できませんでした。";
    button.disabled=false;change.disabled=false;
  }
}
function changePreflightFiles(){
  clearTimeout(pollTimer);
  job=null;
  sessionStorage.removeItem("zasu_mix_job");
  q("#mixButton").disabled=false;
  q("#preflightActions").hidden=true;
  q("#statusText").textContent="音源を選び直して、もう一度CREATE AUTO MIXを押してください。";
  q("#vocalDrop").scrollIntoView({behavior:"smooth",block:"center"});
}
q("#preflightContinue").addEventListener("click",continueAfterPreflight);
q("#preflightChangeFiles").addEventListener("click",changePreflightFiles);

function downloadUrl(kind){
  const source=readyMix||job;
  return cfg.downloadBase.replace(/\/$/,"")+"/download/"+encodeURIComponent(source.id)+"/"+kind+"?token="+encodeURIComponent(source.token);
}

function renderCommonMetrics(s){
  q("#resultStyle").textContent=String(s.mix_style||"").toUpperCase();
  q("#resultRate").textContent=s.output_sample_rate?(Number(s.output_sample_rate)/1000).toFixed(Number(s.output_sample_rate)%1000?1:0)+" kHz":"—";
  q("#resultLufs").textContent=Number.isFinite(Number(s.output_lufs))?Number(s.output_lufs).toFixed(2)+" LUFS":"—";
  q("#resultTp").textContent=Number.isFinite(Number(s.output_true_peak))?Number(s.output_true_peak).toFixed(2)+" dBTP":"—";
  const autoResult=q("#autoBalanceResult");
  if(s.auto_balance===true&&Number.isFinite(Number(s.applied_vocal_gain_db))){
    q("#autoBalanceResultValue").textContent=dbText(s.applied_vocal_gain_db);
    autoResult.hidden=false;
  }else{
    autoResult.hidden=true;
  }
}

function setPreviewAudio(audio,primary,fallback){
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  let usedFallback=false;
  audio.onerror=()=>{
    if(usedFallback||!fallback||audio.src===fallback)return;
    usedFallback=true;
    audio.src=fallback;
    audio.load();
  };
  audio.src=primary||fallback;
  audio.preload="metadata";
  audio.load();
}

function showPreview(s){
  q("#mixButton").disabled=false;
  readyMix={id:job.id,token:job.token};
  sessionStorage.setItem("zasu_mix_ready",JSON.stringify(readyMix));
  renderCommonMetrics(s);
  q("#resultHeading").textContent="PREVIEW READY.";
  q("#previewAbArea").hidden=false;
  q("#previewGate").hidden=false;
  q("#fullDownloads").hidden=true;
  q("#fullMasterHandoff").hidden=true;
  setPreviewAudio(
    q("#previewAfterAudio"),
    s.preview_mix_url||null,
    downloadUrl("preview_mix")
  );
  const devButton=q("#devUnlockMixButton");
  if(devButton){
    devButton.hidden=!devMode;
    devButton.dataset.jobId=String((readyMix||job)?.id||"");
  }
  if(cfg.commerceEnabled){
    q("#unlockMixButton").textContent="UNLOCK FULL MIX — ¥500";
    q("#unlockFullButton").textContent="MIX + MASTER — ¥800";
    q("#previewGateCopy").textContent="試聴を確認してからSquareで決済。決済後にフル尺を処理します。";
  }else{
    q("#unlockMixButton").textContent="CREATE FULL MIX — FREE BETA";
    q("#unlockFullButton").textContent="MIX + MASTER — FREE BETA";
    q("#previewGateCopy").textContent="OPEN BETA中は決済なしでフル尺処理できます。";
  }
  q("#resultCard").hidden=false;
  q("#resultCard").scrollIntoView({behavior:"smooth",block:"start"});
  sessionStorage.removeItem("zasu_mix_job");
}

async function unlockFullDev(){
  const source=readyMix||job;
  const statusEl=q("#previewUnlockStatus");
  const devButton=q("#devUnlockMixButton");
  if(!devMode||!source?.id||!source?.token){
    if(statusEl)statusEl.textContent="DEV試聴ジョブが見つかりません。";
    return;
  }
  let adminKey=sessionStorage.getItem("zasu_dev_admin_key")||"";
  if(!adminKey){
    adminKey=window.prompt("ZASU DEV ADMIN KEY")||"";
    if(!adminKey)return;
    sessionStorage.setItem("zasu_dev_admin_key",adminKey);
  }

  const buttons=[q("#unlockMixButton"),q("#unlockFullButton"),devButton].filter(Boolean);
  buttons.forEach(x=>x.disabled=true);
  if(statusEl)statusEl.textContent="DEV MODE — 決済なしでフル尺MIXを開始しています…";

  try{
    const r=await fetch(cfg.api,{
      method:"POST",
      headers:{
        ...authHeaders(),
        "x-zasu-admin-key":adminKey
      },
      body:JSON.stringify({
        action:"unlock_full",
        job_id:source.id,
        access_token:source.token,
        dev_mode:true
      })
    });
    const body=await r.json().catch(()=>({}));
    if(!r.ok){
      if(r.status===401||body.error==="dev_unauthorized"){
        sessionStorage.removeItem("zasu_dev_admin_key");
        throw new Error("管理者キーが違います。");
      }
      throw new Error(body.error||"dev_unlock_failed");
    }
    if(body.processing_phase!=="full")throw new Error("dev_unlock_failed");
    job=source;
    sessionStorage.setItem("zasu_mix_job",JSON.stringify(job));
    q("#previewGate").hidden=true;
    q("#previewAbArea").hidden=true;
    q("#resultCard").hidden=true;
    setProgress(10,"DEV / QUEUED","管理者DEVモードで決済をスキップし、フル尺AUTO MIXを開始します。");
    poll();
  }catch(e){
    if(statusEl)statusEl.textContent=e?.message||"DEVフル尺MIXを開始できませんでした。";
    buttons.forEach(x=>x.disabled=false);
  }
}

async function unlockFull(plan){
  const source=readyMix||job;
  const statusEl=q("#previewUnlockStatus");
  if(!source?.id||!source?.token){statusEl.textContent="試聴ジョブが見つかりません。";return}
  if(cfg.commerceEnabled){
    localStorage.setItem("zasu_pending_unlock",JSON.stringify({
      type:"mix",plan,job_id:source.id,access_token:source.token,created_at:Date.now()
    }));
    location.href=cfg.checkoutPage+"?plan="+encodeURIComponent(plan)+"&source=mix";
    return;
  }
  const buttons=[q("#unlockMixButton"),q("#unlockFullButton")];
  buttons.forEach(x=>x.disabled=true);
  statusEl.textContent="フル尺MIXを準備しています…";
  try{
    const body=await api("unlock_full",{job_id:source.id,access_token:source.token});
    if(body.processing_phase!=="full")throw new Error("unlock_failed");
    job=source;
    sessionStorage.setItem("zasu_mix_job",JSON.stringify(job));
    q("#previewGate").hidden=true;
    q("#previewAbArea").hidden=true;
    q("#resultCard").hidden=true;
    setProgress(10,"QUEUED","フル尺AUTO MIXを待っています。");
    poll();
  }catch(e){
    statusEl.textContent=e?.message||"フル尺処理を開始できませんでした。";
    buttons.forEach(x=>x.disabled=false);
  }
}

function showResult(s){
  q("#mixButton").disabled=false;
  renderCommonMetrics(s);
  q("#resultHeading").textContent="MIX READY.";
  q("#previewAbArea").hidden=true;
  q("#previewGate").hidden=true;
  q("#fullDownloads").hidden=false;
  q("#fullMasterHandoff").hidden=false;
  readyMix={id:job.id,token:job.token};
  sessionStorage.setItem("zasu_mix_ready",JSON.stringify(readyMix));
  q("#mixDownload").href=downloadUrl("mix");
  q("#vocalDownload").href=downloadUrl("vocal");
  q("#resultCard").hidden=false;
  q("#resultCard").scrollIntoView({behavior:"smooth",block:"start"});
  sessionStorage.removeItem("zasu_mix_job");
}

async function ensureMasterPreviewSession(){
  let no=Number(localStorage.getItem("zasu_beta_application_no")||"");
  let appToken=localStorage.getItem("zasu_beta_access_token")||"";
  if(Number.isFinite(no)&&no>0&&appToken)return {no,appToken};

  let visitorId=localStorage.getItem("zasu_visitor_id");
  if(!visitorId){visitorId=crypto.randomUUID();localStorage.setItem("zasu_visitor_id",visitorId)}
  const sessionId=crypto.randomUUID();
  sessionStorage.setItem("zasu_session_id",sessionId);
  const res=await fetch(cfg.masterSessionEndpoint,{
    method:"POST",
    headers:authHeaders(),
    body:JSON.stringify({website:"",visitor_id:visitorId,session_id:sessionId})
  });
  const body=await res.json().catch(()=>({}));
  if(!res.ok||body.status!=="accepted"||!body.application_no||!body.access_token){
    throw new Error("MASTERプレビュー用セッションを準備できませんでした。");
  }
  no=Number(body.application_no);appToken=String(body.access_token);
  localStorage.setItem("zasu_beta_application_no",String(no));
  localStorage.setItem("zasu_beta_access_token",appToken);
  localStorage.setItem("zasu_visitor_id",String(body.visitor_id||visitorId));
  sessionStorage.setItem("zasu_session_id",String(body.session_id||sessionId));
  return {no,appToken};
}

async function sendToMaster(profile){
  const source=readyMix||job;
  const statusEl=q("#masterHandoffStatus");
  const buttons=[q("#sendStandard"),q("#sendLoud")];
  if(!source?.id||!source?.token){
    statusEl.textContent="完成MIX情報が見つかりません。もう一度MIXを完成させてください。";
    statusEl.className="handoff-status error";
    return;
  }
  sessionStorage.setItem("zasu_mix_master_handoff",JSON.stringify({
    mix_job_id:source.id,
    mix_access_token:source.token,
    mastering_profile:profile,
    created_at:Date.now()
  }));
  buttons.forEach(x=>x.disabled=true);
  statusEl.textContent="無料30秒MASTERプレビューを準備しています…";
  let no,appToken;
  try{
    const session=await ensureMasterPreviewSession();
    no=session.no;appToken=session.appToken;
  }catch(e){
    statusEl.textContent=e?.message||"MASTERプレビューを開始できませんでした。";
    statusEl.className="handoff-status error";
    buttons.forEach(x=>x.disabled=false);
    return;
  }
  statusEl.textContent=(profile==="loud_otv"?"LOUD / OTV":"STANDARD")+"の無料30秒プレビューへ送っています…";
  statusEl.className="handoff-status";
  try{
    const res=await fetch(cfg.directMasterEndpoint,{
      method:"POST",
      headers:authHeaders(),
      body:JSON.stringify({
        application_no:no,
        access_token:appToken,
        mix_job_id:source.id,
        mix_access_token:source.token,
        mastering_profile:profile
      })
    });
    const body=await res.json().catch(()=>({}));
    if(!res.ok){
      const map={
        beta_application_not_found:"ZASU MASTERの受付情報を確認してください。",
        beta_not_accepted:"ZASU MASTERの受付がまだ有効になっていません。",
        payment_required:"ZASU MASTERの利用権限を確認してください。",
        mix_job_not_found:"完成MIXを確認できませんでした。",
        mix_not_ready:"MIXがまだ完成していません。",
        mix_expired:"MIXファイルの保存期限が切れています。",
        mix_source_missing:"完成MIXファイルを確認できませんでした。"
      };
      throw new Error(map[body.error]||"ZASU MASTERへの送信に失敗しました。");
    }

    statusEl.textContent="30 SEC MASTER PREVIEW QUEUED. 結果画面へ移動します…";
    statusEl.className="handoff-status success";
    sessionStorage.removeItem("zasu_mix_master_handoff");
    sessionStorage.setItem("zasu_result_handoff",JSON.stringify({application_no:no,access_token:appToken}));
    setTimeout(()=>{location.href="../result.html"},350);
  }catch(e){
    statusEl.textContent=e?.message||"ZASU MASTERへの送信に失敗しました。";
    statusEl.className="handoff-status error";
    buttons.forEach(x=>x.disabled=false);
  }
}
q("#sendStandard").addEventListener("click",()=>sendToMaster("standard"));
q("#sendLoud").addEventListener("click",()=>sendToMaster("loud_otv"));
q("#unlockMixButton").addEventListener("click",()=>unlockFull("mix"));
q("#unlockFullButton").addEventListener("click",()=>unlockFull("full"));
q("#devUnlockMixButton")?.addEventListener("click",unlockFullDev);

const saved=sessionStorage.getItem("zasu_mix_job");
if(saved){
  try{
    job=JSON.parse(saved);
    if(job?.id&&job?.token){
      q("#mixButton").disabled=true;
      setProgress(10,"RESTORING","前回のMIX状況を確認しています。");
      poll();
    }
  }catch(_){sessionStorage.removeItem("zasu_mix_job")}
}else{
  const ready=sessionStorage.getItem("zasu_mix_ready");
  if(ready){
    try{
      job=JSON.parse(ready);
      if(job?.id&&job?.token){
        api("status",{job_id:job.id,access_token:job.token}).then(s=>{
          if(s.status==="completed"){
            if(s.processing_phase==="preview")showPreview(s);else showResult(s)
          }
          else if(s.status!=="failed"){setProgress(Number(s.progress||10),"RESTORING","MIX状況を確認しています。");poll()}
        }).catch(()=>{});
      }
    }catch(_){sessionStorage.removeItem("zasu_mix_ready")}
  }
}
