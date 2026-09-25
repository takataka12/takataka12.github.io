import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.95.0/+esm";

const cfg=window.ZASU_MASTER_CONFIG||{};
const q=(s)=>document.querySelector(s);
const email=q("#uploadEmail");
const applicationNo=q("#applicationNo");
const fileInput=q("#mixFile");
const dropzone=q("#dropzone");
const fileMeta=q("#fileMeta");
const button=q("#uploadButton");
const status=q("#uploadStatus");
const progress=q("#uploadProgress");
let selectedFile=null;

email.value=localStorage.getItem("zasu_beta_email")||"";
applicationNo.value=localStorage.getItem("zasu_beta_application_no")||"";

function humanBytes(n){
  if(n<1024*1024)return (n/1024).toFixed(1)+" KB";
  return (n/(1024*1024)).toFixed(1)+" MB";
}
function validateFile(file){
  if(!file) throw new Error("WAVまたはFLACを選択してください。");
  const ext=(file.name.split(".").pop()||"").toLowerCase();
  if(!["wav","wave","flac"].includes(ext)) throw new Error("現在対応しているのはWAV / FLACです。");
  const max=cfg.uploadMaxBytes||52428800;
  if(file.size>max) throw new Error("このβ環境では50MBまでです。大きい場合はFLAC化するか、本番ストレージ対応をお待ちください。");
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
    if(!e||!Number.isFinite(no)||no<1) throw new Error("応募時のメールと受付番号を入力してください。");

    localStorage.setItem("zasu_beta_email",e);
    localStorage.setItem("zasu_beta_application_no",String(no));

    button.disabled=true;
    button.textContent="PREPARING...";
    progress.classList.add("active");
    status.textContent="β参加情報を確認しています…";

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

    status.innerHTML='<div class="success-panel"><strong>UPLOAD COMPLETE.</strong><br>音源を受け付けました。PUNCH ENGINEの処理キュー接続後、この受付データから自動処理へ進められます。</div>';
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