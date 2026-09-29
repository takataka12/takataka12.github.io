const q=s=>document.querySelector(s);
const cfg=window.ZASU_MASTER_CONFIG||{};
const params=new URLSearchParams(location.search);
const plan=(params.get("plan")||"full").toLowerCase();
const plans={
  mix:{name:"ZASU MIX",price:500,description:"AUTO BALANCEを含む1曲のボーカルMIX処理。",href:"mix/"},
  master:{name:"ZASU MASTER",price:500,description:"STANDARD / LOUD OTVから選ぶ1曲のマスタリング。",href:"upload.html"},
  full:{name:"MIX + MASTER",price:800,description:"ZASU MIXからMASTERまでを1つの制作フローで。",href:"mix/"}
};
const p=plans[plan]||plans.full;
q("#checkoutPlan").textContent=p.name;
q("#checkoutPrice").textContent="¥"+p.price.toLocaleString("ja-JP");
q("#checkoutDescription").textContent=p.description;
const btn=q("#checkoutButton"),status=q("#checkoutStatus");
if(!cfg.commerceEnabled){
  btn.textContent="OPEN BETA — TRY FREE";
  status.textContent="現在はOPEN BETAのため決済は発生しません。";
  btn.onclick=()=>location.href=p.href;
}else{
  btn.textContent="PAY WITH SQUARE";
  btn.onclick=async()=>{
    if(!cfg.audioCheckoutEndpoint){status.textContent="CHECKOUT IS NOT READY.";return;}
    status.textContent="Square Checkoutを準備しています…";
    btn.disabled=true;
    try{
      const visitorId=localStorage.getItem("zasu_visitor_id")||crypto.randomUUID();
      localStorage.setItem("zasu_visitor_id",visitorId);
      const res=await fetch(cfg.audioCheckoutEndpoint,{method:"POST",headers:{"Content-Type":"application/json","apikey":cfg.betaAnonKey,"Authorization":"Bearer "+cfg.betaAnonKey},body:JSON.stringify({plan,visitor_id:visitorId})});
      const body=await res.json().catch(()=>({}));
      if(!res.ok||!body.payment_url||!body.order_id||!body.order_access_token)throw new Error(body.error||"CHECKOUT FAILED");
      localStorage.setItem("zasu_audio_checkout",JSON.stringify({order_id:body.order_id,order_access_token:body.order_access_token,plan,created_at:Date.now()}));
      location.href=body.payment_url;
    }catch(e){status.textContent=e?.message||"CHECKOUT FAILED";btn.disabled=false}
  };
}