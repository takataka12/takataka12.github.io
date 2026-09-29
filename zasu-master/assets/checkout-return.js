const q=s=>document.querySelector(s);
const cfg=window.ZASU_MASTER_CONFIG||{};
const title=q("#returnTitle"),text=q("#returnText"),actions=q("#returnActions");
function addAction(label,href,primary=true){const a=document.createElement("a");a.className="btn"+(primary?"":" secondary");a.href=href;a.textContent=label;actions.appendChild(a)}
function routeFor(plan){return plan==="master"?"upload.html":"mix/"}
async function check(){
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
      text.textContent="決済を確認しました。購入したトラッククレジットを利用できます。";
      addAction(saved.plan==="full"?"START FULL PROCESS →":saved.plan==="master"?"START MASTERING →":"START MIXING →",routeFor(saved.plan));
      addAction("PRICING","pricing.html",false);
      return;
    }
    title.innerHTML="PAYMENT<br>PROCESSING.";
    text.textContent="Squareから決済完了通知を待っています。数秒後にもう一度確認してください。";
    const b=document.createElement("button");b.className="btn";b.type="button";b.textContent="CHECK AGAIN";b.onclick=()=>{actions.innerHTML="";title.innerHTML="CHECKING<br>PAYMENT.";text.textContent="決済状況を確認しています。";check()};actions.appendChild(b);
  }catch(e){
    title.innerHTML="PAYMENT<br>CHECK FAILED.";
    text.textContent=e?.message||"決済状況を確認できませんでした。";
    addAction("BACK TO PRICING →","pricing.html");
  }
}
check();