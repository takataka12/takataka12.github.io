/* Presentation only: keep API codes, job states, storage and purchase keys unchanged. */
(() => {
  const ja = {
    preparing:'準備中', uploading:'アップロード中', queued:'処理待ち', starting:'処理開始',
    downloading:'音源を転送中', analyzing:'音源を解析中', mixing:'MIX処理中',
    converting:'変換処理中', rendering:'書き出し中', saving:'保存中', finalizing:'最終確認中',
    retrying:'再試行中', ready:'完了', restoring:'前回の処理を確認中',
    preview:'無料試聴', previewReady:'無料試聴が完成しました', mixReady:'MIXが完成しました',
    masterReady:'マスタリングが完成しました', buyMix:'完成版MIXを購入 — ¥500',
    buyFull:'MIX + MASTERを購入 — ¥800', buyMaster:'完成版MASTERを購入 — ¥500',
    square:'Squareで購入する', downloadMaster:'完成音源をダウンロード（24-bit WAV）'
  };
  const recovery = {
    format:'対応していないファイル形式です。この画面に表示されている対応形式の音源を選び直してください。',
    size:'ファイルサイズが上限を超えているか、空のファイルです。画面に表示されている上限以内の音源を選んでください。',
    same:'ボーカルとインストに同じ音源が指定されています。それぞれ別の音源を選び直してください。',
    upload:'音源のアップロードに失敗しました。通信状態を確認して、もう一度お試しください。',
    network:'通信に失敗しました。通信状態を確認して、少し待ってからもう一度お試しください。',
    timeout:'処理に時間がかかり、完了できませんでした。少し待ってから再度お試しください。購入済みの場合は、再購入する前にお問い合わせください。',
    cancelled:'処理が中断されました。通信状態と音源を確認し、再度お試しください。',
    payment:'決済または購入情報を確認できませんでした。決済済みの場合は購入後の確認画面で再確認してください。再購入する前にお問い合わせください。',
    download:'ダウンロードできませんでした。通信状態と保存期限を確認し、結果画面からもう一度お試しください。',
    expired:'音源の保存期限が終了しているか、処理情報が見つかりません。元の音源を選び直してください。購入済みの場合はお問い合わせください。',
    busy:'現在、処理の受付が混み合っているか、一時停止しています。少し待ってからもう一度お試しください。',
    settings:'選択した設定を受け付けられませんでした。ファイル形式と設定を確認し、再度お試しください。'
  };
  const codes = {
    unsupported_input_format:'format',unsupported_file_type:'format',unsupported_output_format:'format',
    file_too_large:'size',vocal_size_invalid:'size',instrumental_size_invalid:'size',
    same_file:'same',identical_files:'same',same_audio_file:'same',
    chunk_upload_failed:'upload',vocal_upload_failed:'upload',instrumental_upload_failed:'upload',chunk_missing:'upload',
    job_timeout:'timeout',worker_timeout:'timeout',processing_timeout:'timeout',
    processing_cancelled:'cancelled',job_cancelled:'cancelled',aborted:'cancelled',
    payment_required:'payment',credit_required:'payment',payment_failed:'payment',checkout_failed:'payment',
    wrong_plan:'payment',wrong_source:'payment',unlock_failed:'payment',
    download_failed:'download',download_not_ready:'download',
    job_not_found:'expired',invalid_job_credentials:'expired',expired:'expired',
    processing_temporarily_paused:'busy',queue_busy:'busy',request_temporarily_limited:'busy',cost_unit_limited:'busy',
    unsupported_style:'settings',unsupported_sample_rate:'settings',unsupported_mp3_sample_rate:'settings',
    unsupported_bit_depth:'settings',unsupported_preset:'settings',audio_too_long:'settings'
  };
  function error(value, context='general') {
    const raw=String(value?.message || value || '');
    const code=raw.toLowerCase();
    if(codes[code])return recovery[codes[code]];
    if(/failed to fetch|network|load failed/.test(code))return recovery.network;
    if(/timeout|timed out/.test(code))return recovery.timeout;
    if(/abort|cancel/.test(code))return recovery.cancelled;
    if(/upload/.test(code))return recovery.upload;
    if(/payment|checkout|unlock/.test(code))return recovery.payment;
    if(/download/.test(code))return recovery.download;
    // Existing Japanese server guidance can include exact retry times; preserve it.
    if(/[ぁ-んァ-ヶ一-龠]/.test(raw) && !/token|secret|SQL|\{/.test(raw)) {
      return /ください|お試し|お問い合わせ/.test(raw) ? raw : raw+' 内容を確認し、もう一度お試しください。';
    }
    const service={mix:'MIX',master:'マスタリング',convert:'変換',payment:'決済の確認',general:'処理'}[context]||'処理';
    return service+'に失敗しました。通信状態と入力内容を確認して、もう一度お試しください。購入済みの場合は、再購入する前にお問い合わせください。';
  }
  window.ZASU_I18N=Object.freeze({locale:'ja',messages:Object.freeze({ja:Object.freeze(ja)}),t:key=>ja[key]||key,error});
})();
