const cfg=window.ZASU_MASTER_CONFIG||{};
const q=(s)=>document.querySelector(s);
const statusLabel=q("#statusLabel");
const resultState=q("#resultState");
const resultMessage=q("#resultMessage");
const metrics=q("#metrics");
const abArea=q("#abArea");
const beforeAudio=q("#beforeAudio");
const afterAudio=q("#afterAudio");
const actions=q("#resultActions");
const jobProgress=q("#jobProgress");
const jobProgressBar=q("#jobProgressBar");
const jobProgressText=q("#jobProgressText");
const feedbackCard=q("#feedbackCard");
const feedbackForm=q("#feedbackForm");
const feedbackStatus=q("#feedbackStatus");
const feedbackSubmit=q("#feedbackSubmit");
let pollTimer=null;
let accessToken=localStorage.getItem("zasu_beta_access_token")||"";
let applicationNo=Number(localStorage.getItem("zasu_beta_application_no")||0);

const handoffRaw=sessionStorage.getItem("zasu_result_handoff");
if(handoffRaw){
  sessionStorage.removeItem("zasu_result_handoff");
  try{
    const handoff=JSON.parse(handoffRaw);
    if(handoff&&Number.isFinite(Number(handoff.application_no))){
      applicationNo=Number(handoff.application_no);
      if(handoff.access_token)accessToken=String(handoff.access_token);
    }
  }catch(_){}
}

const stageLabels={
  waiting_upload:"音源アップロード待ち",
  queued:"処理キューで待機中",
  retrying:"一時エラーから自動再試行中",
  claimed:"処理サーバーを確保しました",
  downloading:"音源を処理サーバーへ転送中",
  mastering:"PUNCH ENGINEで解析・マスタリング中",
  processing:"PUNCH ENGINEで処理中",
  preparing_results:"完成音源を書き出しています",
  uploading_results:"完成音源を安全に保存しています",
  finalizing:"完成ファイルを検証しています",
  completed:"完了",
  failed:"処理失敗"
};

function setState(label,title,message){
  statusLabel.textContent=label;
  resultState.textContent=title;
  resultMessage.textContent=message||"";
}

function setProgress(body){
  if(!jobProgress)return;
  const s=body?.status;
  if(!["queued","processing"].includes(s)){
    jobProgress.hidden=true;
    return;
  }
  const p=Math.max(0,Math.min(100,Number(body.progress||0)));
  const stage=String(body.stage||s);
  jobProgress.hidden=false;
  jobProgressBar.style.width=p+"%";
  jobProgressText.textContent=(stageLabels[stage]||"処理中")+" — "+p+"%";
}

function clearResult(){
  metrics.hidden=true;
  abArea.hidden=true;
  actions.innerHTML="";
  if(jobProgress)jobProgress.hidden=true;
  if(feedbackCard)feedbackCard.hidden=true;
  beforeAudio.removeAttribute("src");
  afterAudio.removeAttribute("src");
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
  let body={};
  try{body=await res.json()}catch(_){}
  if(!res.ok){
    if(body.error==="application_not_found")throw new Error("受付番号が見つかりません。");
    throw new Error("処理状況の取得に失敗しました。");
  }
  return body;
}

function addRetryAction(){
  const a=document.createElement("a");
  a.className="btn secondary";
  a.href="upload.html";
  a.textContent="もう一度アップロード";
  actions.appendChild(a);
}

function render(body){
  clearResult();
  const s=body.status;
  const stage=String(body.stage||s||"");

  if(s==="waiting_upload"){
    setState("WAITING","音源待ち","UPLOAD MIXから音源を送ってください。");
    return false;
  }

  if(s==="queued"){
    if(stage==="retrying"){
      setState("RETRYING","自動再試行中",body.user_message||"一時的なエラーを検知しました。処理を自動でやり直しています。");
    }else{
      setState("QUEUED","処理待ち","音源を受け付けました。処理サーバーの空きを待っています。");
    }
    setProgress(body);
    return true;
  }

  if(s==="processing"){
    const message={
      claimed:"処理サーバーを確保しました。まもなく音源解析を開始します。",
      downloading:"アップロード済み音源を処理サーバーへ安全に転送しています。",
      mastering:"PUNCH ENGINEで音源を解析し、マスタリングしています。",
      processing:"PUNCH ENGINEで音源を処理しています。",
      preparing_results:"マスタリング済み音源と比較用プレビューを書き出しています。",
      uploading_results:"完成データを保存しています。大きなマスターは安全に分割保存されます。",
      finalizing:"完成ファイルを検証し、ダウンロードを準備しています。"
    }[stage]||"マスタリング処理を実行しています。このページは自動更新されます。";
    setState(stage.toUpperCase().replaceAll("_"," "),"マスタリング中",message);
    setProgress(body);
    return true;
  }

  if(s==="failed"){
    const ref=body.debug_ref?(" 参照ID: "+body.debug_ref):"";
    setState("FAILED","処理に失敗しました",(body.user_message||"処理を完了できませんでした。")+ref);
    addRetryAction();
    return false;
  }

  if(s==="expired"){
    setState("EXPIRED","ダウンロード期限終了","完成ファイルは保存期間を過ぎたため削除されました。");
    return false;
  }

  if(s==="completed"){
    setState("COMPLETED","MASTER READY.","PUNCH ENGINEの処理が完了しました。");
    if(feedbackCard)feedbackCard.hidden=false;
    metrics.hidden=false;
    q("#metricEngine").textContent=body.engine_version||"PUNCH";
    q("#metricLufs").textContent=Number.isFinite(body.output_lufs)?body.output_lufs.toFixed(2)+" LUFS":"—";
    q("#metricTp").textContent=Number.isFinite(body.output_dbtp)?body.output_dbtp.toFixed(2)+" dBTP":"—";

    if(body.fair_before_url&&body.fair_after_url){
      abArea.hidden=false;
      beforeAudio.src=body.fair_before_url;
      afterAudio.src=body.fair_after_url;
      for(const audio of [beforeAudio,afterAudio]){
        audio.preload="metadata";
        audio.load();
      }
    }

    if(body.download_url){
      const a=document.createElement("a");
      a.className="btn";
      a.href=body.download_url;
      a.textContent="DOWNLOAD 24-BIT WAV";
      actions.appendChild(a);
    }else if(body.download_ready&&cfg.workerBaseUrl){
      const a=document.createElement("button");
      a.className="btn";
      a.type="button";
      a.textContent="DOWNLOAD 24-BIT WAV";
      a.addEventListener("click",async()=>{
        a.disabled=true;
        a.textContent="PREPARING DOWNLOAD...";
        try{
          const res=await fetch(cfg.workerBaseUrl.replace(/\/$/,"")+"/download-ticket",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({application_no:Number(applicationNo),access_token:accessToken})
          });
          const d=await res.json();
          if(!res.ok||!d.url)throw new Error("download_not_ready");
          location.href=d.url;
        }catch(_){
          a.textContent="DOWNLOAD ERROR";
          setTimeout(()=>{a.disabled=false;a.textContent="DOWNLOAD 24-BIT WAV"},1800);
        }
      });
      actions.appendChild(a);
    }

    if(body.report_url){
      const a=document.createElement("a");
      a.className="btn secondary";
      a.href=body.report_url;
      a.textContent="REPORT";
      actions.appendChild(a);
    }
    return false;
  }

  setState("UNKNOWN","状態を確認中","少し待って再読み込みしてください。");
  return true;
}

async function check(){
  const no=Number(applicationNo);
  if(!Number.isFinite(no)||no<1||!accessToken){
    clearResult();
    setState("NO SESSION","新しく始めてください","このブラウザに有効なセッションがありません。");
    return;
  }

  try{
    const body=await post({application_no:no,access_token:accessToken});
    const shouldPoll=render(body);
    if(pollTimer)clearTimeout(pollTimer);
    if(shouldPoll)pollTimer=setTimeout(check,7000);
  }catch(err){
    clearResult();
    setState("RECONNECTING","接続を再確認中",(err?.message||"通信エラーが発生しました。")+" 自動で再接続します。");
    if(pollTimer)clearTimeout(pollTimer);
    pollTimer=setTimeout(check,15000);
  }
}

check();

if(feedbackForm){
  feedbackForm.addEventListener("submit",async(e)=>{
    e.preventDefault();
    const no=Number(applicationNo);
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
        headers:{
          "Content-Type":"application/json",
          "apikey":cfg.betaAnonKey,
          "Authorization":"Bearer "+cfg.betaAnonKey
        },
        body:JSON.stringify({
          application_no:no,
          access_token:accessToken,
          rating,
          better_than_original:better,
          would_use_again:again,
          had_problem:q("#feedbackProblem").checked,
          comment:q("#feedbackComment").value
        })
      });
      const body=await res.json().catch(()=>({}));
      if(!res.ok){
        if(body.error==="master_not_completed")throw new Error("マスタリング完了後に送信できます。");
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
