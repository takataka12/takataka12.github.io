const cfg=window.ZASU_MASTER_CONFIG||{};
const q=(s)=>document.querySelector(s);
const email=q("#resultEmail");
const applicationNo=q("#resultApplicationNo");
const button=q("#checkStatus");
const statusLabel=q("#statusLabel");
const resultState=q("#resultState");
const resultMessage=q("#resultMessage");
const metrics=q("#metrics");
const abArea=q("#abArea");
const beforeAudio=q("#beforeAudio");
const afterAudio=q("#afterAudio");
const actions=q("#resultActions");
let pollTimer=null;

email.value=localStorage.getItem("zasu_beta_email")||"";
applicationNo.value=localStorage.getItem("zasu_beta_application_no")||"";

function setState(label,title,message){
  statusLabel.textContent=label;
  resultState.textContent=title;
  resultMessage.textContent=message||"";
}
function clearResult(){
  metrics.hidden=true; abArea.hidden=true; actions.innerHTML="";
  beforeAudio.removeAttribute("src"); afterAudio.removeAttribute("src");
}
async function post(payload){
  const res=await fetch(cfg.masteringStatusEndpoint,{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "apikey":cfg.betaAnonKey,
      "Authorization":"Bearer "+cfg.betaAnonKey
    },
    body:JSON.stringify(payload)
  });
  let body={}; try{body=await res.json()}catch(_){}
  if(!res.ok){
    if(body.error==="application_not_found") throw new Error("受付番号またはメールアドレスが一致しません。");
    throw new Error("状況を取得できませんでした。");
  }
  return body;
}
function render(body){
  clearResult();
  const s=body.status;
  if(s==="waiting_upload"){
    setState("WAITING","音源待ち","決済済みの場合はUPLOAD MIXから音源を送ってください。");
    return false;
  }
  if(s==="queued"){
    setState("QUEUED","処理待ち","音源を受け付けました。PUNCH ENGINEの処理開始を待っています。");
    return true;
  }
  if(s==="processing"){
    setState("PROCESSING","マスタリング中","PUNCH ENGINEで解析・処理しています。このページは自動更新されます。");
    return true;
  }
  if(s==="failed"){
    setState("FAILED","処理に失敗しました","自動再試行後も完了しませんでした。運営側で確認します。");
    return false;
  }
  if(s==="expired"){
    setState("EXPIRED","ダウンロード期限終了","完成ファイルは24時間の保存期間を過ぎたため削除されました。");
    return false;
  }
  if(s==="completed"){
    setState("COMPLETED","MASTER READY.","PUNCH ENGINEの処理が完了しました。");
    metrics.hidden=false;
    q("#metricEngine").textContent=body.engine_version||"PUNCH";
    q("#metricLufs").textContent=Number.isFinite(body.output_lufs)?body.output_lufs.toFixed(2)+" LUFS":"—";
    q("#metricTp").textContent=Number.isFinite(body.output_dbtp)?body.output_dbtp.toFixed(2)+" dBTP":"—";
    if(body.fair_before_url&&body.fair_after_url){
      abArea.hidden=false;
      beforeAudio.src=body.fair_before_url;
      afterAudio.src=body.fair_after_url;
    }
    if(body.download_url){
      const a=document.createElement("a"); a.className="btn"; a.href=body.download_url; a.textContent="DOWNLOAD 24-BIT WAV"; actions.appendChild(a);
    }else if(body.download_ready&&cfg.workerBaseUrl){
      const a=document.createElement("button"); a.className="btn"; a.type="button"; a.textContent="DOWNLOAD 24-BIT WAV";
      a.addEventListener("click",async()=>{
        a.disabled=true; a.textContent="PREPARING DOWNLOAD...";
        try{
          const res=await fetch(cfg.workerBaseUrl.replace(/\/$/,"")+"/download-ticket",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({email:email.value.trim().toLowerCase(),application_no:Number(applicationNo.value)})
          });
          const d=await res.json();
          if(!res.ok||!d.url) throw new Error("download_not_ready");
          location.href=d.url;
        }catch(_){
          a.textContent="DOWNLOAD ERROR";
          setTimeout(()=>{a.disabled=false;a.textContent="DOWNLOAD 24-BIT WAV"},1800);
        }
      });
      actions.appendChild(a);
    }else if(body.download_ready){
      const span=document.createElement("span"); span.className="note"; span.textContent="完成WAVのダウンロード接続を準備中です。"; actions.appendChild(span);
    }
    if(body.report_url){
      const a=document.createElement("a"); a.className="btn secondary"; a.href=body.report_url; a.textContent="REPORT"; actions.appendChild(a);
    }
    return false;
  }
  setState("UNKNOWN","状態を確認中","少し待って再読み込みしてください。");
  return false;
}
async function check(){
  const e=email.value.trim().toLowerCase();
  const no=Number(applicationNo.value);
  if(!e||!Number.isFinite(no)||no<1){setState("ERROR","入力を確認してください","応募時のメールと受付番号が必要です。");return;}
  localStorage.setItem("zasu_beta_email",e);
  localStorage.setItem("zasu_beta_application_no",String(no));
  button.disabled=true; button.textContent="CHECKING...";
  try{
    const body=await post({email:e,application_no:no});
    const shouldPoll=render(body);
    if(pollTimer) clearTimeout(pollTimer);
    if(shouldPoll) pollTimer=setTimeout(check,12000);
  }catch(err){
    clearResult(); setState("ERROR","確認できません",err?.message||"エラーが発生しました。");
  }finally{
    button.disabled=false; button.textContent="CHECK STATUS";
  }
}
button.addEventListener("click",check);
if(email.value&&applicationNo.value) check();