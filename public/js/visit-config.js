/**
 * Visit tracking — Google Sheet setup:
 * 1. Create Google Sheet
 * 2. Extensions → Apps Script → paste scripts/google-sheets/visit-logger.gs
 * 3. Deploy → Web app (Anyone)
 * 4. Paste deploy URL below as webhookUrl
 *
 * Email (optional): Google Cloud Console → OAuth Client ID (Web) → paste as googleClientId
 * Users see a small Google sign-in prompt (one tap) — browser email is NOT readable without this.
 */
window.VISIT_TRACKING = {
  enabled: true,
  webhookUrl: '',
  googleClientId: '',
};
