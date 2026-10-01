const cfg=window.ZASU_MASTER_CONFIG||{};
const q=(s)=>document.querySelector(s);
const statusLabel=q("#statusLabel");
const resultState=q("#resultState");
const resultMessage=q("#resultMessage");
const metrics=q("#metrics");
const abArea=q("#abArea");
const afterAudio=q("#afterAudio");
const actions=q("#resultActions");
const jobProgress=q("#jobProgress");
const jobProgressBar=q("#jobProgressBar");
const jobProgressText=q("#jobProgressText");
const feedbackCard=q("#feedbackCard");
const feedbackForm=q("#feedbackForm");
const feedbackStatus=q("#feedbackStatus");
const feedbackSubmit=q("#feedbackSubmit");
const previewMasterGate=q("#previewMasterGate");
const unlockMasterButton=q("#unlockMasterButton");
const unlockMasterStatus=q("#unlockMasterStatus");
const previewMasterGateCopy=q("#previewMasterGateCopy");
const devUnlockMasterButton=q("#devUnlockMasterButton");
const devMode=new URLSearchParams(location.search).get("dev")==="1";
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
  preview_select:"30秒の試聴区間を準備中",
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
  if(previewMasterGate)previewMasterGate.hidden=true;
  if(devUnlockMasterButton)devUnlockMasterButton.hidden=true;
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
    const isPreview=body.processing_mode==="preview";
    if(stage==="retrying"){
      setState("RETRYING",isPreview?"無料プレビューを再試行中":"自動再試行中",body.user_message||"一時的なエラーを検知しました。処理を自動でやり直しています。");
    }else{
      setState(
        isPreview?"FREE PREVIEW / QUEUED":"QUEUED",
        isPreview?"30秒MASTER試聴の処理待ち":"処理待ち",
        isPreview
          ?"これは無料の30秒プレビューです。フル尺MASTERは試聴後に¥500で解放できます。"
          :"音源を受け付けました。処理サーバーの空きを待っています。"
      );
    }
    setProgress(body);
    return true;
  }

  if(s==="processing"){
    const isPreview=body.processing_mode==="preview";
    const message=isPreview
      ? ({
          claimed:"無料30秒プレビュー用の処理サーバーを確保しました。",
          downloading:"音源から試聴用データを準備しています。",
          preview_select:"30秒の試聴区間を選んでいます。",
          mastering:(body.mastering_profile==="loud_otv"?"LOUD / OTVの30秒プレビューを作成しています。":"STANDARDの30秒プレビューを作成しています。"),
          processing:"30秒のMASTERプレビューを処理しています。",
          preparing_results:"30秒MASTER試聴を書き出しています。",
          uploading_results:"無料プレビューを保存しています。",
          finalizing:"30秒プレビューを最終確認しています。"
        }[stage]||"無料30秒MASTERプレビューを作成しています。")
      : ({
          claimed:"処理サーバーを確保しました。まもなく音源解析を開始します。",
          downloading:"アップロード済み音源を処理サーバーへ安全に転送しています。",
          mastering:(body.mastering_profile==="loud_otv"?"LOUD / OTVプロファイルで高密度マスタリングしています。":"PUNCH ENGINEで音源を解析し、マスタリングしています。"),
          processing:"PUNCH ENGINEで音源を処理しています。",
          preparing_results:"最終MASTERを書き出しています。",
          uploading_results:"完成データを保存しています。大きなマスターは安全に分割保存されます。",
          finalizing:"完成ファイルを検証し、ダウンロードを準備しています。"
        }[stage]||"マスタリング処理を実行しています。このページは自動更新されます。");
    setState(
      isPreview?"FREE 30 SEC PREVIEW":stage.toUpperCase().replaceAll("_"," "),
      isPreview?"無料MASTER試聴を作成中":"マスタリング中",
      message
    );
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
    const isPreview=body.processing_mode==="preview";
    setState(
      isPreview?"PREVIEW READY":"COMPLETED",
      isPreview?"30 SEC PREVIEW READY.":"MASTER READY.",
      isPreview
        ? (body.profile_label||"STANDARD")+" の30秒MASTER試聴が完成しました。気に入ったらフル尺へ進めます。"
        : (body.profile_label||"STANDARD")+" のマスタリングが完了しました。"
    );
    if(feedbackCard)feedbackCard.hidden=isPreview;
    metrics.hidden=false;
    q("#metricEngine").textContent=(body.engine_version||"PUNCH")+" / "+(body.profile_label||"STANDARD");
    q("#metricLufs").textContent=Number.isFinite(body.output_lufs)?body.output_lufs.toFixed(2)+" LUFS":"—";
    q("#metricTp").textContent=Number.isFinite(body.output_dbtp)?body.output_dbtp.toFixed(2)+" dBTP":"—";

    if(isPreview&&body.preview_url){
      abArea.hidden=false;
      afterAudio.src=body.preview_url;
      afterAudio.preload="metadata";
      afterAudio.load();
    }

    if(isPreview){
      if(previewMasterGate){
        previewMasterGate.hidden=false;
        if(cfg.commerceEnabled){
          unlockMasterButton.textContent="BUY FULL MASTER — ¥500";
          previewMasterGateCopy.textContent="ここまでの30秒試聴は無料です。フル尺MASTERはSquare決済 ¥500 の後に処理します。";
        }else{
          unlockMasterButton.textContent="CREATE FULL MASTER — FREE BETA";
          previewMasterGateCopy.textContent="OPEN BETA中は決済なしでフル尺処理できます。";
        }
        unlockMasterButton.dataset.previewJobId=String(body.job_id||"");
        if(devUnlockMasterButton){
          devUnlockMasterButton.dataset.previewJobId=String(body.job_id||"");
          devUnlockMasterButton.hidden=!devMode;
        }
      }
      return false;
    }

    if(body.download_url){
      const a=document.createElement("a");
      a.className="btn";
      a.href=body.download_url;
      a.textContent="DOWNLOAD FINAL 24-BIT WAV";
      actions.appendChild(a);
    }else if(body.download_ready&&cfg.workerBaseUrl){
      const a=document.createElement("button");
      a.className="btn";
      a.type="button";
      a.textContent="DOWNLOAD FINAL 24-BIT WAV";
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
          setTimeout(()=>{a.disabled=false;a.textContent="DOWNLOAD FINAL 24-BIT WAV"},1800);
        }
      });
      actions.appendChild(a);
    }

    if(body.job_id){
      const c=document.createElement("button");
      c.className="btn secondary";
      c.type="button";
      c.textContent="OPEN IN ZASU CONVERT";
      c.addEventListener("click",()=>{
        sessionStorage.setItem("zasu_convert_master_handoff",JSON.stringify({
          application_no:Number(applicationNo),
          access_token:accessToken,
          master_job_id:String(body.job_id),
          profile_label:body.profile_label||"STANDARD"
        }));
        location.href="convert/";
      });
      actions.appendChild(c);
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

async function unlockMasterFull(){
  const previewJobId=String(unlockMasterButton?.dataset.previewJobId||"");
  if(!previewJobId){if(unlockMasterStatus)unlockMasterStatus.textContent="プレビュージョブが見つかりません。";return}
  if(cfg.commerceEnabled){
    let existingCheckout=null;
    try{existingCheckout=JSON.parse(localStorage.getItem("zasu_audio_checkout")||"null")}catch(_){}
    if(existingCheckout?.plan==="full"&&existingCheckout?.order_id&&existingCheckout?.order_access_token){
      unlockMasterButton.disabled=true;
      if(unlockMasterStatus)unlockMasterStatus.textContent="FULL PROCESSのMASTERクレジットを確認しています…";
      try{
        const res=await fetch(cfg.unlockMasterFullEndpoint,{
          method:"POST",
          headers:{"Content-Type":"application/json","apikey":cfg.betaAnonKey,"Authorization":"Bearer "+cfg.betaAnonKey},
          body:JSON.stringify({
            application_no:Number(applicationNo),
            access_token:accessToken,
            preview_job_id:previewJobId,
            order_id:existingCheckout.order_id,
            order_access_token:existingCheckout.order_access_token
          })
        });
        const body=await res.json().catch(()=>({}));
        if(res.ok){
          if(previewMasterGate)previewMasterGate.hidden=true;
          setState("QUEUED","フル尺処理待ち","FULL PROCESSのMASTERクレジットを使って開始します。");
          setTimeout(check,800);
          return;
        }
        if(!["credit_required","wrong_source","payment_required"].includes(String(body.error||"")))throw new Error(body.error||"unlock_failed");
      }catch(e){
        if(unlockMasterStatus)unlockMasterStatus.textContent=e?.message||"クレジット確認に失敗しました。";
        unlockMasterButton.disabled=false;
        return;
      }
      unlockMasterButton.disabled=false;
    }
    localStorage.setItem("zasu_pending_unlock",JSON.stringify({
      type:"master",plan:"master",preview_job_id:previewJobId,
      application_no:Number(applicationNo),access_token:accessToken,created_at:Date.now()
    }));
    location.href="checkout.html?plan=master&source=master";
    return;
  }
  unlockMasterButton.disabled=true;
  if(unlockMasterStatus)unlockMasterStatus.textContent="フル尺マスタリングを準備しています…";
  try{
    const res=await fetch(cfg.unlockMasterFullEndpoint,{
      method:"POST",
      headers:{"Content-Type":"application/json","apikey":cfg.betaAnonKey,"Authorization":"Bearer "+cfg.betaAnonKey},
      body:JSON.stringify({
        application_no:Number(applicationNo),
        access_token:accessToken,
        preview_job_id:previewJobId
      })
    });
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body.error||"unlock_failed");
    if(previewMasterGate)previewMasterGate.hidden=true;
    if(unlockMasterStatus)unlockMasterStatus.textContent="";
    setState("QUEUED","フル尺処理待ち","プレビュー確認済み。フル尺マスタリングを開始します。");
    setTimeout(check,800);
  }catch(e){
    if(unlockMasterStatus)unlockMasterStatus.textContent=e?.message||"フル尺処理を開始できませんでした。";
    unlockMasterButton.disabled=false;
  }
}
if(unlockMasterButton)unlockMasterButton.addEventListener("click",unlockMasterFull);

async function unlockMasterDev(){
  const previewJobId=String(devUnlockMasterButton?.dataset.previewJobId||"");
  if(!devMode||!previewJobId){
    if(unlockMasterStatus)unlockMasterStatus.textContent="DEVプレビュージョブが見つかりません。";
    return;
  }
  let adminKey=sessionStorage.getItem("zasu_dev_admin_key")||"";
  if(!adminKey){
    adminKey=window.prompt("ZASU DEV ADMIN KEY")||"";
    if(!adminKey)return;
    sessionStorage.setItem("zasu_dev_admin_key",adminKey);
  }

  devUnlockMasterButton.disabled=true;
  if(unlockMasterButton)unlockMasterButton.disabled=true;
  if(unlockMasterStatus)unlockMasterStatus.textContent="DEV MODE — 決済なしでフル尺MASTERを開始しています…";

  try{
    const res=await fetch(cfg.unlockMasterFullEndpoint,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "apikey":cfg.betaAnonKey,
        "Authorization":"Bearer "+cfg.betaAnonKey,
        "x-zasu-admin-key":adminKey
      },
      body:JSON.stringify({
        application_no:Number(applicationNo),
        access_token:accessToken,
        preview_job_id:previewJobId,
        dev_mode:true
      })
    });
    const body=await res.json().catch(()=>({}));
    if(!res.ok){
      if(res.status===401||body.error==="dev_unauthorized"){
        sessionStorage.removeItem("zasu_dev_admin_key");
        throw new Error("管理者キーが違います。");
      }
      throw new Error(body.error||"dev_unlock_failed");
    }
    if(previewMasterGate)previewMasterGate.hidden=true;
    if(unlockMasterStatus)unlockMasterStatus.textContent="";
    setState("DEV / QUEUED","DEV FULL MASTER 処理待ち","管理者DEVモードで決済をスキップし、フル尺マスタリングを開始します。");
    setTimeout(check,800);
  }catch(e){
    if(unlockMasterStatus)unlockMasterStatus.textContent=e?.message||"DEVフル尺処理を開始できませんでした。";
    devUnlockMasterButton.disabled=false;
    if(unlockMasterButton)unlockMasterButton.disabled=false;
  }
}
if(devUnlockMasterButton)devUnlockMasterButton.addEventListener("click",unlockMasterDev);

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
