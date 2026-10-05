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
function authHeaders(){
  const h={"Content-Type":"application/json","apikey":cfg.publishableKey,"Authorization":"Bearer "+cfg.anonKey};
  const admin=sessionStorage.getItem("zasu_admin_key")||sessionStorage.getItem("zasu_dev_admin_key");
  if(admin)h["x-zasu-admin-key"]=admin;
  return h;
}
async function api(action,payload={}){
  const r=await fetch(cfg.api,{method:"POST",headers:authHeaders(),body:JSON.stringify({action,...payload})});
  const b=await r.json().catch(()=>({}));
  if(!r.ok){
    if(r.status===429||b.error==="rate_limited"){
      const sec=Math.max(1,Number(b.retry_after_seconds||60));
      throw new Error("短時間に処理リクエストが集中しています。約"+Math.ceil(sec/60)+"分後にもう一度お試しください。");
    }
    throw new Error(b.user_message||b.error||"request_failed");
  }
  return b;
}
function setProgress(p,title,text){q("#jobProgress").hidden=false;q("#progressBar").style.width=Math.max(0,Math.min(100,p))+"%";q("#progressTitle").textContent=title;q("#progressText").textContent=text}
function renderQueueStatus(s){
  const box=q("#queueStatus");
  if(!box)return;
  box.classList.remove("ready","processing","waiting");
  if(!s||!["queued","processing"].includes(String(s.status||""))){
    box.hidden=true;
    return;
  }
  box.hidden=false;
  if(s.status==="processing"){
    box.classList.add("processing");
    q("#queueHeadline").textContent="処理中";
    const waiting=Number(s.queue_waiting_total||0);
    q("#queueDetail").textContent=waiting>0?"処理中 / 後ろに待機 "+waiting+"件":"処理サーバーで実行中です。";
    return;
  }
  const ahead=Math.max(0,Number(s.jobs_ahead||0));
  const pos=Math.max(1,Number(s.queue_position||1));
  if(ahead===0){
    box.classList.add("ready");
    q("#queueHeadline").textContent="まもなく処理を開始";
    q("#queueDetail").textContent="待機なし。次に処理されます。";
  }else{
    box.classList.add("waiting");
    q("#queueHeadline").textContent="待ち順："+pos;
    q("#queueDetail").textContent="あなたの前に "+ahead+"件 / 現在の待機 "+Number(s.queue_waiting_total||0)+"件";
  }
}
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
  q("#preflightContinue").disabled=false;
  q("#preflightChangeFiles").disabled=false;
}
function renderPreflight(report,status="pass"){
  const panel=q("#preflightPanel");
  if(!panel||!report||typeof report!=="object")return;
  const warning=status==="warning"||report.requires_review===true||report.verdict==="warning";
  panel.hidden=false;
  panel.classList.toggle("warning",warning);
  panel.classList.toggle("pass",!warning);
  q("#preflightTitle").textContent=warning?"音源をご確認ください":"音源チェック完了";
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
  q("#preflightHead").textContent=warning?"要確認":"OK";
  q("#preflightHead").nextElementSibling.textContent=
    "ボーカルの先頭無音 "+vocalLead.toFixed(2)+"秒 / 長さの比率 "+(ratio>0?(ratio*100).toFixed(0)+"%":"—");
  const warnings=q("#preflightWarnings");
  warnings.innerHTML="";
  for(const item of (Array.isArray(report.checks)?report.checks:[])){
    const box=document.createElement("div");
    box.className="preflight-warning";
    const strong=document.createElement("strong");
    strong.textContent=String(item.title||item.code||"要確認");
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
    ?"ON — ボーカル音量は素材に合わせて自動決定します。"
    :"OFF — ボーカル音量を手動で調整できます。";
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
    setProgress(pct,"アップロード中",(label==="vocal"?"ボーカル":"インスト")+" — "+(i+1)+" / "+total);
  }
}

async function start(){
  if(!vocal||!inst){q("#statusText").textContent="ボーカルとインストの両方を選択してください。";return}
  if(vocal.size>cfg.maxBytes||inst.size>cfg.maxBytes){q("#statusText").textContent="各ファイル最大500MBです。500MB以内の音源を選び直してください。";return}
  const b=q("#mixButton");b.disabled=true;q("#resultCard").hidden=true;q("#statusText").textContent="";resetPreflightUi();
  try{
    setProgress(3,"準備中","MIXジョブを準備しています。");
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
    setProgress(45,"処理待ち","AUTO MIX ENGINEを待っています。");
    poll();
  }catch(e){
    b.disabled=false;
    q("#statusText").textContent=window.ZASU_I18N.error(e,"mix");
  }
}
q("#mixButton").onclick=start;

const stageCopy={
  uploading:["アップロード中","音源をアップロードしています。"],
  preflight_queued:["音源チェック中","音源チェックを待っています。"],
  preflight_claimed:["音源チェック中","音源チェックを開始しています。"],
  preflight_analyzing:["音源チェック中","長さ・頭出し・入力レベルを確認しています。"],
  preflight_ok:["音源チェック完了","チェック完了。AUTO MIXへ進みます。"],
  preflight_review:["音源の確認が必要","MIX前に音源を確認してください。"],
  queued:["処理待ち","MIXサーバーを待っています。"],
  claimed:["処理開始","AUTO MIX ENGINEを起動しています。"],
  downloading:["音源転送中","音源を処理サーバーへ転送しています。"],
  preview_select:["無料試聴","30秒の試聴区間を準備しています。"],
  analyzing:["音源解析中","音量・マスキング・フォーマットを解析しています。"],
  mixing:["MIX処理中","EQ・歯擦音の抑制・コンプレッション・音量・リバーブを反映しています。"],
  preparing_results:["書き出し中","24-bit WAVを書き出しています。"],
  uploading_results:["保存中","完成ファイルを保存しています。"],
  finalizing:["最終確認中","最終確認しています。"],
  retrying:["再試行中","一時的なエラーのため再試行しています。"],
  preview_ready:["無料試聴完成","無料試聴が完成しました。"],
  completed:["完了","AUTO MIXが完成しました。"]
};

async function poll(){
  clearTimeout(pollTimer);if(!job)return;
  try{
    const s=await api("status",{job_id:job.id,access_token:job.token});
    renderQueueStatus(s);
    const copy=stageCopy[s.stage]||["処理中","AUTO MIX処理中です。"];
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
    if(s.status==="failed"){q("#mixButton").disabled=false;q("#statusText").textContent=window.ZASU_I18N.error(s.user_message||s.error_code,"mix");return}
    pollTimer=setTimeout(poll,2500);
  }catch(_){
    q("#statusText").textContent="接続を再確認しています…";
    pollTimer=setTimeout(poll,6000);
  }
}

function showPreflightReview(s){
  clearTimeout(pollTimer);
  if(q("#queueStatus"))q("#queueStatus").hidden=true;
  renderPreflight(s.preflight_report||{},"warning");
  q("#mixButton").disabled=true;
  q("#statusText").textContent="MIX前のチェックで確認項目があります。音源を確認するか、このまま続行してください。";
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
    q("#preflightTitle").textContent="確認済み / MIXを再開";
    q("#preflightLead").textContent="確認済みとしてAUTO MIXを続行します。";
    setProgress(10,"処理待ち","AUTO MIX ENGINEを待っています。");
    poll();
  }catch(e){
    q("#statusText").textContent=window.ZASU_I18N.error(e,"mix");
    button.disabled=false;change.disabled=false;
  }
}
function changePreflightFiles(){
  clearTimeout(pollTimer);
  job=null;
  sessionStorage.removeItem("zasu_mix_job");
  q("#mixButton").disabled=false;
  q("#preflightActions").hidden=true;
  q("#statusText").textContent="音源を選び直して、もう一度「MIXを開始」を押してください。";
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
  if(q("#queueStatus"))q("#queueStatus").hidden=true;
  readyMix={id:job.id,token:job.token};
  sessionStorage.setItem("zasu_mix_ready",JSON.stringify(readyMix));
  renderCommonMetrics(s);
  q("#resultHeading").textContent="無料試聴が完成しました";
  q("#previewAbArea").hidden=false;
  q("#previewGate").hidden=false;
  q("#fullDownloads").hidden=true;
  q("#fullMasterHandoff").hidden=true;
  if(q("#mixFeedbackCard"))q("#mixFeedbackCard").hidden=true;
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
    q("#unlockMixButton").textContent=window.ZASU_I18N.t("buyMix");
    q("#unlockFullButton").textContent=window.ZASU_I18N.t("buyFull");
    q("#previewGateCopy").textContent="試聴を確認してからSquareで決済。決済後にフル尺を処理します。";
  }else{
    q("#unlockMixButton").textContent="フル尺MIXを作成（無料公開時のみ）";
    q("#unlockFullButton").textContent="MIX + MASTERを作成（無料公開時のみ）";
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
    if(statusEl)statusEl.textContent=window.ZASU_I18N.error(e,"mix");
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
    setProgress(10,"処理待ち","フル尺AUTO MIXを待っています。");
    poll();
  }catch(e){
    statusEl.textContent=window.ZASU_I18N.error(e,"mix");
    buttons.forEach(x=>x.disabled=false);
  }
}

function showResult(s){
  q("#mixButton").disabled=false;
  if(q("#queueStatus"))q("#queueStatus").hidden=true;
  renderCommonMetrics(s);
  q("#resultHeading").textContent="MIXが完成しました";
  q("#previewAbArea").hidden=true;
  q("#previewGate").hidden=true;
  q("#fullDownloads").hidden=false;
  q("#fullMasterHandoff").hidden=false;
  if(q("#mixFeedbackCard"))q("#mixFeedbackCard").hidden=false;
  readyMix={id:job.id,token:job.token};
  sessionStorage.setItem("zasu_mix_ready",JSON.stringify(readyMix));
  q("#mixDownload").href=downloadUrl("mix");
  q("#vocalDownload").href=downloadUrl("vocal");
  q("#resultCard").hidden=false;
  q("#resultCard").scrollIntoView({behavior:"smooth",block:"start"});
  sessionStorage.removeItem("zasu_mix_job");
}

let mixFeedbackSentiment=0;
const mixFeedbackTags=new Set();

function selectMixFeedbackSentiment(value){
  mixFeedbackSentiment=Number(value);
  mixFeedbackTags.clear();
  document.querySelectorAll("[data-mix-feedback-sentiment]").forEach(btn=>{
    btn.classList.toggle("active",Number(btn.dataset.mixFeedbackSentiment)===mixFeedbackSentiment);
  });
  document.querySelectorAll("[data-mix-feedback-tag]").forEach(btn=>btn.classList.remove("active"));
  q("#mixFeedbackDetails").hidden=false;
  q("#mixFeedbackPositiveTags").hidden=mixFeedbackSentiment!==1;
  q("#mixFeedbackNegativeTags").hidden=mixFeedbackSentiment!==-1;
  q("#mixFeedbackStatus").textContent="";
  q("#mixFeedbackStatus").className="handoff-status";
}

document.querySelectorAll("[data-mix-feedback-sentiment]").forEach(btn=>{
  btn.addEventListener("click",()=>selectMixFeedbackSentiment(btn.dataset.mixFeedbackSentiment));
});
document.querySelectorAll("[data-mix-feedback-tag]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    const tag=String(btn.dataset.mixFeedbackTag||"");
    if(!tag)return;
    if(mixFeedbackTags.has(tag))mixFeedbackTags.delete(tag);else mixFeedbackTags.add(tag);
    btn.classList.toggle("active",mixFeedbackTags.has(tag));
  });
});

async function sendMixFeedback(){
  const source=readyMix||job;
  const statusEl=q("#mixFeedbackStatus");
  const send=q("#mixFeedbackSend");
  if(!mixFeedbackSentiment){
    statusEl.textContent="👍 または 👎 を選んでください。";
    return;
  }
  if(!source?.id||!source?.token){
    statusEl.textContent="完成MIX情報を確認できません。";
    return;
  }
  send.disabled=true;
  send.textContent="送信中…";
  statusEl.textContent="";
  try{
    const res=await fetch(cfg.feedbackEndpoint,{
      method:"POST",
      headers:authHeaders(),
      body:JSON.stringify({
        service:"mix",
        job_id:source.id,
        access_token:source.token,
        sentiment:mixFeedbackSentiment,
        tags:Array.from(mixFeedbackTags),
        comment:q("#mixFeedbackComment")?.value||""
      })
    });
    const body=await res.json().catch(()=>({}));
    if(!res.ok){
      if(body.error==="not_completed")throw new Error("フル尺MIX完了後に送信できます。");
      throw new Error("送信できませんでした。");
    }
    sessionStorage.setItem("zasu_feedback_mix_"+source.id,String(mixFeedbackSentiment));
    statusEl.innerHTML="<strong>ありがとうございます。</strong> フィードバックを保存しました。";
    statusEl.className="handoff-status success";
    send.textContent="感想を送信しました";
    q("#mixFeedbackDetails").querySelectorAll("button,textarea").forEach(el=>el.disabled=true);
    document.querySelectorAll("[data-mix-feedback-sentiment]").forEach(el=>el.disabled=true);
  }catch(e){
    statusEl.textContent=window.ZASU_I18N.error(e,"mix");
    send.disabled=false;
    send.textContent="感想を送信";
  }
}
if(q("#mixFeedbackSend"))q("#mixFeedbackSend").addEventListener("click",sendMixFeedback);

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
    statusEl.textContent=window.ZASU_I18N.error(e,"mix");
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
    statusEl.textContent=window.ZASU_I18N.error(e,"mix");
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
      setProgress(10,"前回の処理を確認中","前回のMIX状況を確認しています。");
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
          else if(s.status!=="failed"){setProgress(Number(s.progress||10),"前回の処理を確認中","MIX状況を確認しています。");poll()}
        }).catch(()=>{});
      }
    }catch(_){sessionStorage.removeItem("zasu_mix_ready")}
  }
}
