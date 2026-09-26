const cfg=window.ZASU_MASTER_CONFIG||{};
const q=(s)=>document.querySelector(s);
const fileInput=q("#mixFile");
const dropzone=q("#dropzone");
const fileMeta=q("#fileMeta");
const button=q("#uploadButton");
const status=q("#uploadStatus");
const progress=q("#uploadProgress");
const paymentNotice=q("#paymentNotice");
let selectedFile=null;

const savedNo=localStorage.getItem("zasu_beta_application_no")||"";const accessToken=localStorage.getItem("zasu_beta_access_token")||"";
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
      beta_application_not_found:"受付番号が見つかりません。",
      beta_not_accepted:"この受付番号はまだβ参加枠に入っていません。",
      payment_required:"この受付ではアップロード権限を確認できませんでした。",
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
    const no=Number(savedNo);
    if(!Number.isFinite(no)||no<1||!accessToken){location.href="https://zasumaster.com/beta.html";return;}

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
          application_no:no,access_token:accessToken,
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
          application_not_found:"受付番号が見つかりません。",
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
        body:JSON.stringify({application_no:no,access_token:accessToken,upload_id:ticket.upload_id})
      });
      let done={}; try{done=await doneRes.json()}catch(_){}
      if(!doneRes.ok) throw new Error(done.detail==="size_mismatch"?"アップロードサイズの確認に失敗しました。":"アップロード確認に失敗しました。");
    }else{
      const ticket=await edgePost(cfg.createMixUploadEndpoint,{
        application_no:no,access_token:accessToken,
        original_name:selectedFile.name,
        bytes:selectedFile.size,
        mime_type:selectedFile.type||"application/octet-stream"
      });

      status.textContent="音源を非公開ストレージへアップロードしています…";
      button.textContent="UPLOADING...";

      // Use Supabase Storage's signed-upload REST endpoint directly.
      // This avoids loading the Supabase JS SDK from an external CDN on iPhone/Safari.
      const signedUrl=cfg.supabaseUrl.replace(/\/$/,"")+
        "/storage/v1/object/upload/sign/"+
        encodeURIComponent(ticket.bucket)+"/"+
        ticket.path.split("/").map(encodeURIComponent).join("/")+
        "?token="+encodeURIComponent(ticket.token);
      const form=new FormData();
      form.append("cacheControl","3600");
      form.append("",selectedFile);
      const uploadRes=await fetch(signedUrl,{
        method:"PUT",
        headers:{"apikey":cfg.supabasePublishableKey,"x-upsert":"false"},
        body:form
      });
      if(!uploadRes.ok){
        let detail=""; try{detail=JSON.stringify(await uploadRes.json())}catch(_){}
        throw new Error("音源アップロードに失敗しました。"+(detail?" "+detail:""));
      }

      status.textContent="アップロードを確認しています…";
      button.textContent="VERIFYING...";

      await edgePost(cfg.completeMixUploadEndpoint,{
        application_no:no,access_token:accessToken,
        upload_id:ticket.upload_id
      });
    }

    sessionStorage.setItem("zasu_result_handoff",JSON.stringify({application_no:no,access_token:accessToken}));
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