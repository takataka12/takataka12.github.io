const q=s=>document.querySelector(s);
const cfg=window.ZASU_MASTER_CONFIG||{};
const title=q("#returnTitle"),text=q("#returnText"),actions=q("#returnActions");
let paymentPollTimer=null;
let paymentPollCount=0;
function addAction(label,href,primary=true){const a=document.createElement("a");a.className="btn"+(primary?"":" secondary");a.href=href;a.textContent=label;actions.appendChild(a)}
function routeFor(plan){return plan==="master"?"result.html":"mix/"}
async function unlockPaidPreview(saved){
  let pending=null;try{pending=JSON.parse(localStorage.getItem("zasu_pending_unlock")||"null")}catch(_){}
  if(!pending)return {ok:true,href:routeFor(saved.plan)};
  if(pending.type==="mix"){
    const res=await fetch(cfg.mixApiEndpoint,{
      method:"POST",
      headers:{"Content-Type":"application/json","apikey":cfg.betaAnonKey,"Authorization":"Bearer "+cfg.betaAnonKey},
      body:JSON.stringify({
        action:"unlock_full",
        job_id:pending.job_id,
        access_token:pending.access_token,
        order_id:saved.order_id,
        order_access_token:saved.order_access_token
      })
    });
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body.error||"MIX UNLOCK FAILED");
    sessionStorage.setItem("zasu_mix_job",JSON.stringify({id:pending.job_id,token:pending.access_token}));
    localStorage.removeItem("zasu_pending_unlock");
    return {ok:true,href:"mix/"};
  }
  if(pending.type==="master"){
    const res=await fetch(cfg.unlockMasterFullEndpoint,{
      method:"POST",
      headers:{"Content-Type":"application/json","apikey":cfg.betaAnonKey,"Authorization":"Bearer "+cfg.betaAnonKey},
      body:JSON.stringify({
        application_no:Number(pending.application_no),
        access_token:pending.access_token,
        preview_job_id:pending.preview_job_id,
        order_id:saved.order_id,
        order_access_token:saved.order_access_token
      })
    });
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body.error||"MASTER UNLOCK FAILED");
    sessionStorage.setItem("zasu_result_handoff",JSON.stringify({application_no:Number(pending.application_no),access_token:pending.access_token}));
    localStorage.removeItem("zasu_pending_unlock");
    return {ok:true,href:"result.html"};
  }
  return {ok:true,href:routeFor(saved.plan)};
}
async function check(){
  if(paymentPollTimer){clearTimeout(paymentPollTimer);paymentPollTimer=null}
  actions.innerHTML="";
  let saved=null;try{saved=JSON.parse(localStorage.getItem("zasu_audio_checkout")||"null")}catch(_){}
  const orderParam=new URLSearchParams(location.search).get("order")||"";
  if(!saved?.order_id||!saved?.order_access_token||saved.order_id!==orderParam){
    title.innerHTML="PAYMENT<br>REFERENCE LOST.";
    text.textContent="このブラウザに決済情報が残っていません。PRICINGから再度確認してください。";
    addAction("BACK TO PRICING →","pricing.html");return;
  }
  try{
    const res=await fetch(cfg.audioPaymentStatusEndpoint,{method:"POST",headers:{"Content-Type":"application/json","apikey":cfg.betaAnonKey,"Authorization":"Bearer "+cfg.betaAnonKey},body:JSON.stringify({order_id:saved.order_id,order_access_token:saved.order_access_token})});
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(body.error||"STATUS FAILED");
    if(body.paid){
      title.innerHTML="PAYMENT<br>READY.";
      text.textContent="決済を確認しました。フル尺処理を解放しています…";
      try{
        const unlocked=await unlockPaidPreview(saved);
        text.textContent="決済確認・フル尺解放が完了しました。";
        addAction(saved.plan==="full"?"CONTINUE FULL PROCESS →":saved.plan==="master"?"CONTINUE MASTERING →":"CONTINUE MIXING →",unlocked.href);
        addAction("PRICING","pricing.html",false);
      }catch(e){
        text.textContent=(e?.message||"UNLOCK FAILED")+"。決済情報は保持されています。";
        addAction("CHECK AGAIN",location.href);
      }
      return;
    }
    title.innerHTML="PAYMENT<br>PROCESSING.";
    text.textContent="Squareから決済完了通知を待っています。この画面で自動確認します。";
    const b=document.createElement("button");b.className="btn";b.type="button";b.textContent="CHECK NOW";b.onclick=()=>{paymentPollCount=0;title.innerHTML="CHECKING<br>PAYMENT.";text.textContent="決済状況を確認しています。";check()};actions.appendChild(b);
    if(paymentPollCount<12){
      paymentPollCount+=1;
      paymentPollTimer=setTimeout(()=>{
        title.innerHTML="CHECKING<br>PAYMENT.";
        text.textContent="決済状況を自動確認しています…";
        check();
      },2500);
    }else{
      text.textContent="決済完了通知に時間がかかっています。決済済みの場合はCHECK NOWでもう一度確認できます。";
    }
  }catch(e){
    title.innerHTML="PAYMENT<br>CHECK FAILED.";
    text.textContent=e?.message||"決済状況を確認できませんでした。";
    addAction("BACK TO PRICING →","pricing.html");
  }
}
check();