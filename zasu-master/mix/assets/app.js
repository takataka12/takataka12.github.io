const cfg=window.ZASU_MIX_CONFIG||{};
const q=s=>document.querySelector(s);
let vocal=null,inst=null,style="modern",job=null,pollTimer=null;
const STYLE_CONTROL_DEFAULTS={
  natural:{gain:0.5,reverb:8,body:0,presence:0,air:0},
  modern:{gain:2.0,reverb:14,body:0,presence:0,air:0.5},
  rock:{gain:1.5,reverb:12,body:0.5,presence:0.5,air:0},
  loud:{gain:2.5,reverb:10,body:0,presence:1.0,air:0}
};

function humanBytes(n){n=Number(n||0);if(n<1024*1024)return(n/1024).toFixed(1)+" KB";return(n/1024/1024).toFixed(1)+" MB"}
function authHeaders(){return{"Content-Type":"application/json","apikey":cfg.publishableKey,"Authorization":"Bearer "+cfg.anonKey}}
async function api(action,payload={}){
  const r=await fetch(cfg.api,{method:"POST",headers:authHeaders(),body:JSON.stringify({action,...payload})});
  const b=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(b.error||"request_failed");
  return b;
}
function setProgress(p,title,text){q("#jobProgress").hidden=false;q("#progressBar").style.width=Math.max(0,Math.min(100,p))+"%";q("#progressTitle").textContent=title;q("#progressText").textContent=text}
function pick(kind,file){
  if(kind==="vocal")vocal=file||null;else inst=file||null;
  const el=q(kind==="vocal"?"#vocalMeta":"#instMeta");
  const f=kind==="vocal"?vocal:inst;
  el.textContent=f?(f.name+" — "+humanBytes(f.size)):(kind==="vocal"?"ボーカル未選択":"インスト未選択");
  el.classList.toggle("ready",!!f);
}
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
function syncControlLabels(){
  q("#vocalGainValue").textContent=dbText(q("#vocalGain").value);
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
document.querySelectorAll(".style").forEach(x=>x.onclick=()=>{
  style=x.dataset.style;
  document.querySelectorAll(".style").forEach(y=>y.classList.toggle("active",y===x));
  applyStyleControls(style);
});
applyStyleControls("modern");

async function uploadSet(ticketList,file,bucket,chunkSize,label,startPct,endPct){
  const total=ticketList.length;
  for(let i=0;i<total;i++){
    const t=ticketList[i],start=i*chunkSize,end=Math.min(file.size,start+chunkSize),blob=file.slice(start,end);
    const url=cfg.supabaseUrl.replace(/\/$/,"")+"/storage/v1/object/upload/sign/"+encodeURIComponent(bucket)+"/"+t.path.split("/").map(encodeURIComponent).join("/")+"?token="+encodeURIComponent(t.token);
    const fd=new FormData();fd.append("cacheControl","3600");fd.append("",blob,label+"-"+String(i).padStart(3,"0"));
    const r=await fetch(url,{method:"PUT",headers:{"apikey":cfg.publishableKey,"x-upsert":"false"},body:fd});
    if(!r.ok)throw new Error(label+"_upload_failed");
    const pct=Math.round(startPct+((i+1)/total)*(endPct-startPct));
    setProgress(pct,"UPLOADING",label.toUpperCase()+" — "+(i+1)+" / "+total);
  }
}

async function start(){
  if(!vocal||!inst){q("#statusText").textContent="DRY VOCALとINSTRUMENTALの両方を選択してください。";return}
  if(vocal.size>cfg.maxBytes||inst.size>cfg.maxBytes){q("#statusText").textContent="各ファイル最大500MBです。";return}
  const b=q("#mixButton");b.disabled=true;q("#resultCard").hidden=true;q("#statusText").textContent="";
  try{
    setProgress(3,"PREPARING","MIXジョブを準備しています。");
    const ticket=await api("create_job",{
      vocal_name:vocal.name,vocal_size_bytes:vocal.size,vocal_mime_type:vocal.type||"application/octet-stream",
      instrumental_name:inst.name,instrumental_size_bytes:inst.size,instrumental_mime_type:inst.type||"application/octet-stream",
      mix_style:style,
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
    setProgress(45,"QUEUED","AUTO MIX ENGINEを待っています。");
    poll();
  }catch(e){
    b.disabled=false;
    q("#statusText").textContent="開始できませんでした。音源や通信状態を確認してください。";
  }
}
q("#mixButton").onclick=start;

const stageCopy={
  uploading:["UPLOADING","音源をアップロードしています。"],
  queued:["QUEUED","MIXサーバーを待っています。"],
  claimed:["STARTING","AUTO MIX ENGINEを起動しています。"],
  downloading:["DOWNLOADING","音源を処理サーバーへ転送しています。"],
  analyzing:["ANALYZING","音量・フォーマットを解析しています。"],
  mixing:["AUTO MIXING","EQ / De-esser / Compressor / Vocal Level / Reverbを反映しています。"],
  preparing_results:["RENDERING","24-bit WAVを書き出しています。"],
  uploading_results:["SAVING","完成ファイルを保存しています。"],
  finalizing:["FINALIZING","最終確認しています。"],
  retrying:["RETRYING","一時的なエラーのため再試行しています。"],
  completed:["READY","AUTO MIXが完成しました。"]
};

async function poll(){
  clearTimeout(pollTimer);if(!job)return;
  try{
    const s=await api("status",{job_id:job.id,access_token:job.token});
    const copy=stageCopy[s.stage]||["PROCESSING","AUTO MIX処理中です。"];
    setProgress(Number(s.progress||0),copy[0],copy[1]);
    if(s.status==="completed"){showResult(s);return}
    if(s.status==="failed"){q("#mixButton").disabled=false;q("#statusText").textContent=s.user_message||"MIXに失敗しました。";return}
    pollTimer=setTimeout(poll,2500);
  }catch(_){
    q("#statusText").textContent="接続を再確認しています…";
    pollTimer=setTimeout(poll,6000);
  }
}

function showResult(s){
  q("#mixButton").disabled=false;
  q("#resultStyle").textContent=String(s.mix_style||"").toUpperCase();
  q("#resultRate").textContent=s.output_sample_rate?(Number(s.output_sample_rate)/1000).toFixed(Number(s.output_sample_rate)%1000?1:0)+" kHz":"—";
  q("#resultLufs").textContent=Number.isFinite(Number(s.output_lufs))?Number(s.output_lufs).toFixed(2)+" LUFS":"—";
  q("#resultTp").textContent=Number.isFinite(Number(s.output_true_peak))?Number(s.output_true_peak).toFixed(2)+" dBTP":"—";
  q("#mixDownload").href=cfg.downloadBase.replace(/\/$/,"")+"/download/"+encodeURIComponent(job.id)+"/mix?token="+encodeURIComponent(job.token);
  q("#vocalDownload").href=cfg.downloadBase.replace(/\/$/,"")+"/download/"+encodeURIComponent(job.id)+"/vocal?token="+encodeURIComponent(job.token);
  q("#resultCard").hidden=false;
  q("#resultCard").scrollIntoView({behavior:"smooth",block:"start"});
  sessionStorage.removeItem("zasu_mix_job");
}
const saved=sessionStorage.getItem("zasu_mix_job");
if(saved){try{job=JSON.parse(saved);if(job?.id&&job?.token){q("#mixButton").disabled=true;setProgress(10,"RESTORING","前回のMIX状況を確認しています。");poll()}}catch(_){sessionStorage.removeItem("zasu_mix_job")}}
