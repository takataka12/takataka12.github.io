const cfg=window.ZASU_MASTER_CONFIG||{};
const q=(s)=>document.querySelector(s);
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
const feedbackCard=q("#feedbackCard");
const feedbackForm=q("#feedbackForm");
const feedbackStatus=q("#feedbackStatus");
const feedbackSubmit=q("#feedbackSubmit");
let pollTimer=null;let accessToken=localStorage.getItem("zasu_beta_access_token")||"";

// Result pages never restore old application data from localStorage.
// Only an explicit handoff from the upload flow may prefill this page.
const handoffRaw=sessionStorage.getItem("zasu_result_handoff");
if(handoffRaw){
  sessionStorage.removeItem("zasu_result_handoff");
  try{
    const handoff=JSON.parse(handoffRaw);
    if(handoff&&Number.isFinite(Number(handoff.application_no))){applicationNo.value=String(Number(handoff.application_no));if(handoff.access_token)accessToken=String(handoff.access_token);}
  }catch(_){}
}

function setState(label,title,message){
  statusLabel.textContent=label;
  resultState.textContent=title;
  resultMessage.textContent=message||"";
}
function clearResult(){
  metrics.hidden=true; abArea.hidden=true; actions.innerHTML="";
  if(feedbackCard) feedbackCard.hidden=true;
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
    if(body.error==="application_not_found") throw new Error("受付番号が見つかりません。");
    throw new Error("状況を取得できませんでした。");
  }
  return body;
}
function render(body){
  clearResult();
  const s=body.status;
  if(s==="waiting_upload"){
    setState("WAITING","音源待ち","UPLOAD MIXから音源を送ってください。");
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
    if(feedbackCard) feedbackCard.hidden=false;
    metrics.hidden=false;
    q("#metricEngine").textContent=body.engine_version||"PUNCH";
    q("#metricLufs").textContent=Number.isFinite(body.output_lufs)?body.output_lufs.toFixed(2)+" LUFS":"—";
    q("#metricTp").textContent=Number.isFinite(body.output_dbtp)?body.output_dbtp.toFixed(2)+" dBTP":"—";
    if(body.fair_before_url&&body.fair_after_url){
      abArea.hidden=false;
      beforeAudio.src=body.fair_before_url;
      afterAudio.src=body.fair_after_url;
      // iOS Safari can leave dynamically assigned audio at 00:00 until load()
      // is explicitly requested. preload=metadata makes duration available quickly.
      for(const audio of [beforeAudio,afterAudio]){
        audio.preload="metadata";
        audio.load();
      }
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
            body:JSON.stringify({application_no:Number(applicationNo.value),access_token:accessToken})
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
  const no=Number(applicationNo.value);if(!Number.isFinite(no)||no<1){setState("ERROR","入力を確認してください","受付番号が必要です。");return;}
  button.disabled=true; button.textContent="CHECKING...";
  try{
    const body=await post({application_no:no,access_token:accessToken});
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
// Intentionally no automatic check on page load.

if(feedbackForm){
  feedbackForm.addEventListener("submit",async(e)=>{
    e.preventDefault();
    const no=Number(applicationNo.value);
    const rating=Number(q("#feedbackRating").value);
    const better=q("#feedbackBetter").value;
    const again=q("#feedbackAgain").value;
    if(!Number.isFinite(no)||no<1||!rating||!better||!again){
      feedbackStatus.textContent="評価項目を選択してください。";
      return;
    }
    feedbackSubmit.disabled=true;
    feedbackSubmit.textContent="SENDING...";
    feedbackStatus.textContent="";
    try{
      const res=await fetch(cfg.feedbackEndpoint,{
        method:"POST",
        headers:{"Content-Type":"application/json","apikey":cfg.betaAnonKey,"Authorization":"Bearer "+cfg.betaAnonKey},
        body:JSON.stringify({
application_no:no,
          rating,
          better_than_original:better,
          would_use_again:again,
          had_problem:q("#feedbackProblem").checked,
          comment:q("#feedbackComment").value
        })
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok){
        if(body.error==="master_not_completed") throw new Error("マスタリング完了後に送信できます。");
        throw new Error("送信できませんでした。");
      }
      feedbackStatus.innerHTML="<strong>THANK YOU.</strong> フィードバックを保存しました。";
      feedbackSubmit.textContent="FEEDBACK SENT";
      feedbackForm.querySelectorAll("select,textarea,input,button").forEach(el=>el.disabled=true);
    }catch(err){
      feedbackStatus.textContent=err?.message||"送信できませんでした。";
      feedbackSubmit.disabled=false;
      feedbackSubmit.textContent="SEND FEEDBACK";
    }
  });
}