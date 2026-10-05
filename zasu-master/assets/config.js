window.ZASU_MASTER_CONFIG = {
  brandName: "ZASU AUDIO",
  commerceEnabled: true,
  checkoutProvider: "square",
  launchPrices: { mix: 500, master: 500, full: 800, convert: 0 },
  squarePaymentLinks: {
    master: "https://square.link/u/ArDEgNp3",
    mix: "https://square.link/u/nlRlUxDe",
    full: "https://square.link/u/gOC2Qnnw"
  },
  audioCheckoutEndpoint: "https://siwmzradvrtetotakkbi.supabase.co/functions/v1/create-zasu-audio-fixed-checkout",
  audioPaymentStatusEndpoint: "https://siwmzradvrtetotakkbi.supabase.co/functions/v1/zasu-audio-payment-status",
  supporterPortalEndpoint: "https://siwmzradvrtetotakkbi.supabase.co/functions/v1/supporter-portal-api",
  betaEndpoint: "https://siwmzradvrtetotakkbi.supabase.co/functions/v1/submit-beta-application",
  createMixUploadEndpoint: "https://siwmzradvrtetotakkbi.supabase.co/functions/v1/create-mix-upload",
  completeMixUploadEndpoint: "https://siwmzradvrtetotakkbi.supabase.co/functions/v1/complete-mix-upload",
  directMasterFromMixEndpoint: "https://siwmzradvrtetotakkbi.supabase.co/functions/v1/create-master-from-zasu-mix",
  masteringStatusEndpoint: "https://siwmzradvrtetotakkbi.supabase.co/functions/v1/mastering-status",
  unlockMasterFullEndpoint: "https://siwmzradvrtetotakkbi.supabase.co/functions/v1/unlock-zasu-master-full",
  mixApiEndpoint: "https://siwmzradvrtetotakkbi.supabase.co/functions/v1/zasu-mix-api",
  feedbackEndpoint: "https://siwmzradvrtetotakkbi.supabase.co/functions/v1/submit-audio-feedback",
  supabaseUrl: "https://siwmzradvrtetotakkbi.supabase.co",
  supabasePublishableKey: "sb_publishable_-rY9u8jnlhS0Qg1XmPlqKg_ViQ0sZYn",
  betaAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpd216cmFkdnJ0ZXRvdGFra2JpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNTk2MTEsImV4cCI6MjEwNTkzNTYxMX0.aF71_QHKtm5JxIN4h3Q-huwKBcdQEOg72fKxErINgMQ",
  workerBaseUrl: "",
  workerUploadMaxBytes: 1073741824,
  uploadMaxBytes: 52428800
};
