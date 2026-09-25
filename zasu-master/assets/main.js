function qs(s){return document.querySelector(s)}
function initBetaForm(){
  const form=qs("#betaForm");
  if(!form)return;

  form.addEventListener("submit",async(e)=>{
    e.preventDefault();
    const button=form.querySelector('button[type="submit"]');
    const status=qs("#formStatus");
    const data=Object.fromEntries(new FormData(form).entries());
    const cfg=window.ZASU_MASTER_CONFIG||{};

    if(!cfg.betaEndpoint||!cfg.betaAnonKey){
      status.textContent="現在は準備中です。";
      return;
    }

    button.disabled=true;
    button.textContent="送信中...";
    status.textContent="";

    try{
      const res=await fetch(cfg.betaEndpoint,{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "apikey":cfg.betaAnonKey,
          "Authorization":"Bearer "+cfg.betaAnonKey
        },
        body:JSON.stringify(data)
      });

      let body={};
      try{body=await res.json()}catch(_){}

      if(!res.ok){
        if(res.status===429) throw new Error("短時間に複数回送信されています。少し時間を置いてください。");
        if(body.error==="invalid_email") throw new Error("メールアドレスを確認してください。");
        throw new Error("送信に失敗しました。時間を置いてもう一度お試しください。");
      }

      if(body.status==="accepted"){
        localStorage.setItem("zasu_beta_email", String(data.email||"").trim().toLowerCase());
        localStorage.setItem("zasu_beta_application_no", String(body.application_no));
        const payUrl=cfg.squarePaymentLink||"https://square.link/u/ArDEgNp3";
        status.innerHTML='Paid Beta受付完了。受付番号 #'+body.application_no+'<br><strong>次にSquareで¥500をお支払いください。</strong><br><a class="btn" style="margin-top:12px" href="'+payUrl+'">PAY ¥500</a><br><span class="mini">決済完了後、自動でMIXアップロード画面へ移動します。</span>';
      }else if(body.status==="waitlisted"){
        localStorage.setItem("zasu_beta_email", String(data.email||"").trim().toLowerCase());
        localStorage.setItem("zasu_beta_application_no", String(body.application_no));
        status.textContent="応募完了。現在は定員のためWaiting Listへ登録しました。受付番号 #"+body.application_no;
      }else{
        status.textContent="応募を受け付けました。ありがとうございます。";
      }
      form.reset();
    }catch(err){
      status.textContent=err?.message||"送信に失敗しました。";
    }finally{
      button.disabled=false;
      button.textContent="¥500 Paid Betaに申し込む";
    }
  });
}
document.addEventListener("DOMContentLoaded",initBetaForm);