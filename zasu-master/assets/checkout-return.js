const q=s=>document.querySelector(s);
const cfg=window.ZASU_MASTER_CONFIG||{};
const title=q("#returnTitle"),text=q("#returnText"),actions=q("#returnActions");
let paymentPollTimer=null;
let paymentPollCount=0;
function addAction(label,href,primary=true){const a=document.createElement("a");a.className="btn"+(primary?"":" secondary");a.href=href;a.textContent=label;actions.appendChild(a)}
function routeFor(plan){return plan==="master"?"result.html":"mix/"}
function readSaved(key){try{return JSON.parse(localStorage.getItem(key)||"null")}catch(_){return null}}
function saveCheckout(saved){
  localStorage.setItem("zasu_audio_checkout",JSON.stringify(saved));
  localStorage.setItem("zasu_audio_checkout:"+saved.order_id,JSON.stringify(saved));
  localStorage.setItem("zasu_audio_checkout_plan_"+saved.plan,JSON.stringify(saved));
}
const returnParams=new URLSearchParams(location.search);
const returnPlan=returnParams.get("plan");
const legacyOrder=returnParams.get("order");
let returnedCheckout=legacyOrder?readSaved("zasu_audio_checkout:"+legacyOrder):
  returnPlan?readSaved("zasu_audio_checkout_plan_"+returnPlan):null;
returnedCheckout=returnedCheckout||readSaved("zasu_audio_checkout");
if(returnedCheckout&&(!legacyOrder||returnedCheckout.order_id===legacyOrder)&&(!returnPlan||returnedCheckout.plan===returnPlan)){
  const squareOrder=returnParams.get("orderId")||returnParams.get("order_id");
  const squarePayment=returnParams.get("transactionId")||returnParams.get("paymentId")||returnParams.get("payment_id");
  if(squareOrder||squarePayment){
    returnedCheckout.square_reference=squareOrder?{square_order_id:squareOrder}:{square_payment_id:squarePayment};
    saveCheckout(returnedCheckout);
    // Keep bearer payment identifiers out of links and referrers.
    history.replaceState(null,"","checkout-return.html?plan="+encodeURIComponent(returnedCheckout.plan));
  }
}
async function unlockPaidPreview(saved){
  let pending=saved.pending||readSaved("zasu_pending_unlock");
  if(!pending)return {ok:true,href:routeFor(saved.plan)};
  if(pending.type!==(saved.plan==="master"?"master":"mix"))throw new Error("購入したサービスとプレビューが一致しません。再購入せず、お問い合わせください。");
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
    if(readSaved("zasu_pending_unlock")?.job_id===pending.job_id)localStorage.removeItem("zasu_pending_unlock");
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
    if(readSaved("zasu_pending_unlock")?.preview_job_id===pending.preview_job_id)localStorage.removeItem("zasu_pending_unlock");
    return {ok:true,href:"result.html"};
  }
  return {ok:true,href:routeFor(saved.plan)};
}
async function check(){
  if(paymentPollTimer){clearTimeout(paymentPollTimer);paymentPollTimer=null}
  actions.innerHTML="";
  const saved=returnedCheckout;
  const isSupporter=saved?.supporter===true;
  if(!saved?.order_id||!saved?.order_access_token||(legacyOrder&&saved.order_id!==legacyOrder)||(returnPlan&&saved.plan!==returnPlan)){
    title.innerHTML=isSupporter?"チケット情報を<br>確認できません":"購入情報を<br>確認できません";
    text.textContent="このブラウザに利用情報が残っていません。料金ページまたは支援者ページから再度確認してください。";
    addAction("料金ページへ戻る →","pricing.html");return;
  }
  try{
    const res=await fetch(cfg.audioPaymentStatusEndpoint,{method:"POST",headers:{"Content-Type":"application/json","apikey":cfg.betaAnonKey,"Authorization":"Bearer "+cfg.betaAnonKey},body:JSON.stringify({order_id:saved.order_id,order_access_token:saved.order_access_token,...saved.square_reference})});
    const body=await res.json().catch(()=>({}));
    if(!res.ok&&body.error!=="payment_pending")throw new Error(body.error||"STATUS FAILED");
    if(body.plan&&body.plan!==saved.plan)throw new Error("購入商品が一致しません。再購入せず、お問い合わせください。");
    if(body.paid){
      saveCheckout(saved);
      title.innerHTML=isSupporter?"チケットの<br>確認完了":"決済を<br>確認しました";
      text.textContent=isSupporter?"支援者チケットを確認しました。フル尺処理を解放しています…":"決済を確認しました。フル尺処理を解放しています…";
      try{
        const unlocked=await unlockPaidPreview(saved);
        text.textContent=isSupporter?"支援者チケット確認・フル尺解放が完了しました。":"決済確認・フル尺解放が完了しました。";
        addAction(saved.plan==="full"?"MIX + MASTERを続ける →":saved.plan==="master"?"MASTERの処理状況を見る →":"MIXの処理状況を見る →",unlocked.href);
        addAction(isSupporter?"支援者ページ":"料金",isSupporter?"supporter.html":"pricing.html",false);
      }catch(e){
        text.textContent=(window.ZASU_I18N.error(e,"payment"))+"。利用情報は保持されています。";
        addAction("もう一度確認する",location.href);
      }
      return;
    }
    title.innerHTML="決済完了通知を<br>確認中";
    text.textContent="Squareの決済完了を確認しています。この画面で自動確認します。";
    const b=document.createElement("button");b.className="btn";b.type="button";b.textContent="決済状況を再確認";b.onclick=()=>{paymentPollCount=0;title.innerHTML="決済状況を<br>確認中";text.textContent="決済状況を確認しています。";check()};actions.appendChild(b);
    if(!isSupporter&&!legacyOrder&&!saved.square_reference){
      text.textContent="Squareの決済情報が戻りURLに含まれていません。決済済みの場合は再購入せず、Squareの注文番号と利用したサービスを添えてお問い合わせください。";
      addAction("お問い合わせ →","contact.html",false);
      return;
    }
    if(paymentPollCount<12){
      paymentPollCount+=1;
      paymentPollTimer=setTimeout(()=>{
        title.innerHTML="決済状況を<br>確認中";
        text.textContent="決済状況を自動確認しています…";
        check();
      },2500);
    }else{
      text.textContent="決済完了通知に時間がかかっています。決済済みの場合は「決済状況を再確認」でもう一度確認できます。";
    }
  }catch(e){
    title.innerHTML=isSupporter?"チケットを<br>確認できません":"決済を<br>確認できません";
    text.textContent=window.ZASU_I18N.error(e,"payment");
    addAction("料金ページへ戻る →","pricing.html");
  }
}
check();
