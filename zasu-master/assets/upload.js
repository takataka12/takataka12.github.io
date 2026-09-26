import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.95.0/+esm";

const cfg=window.ZASU_MASTER_CONFIG||{};
const q=(s)=>document.querySelector(s);
const email=q("#uploadEmail");
const applicationNo=q("#applicationNo");
const savedApplication=q("#savedApplication");
const recoveryDetails=q("#recoveryDetails");
const fileInput=q("#mixFile");
const dropzone=q("#dropzone");
const fileMeta=q("#fileMeta");
const button=q("#uploadButton");
const status=q("#uploadStatus");
const progress=q("#uploadProgress");
const paymentNotice=q("#paymentNotice");
let selectedFile=null;
let paymentReady=false;
let paymentCheckTimer=null;

const savedEmail=localStorage.getItem("zasu_beta_email")||"";
const savedNo=localStorage.getItem("zasu_beta_application_no")||"";
email.value=savedEmail;
applicationNo.value=savedNo;

function renderApplicationState(){
  const e=(email.value||"").trim();
  const no=Number(applicationNo.value);
  const ready=e&&Number.isFinite(no)&&no>0;
  if(savedApplication){
    savedApplication.innerHTML=ready
      ? '<strong>受付番号 #'+no+'</strong><br>申込情報を確認しました。受付番号の再入力は不要です。'
      : 'このブラウザに受付情報がありません。下の「別の端末・ブラウザから利用する」から受付情報を入力してください。';
  }
  if(recoveryDetails) recoveryDetails.open=!ready;
}
renderApplicationState();

async function checkPaymentStatus(attempt=0){
  const e=(email.value||"").trim().toLowerCase();
  const no=Number(applicationNo.value);
  if(!e||!Number.isFinite(no)||no<1){ paymentReady=false; return; }
  try{
    const res=await fetch(cfg.paymentStatusEndpoint,{
      method:"POST",
      headers:{"Content-Type":"application/json","apikey":cfg.betaAnonKey,"Authorization":"Bearer "+cfg.betaAnonKey},
      body:JSON.stringify({email:e,application_no:no})
    });
    const body=await res.json().catch(()=>({}));
    if(res.ok&&body.paid){
      paymentReady=true;
      if(paymentNotice) paymentNotice.innerHTML='<strong>PAYMENT CONFIRMED.</strong><br>¥500の決済を確認しました。MIXを選んでそのままアップロードできます。';
      if(paymentCheckTimer) clearTimeout(paymentCheckTimer);
      return;
    }
    paymentReady=false;
    if(attempt<10){
      if(paymentNotice) paymentNotice.textContent="Squareの決済完了を確認しています…";
      paymentCheckTimer=setTimeout(()=>checkPaymentStatus(attempt+1),2000);
    }else if(paymentNotice){
      paymentNotice.textContent="決済確認に少し時間がかかっています。画面はそのままでお待ちいただくか、受付情報をご確認ください。";
    }
  }catch(_){
    if(attempt<10) paymentCheckTimer=setTimeout(()=>checkPaymentStatus(attempt+1),2000);
  }
}
checkPaymentStatus();
email.addEventListener("input",()=>{renderApplicationState();checkPaymentStatus(0)});
applicationNo.addEventListener("input",()=>{renderApplicationState();checkPaymentStatus(0)});

function humanBytes(n){
  if(n<1024*1024)return (n/1024).toFixed(1)+" KB";
  return (n/(1024*1024)).toFixed(1)+" MB";
}
function validateFile(file){
  if(!file) throw new Error("WAVまたはFLACを選択してください。");
  const ext=(file.name.split(".").pop()||"").toLowerCase();
  if(!["wav","wave","flac"].includes(ext)) throw new Error("現在対応しているのはWAV / FLACです。");
  const max=cfg.workerBaseUrl?(cfg.workerUploadMaxBytes||1073741824):(cfg.uploadMaxBytes||52428800);
  if(file.size>max) throw new Error(cfg.workerBaseUrl?"ファイルが1GBを超えています。":"このβ環境では50MBまでです。大きい場合はFLAC化するか、本番ストレージ対応をお待ちください。");
}
function setFile(file){
  try{
    validateFile(file);
    selectedFile=file;
    fileMeta.textContent=file.name+" — "+humanBytes(file.size);
    status.textContent="";
  }catch(err){
    selectedFile=null;
    fileInput.value="";
    fileMeta.textContent="ファイルはまだ選択されていません。";
    status.textContent=err.message;
  }
}
fileInput.addEventListener("change",()=>setFile(fileInput.files?.[0]));
["dragenter","dragover"].forEach(ev=>dropzone.addEventListener(ev,e=>{e.preventDefault();dropzone.classList.add("drag")}));
["dragleave","drop"].forEach(ev=>dropzone.addEventListener(ev,e=>{e.preventDefault();dropzone.classList.remove("drag")}));
dropzone.addEventListener("drop",e=>setFile(e.dataTransfer?.files?.[0]));

async function edgePost(url,payload){
  const res=await fetch(url,{
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
    const map={
      beta_application_not_found:"受付番号またはメールアドレスが一致しません。",
      beta_not_accepted:"この受付番号はまだβ参加枠に入っていません。",
      payment_required:"Squareで¥500のお支払い完了がまだ確認できていません。決済直後の場合は数秒待ってもう一度お試しください。",
      upload_limit_reached:"この受付番号はすでに1曲アップロード済みです。",
      file_too_large:"ファイルが50MBを超えています。",
      unsupported_file_type:"現在対応しているのはWAV / FLACです。"
    };
    throw new Error(map[body.error]||"処理に失敗しました。時間を置いてもう一度お試しください。");
  }
  return body;
}

button.addEventListener("click",async()=>{
  status.textContent="";
  try{
    validateFile(selectedFile);
    const e=email.value.trim().toLowerCase();
    const no=Number(applicationNo.value);
    if(!e||!Number.isFinite(no)||no<1){ if(recoveryDetails) recoveryDetails.open=true; throw new Error("このブラウザに受付情報がありません。応募時のメールと受付番号を入力してください。"); }

    localStorage.setItem("zasu_beta_email",e);
    localStorage.setItem("zasu_beta_application_no",String(no));

    button.disabled=true;
    button.textContent="PREPARING...";
    progress.classList.add("active");
    status.textContent="β参加情報を確認しています…";

    if(cfg.workerBaseUrl){
      const base=cfg.workerBaseUrl.replace(/\/$/,"");
      const ticketRes=await fetch(base+"/upload-ticket",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          email:e,
          application_no:no,
          original_name:selectedFile.name,
          bytes:selectedFile.size,
          mime_type:selectedFile.type||"application/octet-stream"
        })
      });
      let ticket={}; try{ticket=await ticketRes.json()}catch(_){}
      if(!ticketRes.ok){
        const detail=ticket.detail||"";
        const map={
          payment_required:"Squareで¥500のお支払い完了がまだ確認できていません。決済直後の場合は数秒待ってください。",
          application_not_found:"受付番号またはメールアドレスが一致しません。",
          upload_limit_reached:"この受付番号はすでに1曲アップロード済みです。",
          unsupported_file_type:"現在対応しているのはWAV / FLACです。"
        };
        throw new Error(map[detail]||"アップロード準備に失敗しました。");
      }

      status.textContent="音源を非公開ストレージへアップロードしています…";
      button.textContent="UPLOADING...";
      const putRes=await fetch(ticket.url,{
        method:"PUT",
        headers:{"Content-Type":ticket.content_type},
        body:selectedFile
      });
      if(!putRes.ok) throw new Error("音源アップロードに失敗しました。");

      status.textContent="アップロードを確認しています…";
      button.textContent="VERIFYING...";
      const doneRes=await fetch(base+"/upload-complete",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({email:e,application_no:no,upload_id:ticket.upload_id})
      });
      let done={}; try{done=await doneRes.json()}catch(_){}
      if(!doneRes.ok) throw new Error(done.detail==="size_mismatch"?"アップロードサイズの確認に失敗しました。":"アップロード確認に失敗しました。");
    }else{
      const ticket=await edgePost(cfg.createMixUploadEndpoint,{
        email:e,
        application_no:no,
        original_name:selectedFile.name,
        bytes:selectedFile.size,
        mime_type:selectedFile.type||"application/octet-stream"
      });

      status.textContent="音源を非公開ストレージへアップロードしています…";
      button.textContent="UPLOADING...";

      const supabase=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
      const {error:uploadError}=await supabase.storage
        .from(ticket.bucket)
        .uploadToSignedUrl(ticket.path,ticket.token,selectedFile,{
          contentType:selectedFile.type||"application/octet-stream",
          upsert:false
        });
      if(uploadError) throw uploadError;

      status.textContent="アップロードを確認しています…";
      button.textContent="VERIFYING...";

      await edgePost(cfg.completeMixUploadEndpoint,{
        email:e,
        application_no:no,
        upload_id:ticket.upload_id
      });
    }

    sessionStorage.setItem("zasu_result_handoff",JSON.stringify({email:e,application_no:no}));
    status.innerHTML='<div class="success-panel"><strong>UPLOAD COMPLETE.</strong><br>音源を受け付けました。処理キューへ登録されます。<br><a href="https://zasumaster.com/result.html" style="text-decoration:underline">→ マスタリング状況を見る</a></div>';
    fileInput.value="";
    selectedFile=null;
    fileMeta.textContent="ファイルはまだ選択されていません。";
  }catch(err){
    console.error(err);
    status.textContent=err?.message||"アップロードに失敗しました。";
  }finally{
    progress.classList.remove("active");
    button.disabled=false;
    button.textContent="UPLOAD MIX";
  }
});