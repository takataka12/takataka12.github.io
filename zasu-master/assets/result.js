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
const feedbackDetails=q("#feedbackDetails");
const feedbackPositiveTags=q("#feedbackPositiveTags");
const feedbackNegativeTags=q("#feedbackNegativeTags");
const feedbackSendV1=q("#feedbackSendV1");
const feedbackStatusV1=q("#feedbackStatusV1");
let feedbackSentiment=0;
const feedbackTags=new Set();
const previewMasterGate=q("#previewMasterGate");
const unlockMasterButton=q("#unlockMasterButton");
const unlockMasterStatus=q("#unlockMasterStatus");
const previewMasterGateCopy=q("#previewMasterGateCopy");
const devUnlockMasterButton=q("#devUnlockMasterButton");
const devMode=new URLSearchParams(location.search).get("dev")==="1";
let pollTimer=null;
let accessToken=localStorage.getItem("zasu_beta_access_token")||"";
let applicationNo=Number(localStorage.getItem("zasu_beta_application_no")||0);
let activeJobId=sessionStorage.getItem("zasu_result_job_id")||"";

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

function renderQueueStatus(body){
  const box=q("#queueStatus");
  if(!box)return;
  box.classList.remove("ready","processing","waiting");
  if(!body||!["queued","processing"].includes(String(body.status||""))){
    box.hidden=true;
    return;
  }
  box.hidden=false;
  if(body.status==="processing"){
    box.classList.add("processing");
    q("#queueHeadline").textContent="処理中";
    const waiting=Number(body.queue_waiting_total||0);
    q("#queueDetail").textContent=waiting>0?"処理中 / 後ろに待機 "+waiting+"件":"処理サーバーで実行中です。";
    return;
  }
  const ahead=Math.max(0,Number(body.jobs_ahead||0));
  const pos=Math.max(1,Number(body.queue_position||1));
  if(ahead===0){
    box.classList.add("ready");
    q("#queueHeadline").textContent="まもなく処理を開始";
    q("#queueDetail").textContent="待機なし。次に処理されます。";
  }else{
    box.classList.add("waiting");
    q("#queueHeadline").textContent="待ち順："+pos;
    q("#queueDetail").textContent="あなたの前に "+ahead+"件 / 現在の待機 "+Number(body.queue_waiting_total||0)+"件";
  }
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
  if(q("#queueStatus"))q("#queueStatus").hidden=true;
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
  renderQueueStatus(body);
  if(body?.job_id){
    activeJobId=String(body.job_id);
    sessionStorage.setItem("zasu_result_job_id",activeJobId);
  }
  const s=body.status;
  const stage=String(body.stage||s||"");

  if(s==="waiting_upload"){
    setState("音源待ち","音源待ち","UPLOAD MIXから音源を送ってください。");
    return false;
  }

  if(s==="queued"){
    const isPreview=body.processing_mode==="preview";
    if(stage==="retrying"){
      setState("再試行中",isPreview?"無料プレビューを再試行中":"自動再試行中",body.user_message||"一時的なエラーを検知しました。処理を自動でやり直しています。");
    }else{
      setState(
        isPreview?"無料試聴 / 処理待ち":"処理待ち",
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
      isPreview?"30秒無料試聴を作成中":(stageLabels[stage]||"マスタリング処理中"),
      isPreview?"無料MASTER試聴を作成中":"マスタリング中",
      message
    );
    setProgress(body);
    return true;
  }

  if(s==="failed"){
    const ref=body.debug_ref?(" 参照ID: "+body.debug_ref):"";
    setState("処理失敗","処理に失敗しました",window.ZASU_I18N.error(body.error_code||body.user_message,"master")+ref);
    addRetryAction();
    return false;
  }

  if(s==="expired"){
    setState("保存期限終了","ダウンロード期限終了","完成ファイルは保存期間を過ぎたため削除されました。");
    return false;
  }

  if(s==="completed"){
    const isPreview=body.processing_mode==="preview";
    setState(
      isPreview?"無料試聴完成":"完了",
      isPreview?"30秒の無料試聴が完成しました":"マスタリングが完成しました",
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
          unlockMasterButton.textContent=window.ZASU_I18N.t("buyMaster");
          previewMasterGateCopy.textContent="ここまでの30秒試聴は無料です。フル尺MASTERはSquare決済 ¥500 の後に処理します。";
        }else{
          unlockMasterButton.textContent="フル尺MASTERを作成（無料公開時のみ）";
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
      a.textContent=window.ZASU_I18N.t("downloadMaster");
      actions.appendChild(a);
    }else if(body.download_ready&&cfg.workerBaseUrl){
      const a=document.createElement("button");
      a.className="btn";
      a.type="button";
      a.textContent=window.ZASU_I18N.t("downloadMaster");
      a.addEventListener("click",async()=>{
        a.disabled=true;
        a.textContent="ダウンロードを準備中…";
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
          a.textContent="ダウンロード失敗：通信・期限を確認";
          setTimeout(()=>{a.disabled=false;a.textContent=window.ZASU_I18N.t("downloadMaster")},1800);
        }
      });
      actions.appendChild(a);
    }

    if(body.job_id){
      const c=document.createElement("button");
      c.className="btn secondary";
      c.type="button";
      c.textContent="CONVERTで形式を変換";
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
      a.textContent="処理レポート";
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
          if(body.job_id){
            activeJobId=String(body.job_id);
            sessionStorage.setItem("zasu_result_job_id",activeJobId);
          }
          if(previewMasterGate)previewMasterGate.hidden=true;
          setState("処理待ち","フル尺処理待ち","FULL PROCESSのMASTERクレジットを使って開始します。");
          setTimeout(check,800);
          return;
        }
        if(!["credit_required","wrong_source","payment_required"].includes(String(body.error||"")))throw new Error(body.error||"unlock_failed");
      }catch(e){
        if(unlockMasterStatus)unlockMasterStatus.textContent=window.ZASU_I18N.error(e,"master");
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
    if(body.job_id){
      activeJobId=String(body.job_id);
      sessionStorage.setItem("zasu_result_job_id",activeJobId);
    }
    if(previewMasterGate)previewMasterGate.hidden=true;
    if(unlockMasterStatus)unlockMasterStatus.textContent="";
    setState("処理待ち","フル尺処理待ち","プレビュー確認済み。フル尺マスタリングを開始します。");
    setTimeout(check,800);
  }catch(e){
    if(unlockMasterStatus)unlockMasterStatus.textContent=window.ZASU_I18N.error(e,"master");
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
    if(body.job_id){
      activeJobId=String(body.job_id);
      sessionStorage.setItem("zasu_result_job_id",activeJobId);
    }
    if(previewMasterGate)previewMasterGate.hidden=true;
    if(unlockMasterStatus)unlockMasterStatus.textContent="";
    setState("DEV / QUEUED","DEV FULL MASTER 処理待ち","管理者DEVモードで決済をスキップし、フル尺マスタリングを開始します。");
    setTimeout(check,800);
  }catch(e){
    if(unlockMasterStatus)unlockMasterStatus.textContent=window.ZASU_I18N.error(e,"master");
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
    const body=await post({
      application_no:no,
      access_token:accessToken,
      ...(activeJobId?{job_id:activeJobId}:{})
    });
    const shouldPoll=render(body);
    if(pollTimer)clearTimeout(pollTimer);
    if(shouldPoll)pollTimer=setTimeout(check,7000);
  }catch(err){
    clearResult();
    setState("RECONNECTING","接続を再確認中",(window.ZASU_I18N.error(err,"master"))+" 自動で再接続します。");
    if(pollTimer)clearTimeout(pollTimer);
    pollTimer=setTimeout(check,15000);
  }
}

check();

function selectFeedbackSentiment(value){
  feedbackSentiment=Number(value);
  feedbackTags.clear();
  document.querySelectorAll("[data-feedback-sentiment]").forEach(btn=>{
    btn.classList.toggle("active",Number(btn.dataset.feedbackSentiment)===feedbackSentiment);
  });
  document.querySelectorAll("[data-feedback-tag]").forEach(btn=>btn.classList.remove("active"));
  if(feedbackDetails)feedbackDetails.hidden=false;
  if(feedbackPositiveTags)feedbackPositiveTags.hidden=feedbackSentiment!==1;
  if(feedbackNegativeTags)feedbackNegativeTags.hidden=feedbackSentiment!==-1;
  if(feedbackStatusV1){feedbackStatusV1.textContent="";feedbackStatusV1.className="mini feedback-status";}
}
document.querySelectorAll("[data-feedback-sentiment]").forEach(btn=>{
  btn.addEventListener("click",()=>selectFeedbackSentiment(btn.dataset.feedbackSentiment));
});
document.querySelectorAll("[data-feedback-tag]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    const tag=String(btn.dataset.feedbackTag||"");
    if(!tag)return;
    if(feedbackTags.has(tag))feedbackTags.delete(tag);else feedbackTags.add(tag);
    btn.classList.toggle("active",feedbackTags.has(tag));
  });
});

async function sendFeedbackV1(){
  const no=Number(applicationNo);
  if(!feedbackSentiment){
    if(feedbackStatusV1)feedbackStatusV1.textContent="👍 または 👎 を選んでください。";
    return;
  }
  if(!activeJobId||!Number.isFinite(no)||no<1||!accessToken){
    if(feedbackStatusV1)feedbackStatusV1.textContent="完成MASTER情報を確認できません。";
    return;
  }
  feedbackSendV1.disabled=true;
  feedbackSendV1.textContent="送信中…";
  if(feedbackStatusV1)feedbackStatusV1.textContent="";
  try{
    const res=await fetch(cfg.feedbackEndpoint,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "apikey":cfg.betaAnonKey,
        "Authorization":"Bearer "+cfg.betaAnonKey
      },
      body:JSON.stringify({
        service:"master",
        job_id:activeJobId,
        application_no:no,
        access_token:accessToken,
        sentiment:feedbackSentiment,
        tags:Array.from(feedbackTags),
        comment:q("#feedbackCommentV1")?.value||""
      })
    });
    const body=await res.json().catch(()=>({}));
    if(!res.ok){
      if(body.error==="not_completed")throw new Error("フル尺MASTER完了後に送信できます。");
      throw new Error("送信できませんでした。");
    }
    sessionStorage.setItem("zasu_feedback_master_"+activeJobId,String(feedbackSentiment));
    if(feedbackStatusV1){
      feedbackStatusV1.innerHTML="<strong>ありがとうございます。</strong> フィードバックを保存しました。";
      feedbackStatusV1.className="mini feedback-status success";
    }
    feedbackSendV1.textContent="感想を送信しました";
    if(feedbackDetails)feedbackDetails.querySelectorAll("button,textarea").forEach(el=>el.disabled=true);
    document.querySelectorAll("[data-feedback-sentiment]").forEach(el=>el.disabled=true);
  }catch(err){
    if(feedbackStatusV1)feedbackStatusV1.textContent=window.ZASU_I18N.error(err,"master");
    feedbackSendV1.disabled=false;
    feedbackSendV1.textContent="感想を送信";
  }
}
if(feedbackSendV1)feedbackSendV1.addEventListener("click",sendFeedbackV1);
