const cfg=window.ZASU_CONVERT_CONFIG||{};
const q=s=>document.querySelector(s);
let file=null,preset="keep_original",job=null,pollTimer=null,masterHandoff=null;

function humanBytes(n){n=Number(n||0);if(n<1024*1024)return(n/1024).toFixed(1)+" KB";return(n/1024/1024).toFixed(1)+" MB"}
function setProgress(p,title,text){q("#jobProgress").hidden=false;q("#progressBar").style.width=Math.max(0,Math.min(100,p))+"%";q("#progressTitle").textContent=title;q("#progressText").textContent=text}
function authHeaders(){return{"Content-Type":"application/json","apikey":cfg.publishableKey,"Authorization":"Bearer "+cfg.anonKey}}
async function api(action,payload={}){
  const r=await fetch(cfg.api,{method:"POST",headers:authHeaders(),body:JSON.stringify({action,...payload})});
  const b=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(b.error||"request_failed");
  return b;
}
function outputSettings(){
  const fmt=q("#outputFormat").value;
  return{
    output_format:fmt,
    sample_rate:q("#sampleRate").value?Number(q("#sampleRate").value):null,
    bit_depth:fmt==="mp3"?null:(q("#bitDepth").value?Number(q("#bitDepth").value):null),
    dither:fmt==="mp3"?false:q("#dither").checked,
    preset
  }
}
function applyPreset(name){
  preset=name;
  document.querySelectorAll(".preset").forEach(x=>x.classList.toggle("active",x.dataset.preset===name));
  if(name==="cd_master"){q("#outputFormat").value="wav";q("#sampleRate").value="44100";q("#bitDepth").value="16";q("#dither").checked=true}
  if(name==="lossless_archive"){q("#outputFormat").value="flac";q("#sampleRate").value="";q("#bitDepth").value="";q("#dither").checked=false}
  if(name==="apple_lossless"){q("#outputFormat").value="alac";q("#sampleRate").value="";q("#bitDepth").value="";q("#dither").checked=false}
  if(name==="mp3_hq"){q("#outputFormat").value="mp3";q("#sampleRate").value="";q("#bitDepth").value="";q("#dither").checked=false}
  if(name==="keep_original"){q("#sampleRate").value="";q("#bitDepth").value="";q("#dither").checked=false}
  syncLossyControls();
}
function syncLossyControls(){
  const mp3=q("#outputFormat").value==="mp3";
  q("#bitDepth").disabled=mp3;
  q("#dither").disabled=mp3;
  if(mp3){
    q("#bitDepth").value="";
    q("#dither").checked=false;
    if(["88200","96000"].includes(q("#sampleRate").value))q("#sampleRate").value="";
  }
}
document.querySelectorAll(".preset").forEach(x=>x.onclick=()=>applyPreset(x.dataset.preset));
q("#outputFormat").addEventListener("change",()=>{preset="custom";document.querySelectorAll(".preset").forEach(x=>x.classList.remove("active"));syncLossyControls()});
q("#sampleRate").addEventListener("change",()=>{if(q("#outputFormat").value==="mp3"&&["88200","96000"].includes(q("#sampleRate").value)){q("#sampleRate").value="";q("#statusText").textContent="MP3は44.1 / 48 kHzで出力します。"}});
syncLossyControls();

function chooseFile(f){
  file=f||null;
  q("#fileMeta").textContent=file?(file.name+" — "+humanBytes(file.size)):"ファイルはまだ選択されていません。";
}
q("#audioFile").addEventListener("change",()=>chooseFile(q("#audioFile").files?.[0]));
const drop=q("#dropzone");
["dragenter","dragover"].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add("drag")}));
["dragleave","drop"].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove("drag")}));
drop.addEventListener("drop",e=>chooseFile(e.dataTransfer?.files?.[0]));

async function uploadChunks(ticket){
  const total=ticket.tickets.length;
  for(let i=0;i<total;i++){
    const t=ticket.tickets[i],start=i*ticket.chunk_size,end=Math.min(file.size,start+ticket.chunk_size),blob=file.slice(start,end);
    const url=cfg.supabaseUrl.replace(/\/$/,"")+"/storage/v1/object/upload/sign/"+encodeURIComponent(ticket.bucket)+"/"+t.path.split("/").map(encodeURIComponent).join("/")+"?token="+encodeURIComponent(t.token);
    const fd=new FormData();fd.append("cacheControl","3600");fd.append("",blob,"part"+String(i).padStart(3,"0"));
    const r=await fetch(url,{method:"PUT",headers:{"apikey":cfg.publishableKey,"x-upsert":"false"},body:fd});
    if(!r.ok)throw new Error("chunk_upload_failed");
    const pct=5+Math.round(((i+1)/total)*35);
    setProgress(pct,"UPLOADING","音源をアップロード中 — "+(i+1)+" / "+total);
  }
}

async function start(){
  if(!masterHandoff&&!file){q("#statusText").textContent="音源ファイルを選択してください。";return}
  if(file&&file.size>cfg.maxBytes){q("#statusText").textContent="最大500MBです。";return}
  const b=q("#convertButton");b.disabled=true;q("#resultCard").hidden=true;q("#statusText").textContent="";
  try{
    setProgress(3,"PREPARING","変換ジョブを準備しています。");
    const settings=outputSettings();

    if(masterHandoff){
      const ticket=await api("create_from_master",{
        application_no:Number(masterHandoff.application_no),
        master_access_token:String(masterHandoff.access_token||""),
        master_job_id:String(masterHandoff.master_job_id||""),
        ...settings
      });
      job={id:ticket.job_id,token:ticket.access_token};
      sessionStorage.setItem("zasu_convert_job",JSON.stringify(job));
      sessionStorage.removeItem("zasu_convert_master_handoff");
      masterHandoff=null;
      setProgress(12,"QUEUED","ZASU MASTER完成音源を直接引き継ぎました。");
      poll();
      return;
    }

    const ticket=await api("create_upload",{original_name:file.name,size_bytes:file.size,mime_type:file.type||"application/octet-stream",...settings});
    job={id:ticket.job_id,token:ticket.access_token};
    sessionStorage.setItem("zasu_convert_job",JSON.stringify(job));
    await uploadChunks(ticket);
    await api("complete_upload",{job_id:job.id,access_token:job.token});
    setProgress(42,"QUEUED","変換サーバーを待っています。");
    poll();
  }catch(e){
    b.disabled=false;q("#statusText").textContent="開始できませんでした。ファイルや設定を確認してください。";
  }
}
q("#convertButton").onclick=start;

const stageCopy={
  uploading:["UPLOADING","音源をアップロードしています。"],
  queued:["QUEUED","変換サーバーを待っています。"],
  claimed:["STARTING","変換を開始しています。"],
  downloading:["DOWNLOADING","音源を処理サーバーへ転送しています。"],
  probing:["ANALYZING","音源フォーマットを確認しています。"],
  converting:["CONVERTING","SoXR HQで変換しています。"],
  preparing_output:["PREPARING OUTPUT","完成ファイルを準備しています。"],
  uploading_output:["SAVING","完成ファイルを安全に保存しています。"],
  finalizing:["FINALIZING","最終確認しています。"],
  retrying:["RETRYING","一時的なエラーのため再試行しています。"],
  completed:["READY","変換が完了しました。"]
};
async function poll(){
  clearTimeout(pollTimer);
  if(!job)return;
  try{
    const s=await api("status",{job_id:job.id,access_token:job.token});
    const copy=stageCopy[s.stage]||["PROCESSING","変換処理中です。"];
    setProgress(Number(s.progress||0),copy[0],copy[1]);
    if(s.status==="completed"){showResult(s);return}
    if(s.status==="failed"){q("#convertButton").disabled=false;q("#statusText").textContent=s.user_message||"変換に失敗しました。";return}
    pollTimer=setTimeout(poll,2500);
  }catch(_){
    q("#statusText").textContent="接続を再確認しています…";
    pollTimer=setTimeout(poll,6000);
  }
}
function showResult(s){
  q("#convertButton").disabled=false;
  q("#resultFormat").textContent=String(s.output_format||"").toUpperCase();
  q("#resultRate").textContent=s.sample_rate?(Number(s.sample_rate)/1000).toFixed(s.sample_rate%1000?1:0)+" kHz":"—";
  q("#resultBits").textContent=s.output_format==="mp3"?(s.bitrate_kbps||320)+" kbps":(s.bit_depth?s.bit_depth+" bit":"—");
  q("#resultSize").textContent=humanBytes(s.output_size_bytes);
  const dl=q("#downloadButton");
  dl.href=cfg.downloadBase.replace(/\/$/,"")+"/download/"+encodeURIComponent(job.id)+"?token="+encodeURIComponent(job.token);
  dl.download=s.output_name||"";
  q("#resultCard").hidden=false;
  q("#resultCard").scrollIntoView({behavior:"smooth",block:"start"});
  sessionStorage.removeItem("zasu_convert_job");
}
const handoffRaw=sessionStorage.getItem("zasu_convert_master_handoff");
if(handoffRaw){
  try{
    const h=JSON.parse(handoffRaw);
    if(h?.application_no&&h?.access_token&&h?.master_job_id){
      masterHandoff=h;
      q("#dropzone").hidden=true;
      q("#fileMeta").classList.add("master-source");
      q("#fileMeta").textContent="ZASU MASTER完成音源を直接使用 — "+String(h.profile_label||"MASTER");
      q("#statusText").textContent="再アップロード不要です。変換方法を選んでCONVERT AUDIOを押してください。";
    }
  }catch(_){sessionStorage.removeItem("zasu_convert_master_handoff")}
}

const saved=sessionStorage.getItem("zasu_convert_job");
if(saved){try{job=JSON.parse(saved);if(job?.id&&job?.token){q("#convertButton").disabled=true;setProgress(10,"RESTORING","前回の変換状況を確認しています。");poll()}}catch(_){sessionStorage.removeItem("zasu_convert_job")}}
