const q=s=>document.querySelector(s);
const cfg=window.ZASU_MASTER_CONFIG||{};
const params=new URLSearchParams(location.search);
const plan=(params.get("plan")||"full").toLowerCase();
const plans={
  mix:{name:"ZASU AUDIO — MIX",price:500,description:"1曲のフル尺ボーカルMIX。完成MIXの24-bit WAVと、処理済みボーカルをダウンロードできます。マスタリングは含まれません。",href:"mix/"},
  master:{name:"ZASU AUDIO — MASTER",price:500,description:"STANDARD / LOUDから選ぶ1曲のフル尺自動マスタリング。完成音源の24-bit WAVをダウンロードできます。",href:"upload.html"},
  full:{name:"ZASU AUDIO — MIX + MASTER",price:800,description:"自動ボーカルMIXとマスタリングをセットで購入。再アップロードせず、フル尺MIXからMASTERへ進み、完成音源をダウンロードできます。",href:"mix/"}
};
const p=plans[plan]||plans.full;
q("#checkoutPlan").textContent=p.name;
q("#checkoutPrice").textContent="¥"+p.price.toLocaleString("ja-JP");
q("#checkoutDescription").textContent=p.description;
const btn=q("#checkoutButton"),status=q("#checkoutStatus"),legalConfirm=q("#legalConfirm");
const supporterCode=q("#checkoutSupporterCode"),supporterButton=q("#checkoutSupporterButton"),supporterStatus=q("#checkoutSupporterStatus");
function normalizeSupporterCode(v){return String(v||"").trim().toUpperCase().replace(/\s+/g,"")}
function audioHeaders(){
  const h={"Content-Type":"application/json","apikey":cfg.betaAnonKey,"Authorization":"Bearer "+cfg.betaAnonKey};
  const admin=sessionStorage.getItem("zasu_admin_key")||sessionStorage.getItem("zasu_dev_admin_key");
  if(admin)h["x-zasu-admin-key"]=admin;
  return h;
}
function getPending(){try{return JSON.parse(localStorage.getItem("zasu_pending_unlock")||"null")}catch(_){return null}}
function pendingSource(pending){
  const sourceType=pending?.type==="mix"?"mix":pending?.type==="master"?"master":null;
  const sourceId=sourceType==="mix"?pending?.job_id:sourceType==="master"?pending?.preview_job_id:null;
  return {sourceType,sourceId};
}
const rememberedSupporterCode=sessionStorage.getItem("zasu_supporter_code");
if(rememberedSupporterCode&&supporterCode)supporterCode.value=rememberedSupporterCode;

if(!cfg.commerceEnabled){
  btn.textContent="無料公開の処理へ進む";
  status.textContent="現在はOPEN BETAのため決済は発生しません。";
  btn.onclick=()=>location.href=p.href;
}else{
  btn.textContent="Squareで購入する";
  btn.onclick=async()=>{
    if(!legalConfirm?.checked){status.textContent="特商法表記・返金ポリシー・利用規約を確認してください。";return;}
    if(!cfg.audioCheckoutEndpoint){status.textContent="購入画面を準備できませんでした。少し待ってから再度お試しください。";return;}
    status.textContent="Squareの購入画面を準備しています…";
    btn.disabled=true;
    try{
      const visitorId=localStorage.getItem("zasu_visitor_id")||crypto.randomUUID();
      localStorage.setItem("zasu_visitor_id",visitorId);
      const pending=getPending();
      const {sourceType,sourceId}=pendingSource(pending);
      if(!plans[plan]||!sourceId||sourceType!==(plan==="master"?"master":"mix"))throw new Error("先に対象サービスの30秒プレビューを作成してください。");
      const res=await fetch(cfg.audioCheckoutEndpoint,{method:"POST",headers:audioHeaders(),body:JSON.stringify({plan,visitor_id:visitorId,source_type:sourceType,source_id:sourceId,source_access_token:pending.access_token,application_no:pending.application_no})});
      const body=await res.json().catch(()=>({}));
      if(res.status===429||body.error==="rate_limited"){
        const sec=Math.max(1,Number(body.retry_after_seconds||60));
        throw new Error("短時間に決済リクエストが集中しています。約"+Math.ceil(sec/60)+"分後にもう一度お試しください。");
      }
      if(!res.ok||!body.payment_url||!body.order_id||!body.order_access_token)throw new Error(body.user_message||body.error||"決済画面を開けませんでした。通信状態を確認して再度お試しください。");
      if(body.payment_url!==cfg.squarePaymentLinks?.[plan])throw new Error("購入先の商品を確認できませんでした。再購入せず、お問い合わせください。");
      const saved={order_id:body.order_id,order_access_token:body.order_access_token,plan,created_at:Date.now(),supporter:false,pending};
      localStorage.setItem("zasu_audio_checkout",JSON.stringify(saved));
      localStorage.setItem("zasu_audio_checkout:"+saved.order_id,JSON.stringify(saved));
      localStorage.setItem("zasu_audio_checkout_plan_"+plan,JSON.stringify(saved));
      location.href=body.payment_url;
    }catch(e){status.textContent=window.ZASU_I18N.error(e,"payment");btn.disabled=false}
  };
}

async function useSupporterTicket(){
  if(!legalConfirm?.checked){supporterStatus.textContent="利用規約・返金ポリシー等を確認してください。";return}
  if(!cfg.supporterPortalEndpoint){supporterStatus.textContent="チケットを確認できませんでした。支援者ページから再度お試しください。";return}
  const code=normalizeSupporterCode(supporterCode?.value);
  if(!code){supporterStatus.textContent="支援者コードを入力してください。";return}
  const pending=getPending();
  if(!pending){supporterStatus.textContent="先に30秒プレビューを作成してからチケットを使用してください。";return}
  if(plan==="master"&&pending.type!=="master"){supporterStatus.textContent="MASTERのプレビュー情報が見つかりません。";return}
  if((plan==="mix"||plan==="full")&&pending.type!=="mix"){supporterStatus.textContent="MIXのプレビュー情報が見つかりません。";return}
  const {sourceType,sourceId}=pendingSource(pending);
  if(!sourceType||!sourceId){supporterStatus.textContent="プレビュー情報が不足しています。";return}

  supporterButton.disabled=true;
  supporterStatus.textContent=plan==="full"?"支援者チケット2枚を確認しています…":"支援者チケット1枚を確認しています…";
  try{
    const visitorId=localStorage.getItem("zasu_visitor_id")||crypto.randomUUID();
    localStorage.setItem("zasu_visitor_id",visitorId);
    const res=await fetch(cfg.supporterPortalEndpoint,{method:"POST",headers:audioHeaders(),body:JSON.stringify({
      action:"claim_audio",code,plan,visitor_id:visitorId,source_type:sourceType,source_id:sourceId
    })});
    const body=await res.json().catch(()=>({}));
    if(!res.ok){
      if(body.error==="insufficient_tickets")throw new Error("ZASU AUDIOチケット残高が不足しています。");
      if(body.error==="supporter_expired")throw new Error("この支援者コードの有効期限は終了しています。");
      throw new Error("支援者コードを確認できませんでした。");
    }
    sessionStorage.setItem("zasu_supporter_code",code);
    localStorage.setItem("zasu_audio_checkout",JSON.stringify({
      order_id:body.order_id,order_access_token:body.order_access_token,plan,created_at:Date.now(),supporter:true
    }));
    supporterStatus.textContent="チケットを適用しました。フル尺処理を解放します…";
    location.href="checkout-return.html?order="+encodeURIComponent(body.order_id)+"&supporter=1";
  }catch(e){
    supporterStatus.textContent=window.ZASU_I18N.error(e,"payment");
    supporterButton.disabled=false;
  }
}
if(supporterButton)supporterButton.addEventListener("click",useSupporterTicket);
if(supporterCode)supporterCode.addEventListener("keydown",e=>{if(e.key==="Enter")useSupporterTicket()});
