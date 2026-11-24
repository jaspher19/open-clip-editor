// Plain-language explanations for what Google says during YouTube setup and uploads. Each names the cause and the fix
// as the user sees it (docs/YOUTUBE-SETUP.md has the same list with more detail).

export const SETUP_GUIDE='https://github.com/jaspher19/open-clip-editor/blob/master/docs/YOUTUBE-SETUP.md';

const FIXES={
 // OAuth (sign-in) errors
 access_denied:'Google refused the sign-in. Either you clicked Cancel, or this Google account isn’t allowed to use your app. Make the app with Google’s Personal setup page while signed in to the channel’s account, or, for an External app, add this exact email under Audience → Test users. Then click Connect YouTube again.',
 client_user_mismatch:'You signed in with a different Google account than the one that made the app. A Personal app only works for the account that created it. Click Connect YouTube again and choose that account (or make a new app while signed in to the channel’s account).',
 admin_policy_enforced:'Your Google Workspace administrator blocks this app. Ask them to allow it, or use a personal Google account that owns the channel.',
 org_internal:'This app is set to Internal, so only accounts in its organisation can sign in. Make a new app with the Personal setup page instead.',
 invalid_client:'Google doesn’t recognise the saved app details. The client was deleted or its secret changed. Download a new JSON (Google Auth Platform → Clients), save it in OpenClip and connect again.',
 deleted_client:'The Google client in your JSON was deleted. Create a new Desktop app client, download its JSON, save it in OpenClip and connect again.',
 unauthorized_client:'This client can’t be used for this sign-in. Make sure it is a Desktop app client, then download its JSON again.',
 invalid_grant:'Google ended OpenClip’s access (the sign-in expired or was removed, or the password changed). External apps in Testing expire every 7 days. Click Disconnect, then Connect YouTube again; a Personal app avoids the weekly expiry.',
 redirect_uri_mismatch:'The JSON is for a Web application client. Create a client with Application type “Desktop app”, download its JSON and save that in OpenClip.',
 // YouTube Data API errors
 accessNotConfigured:'YouTube Data API v3 is turned off for your Google Cloud project. Open the API page, check that your project is selected at the top, click Enable, wait two minutes and try again.',
 SERVICE_DISABLED:'YouTube Data API v3 is turned off for your Google Cloud project. Open the API page, check that your project is selected at the top, click Enable, wait two minutes and try again.',
 insufficientPermissions:'OpenClip wasn’t given permission to upload. Click Disconnect, then Connect YouTube again, and tick every box on Google’s permission page.',
 ACCESS_TOKEN_SCOPE_INSUFFICIENT:'OpenClip wasn’t given permission to upload. Click Disconnect, then Connect YouTube again, and tick every box on Google’s permission page.',
 youtubeSignupRequired:'This Google account has no YouTube channel yet. Create one at youtube.com (profile picture → Create a channel), then connect again.',
 quotaExceeded:'Your Google project used up today’s free YouTube quota (about 6 uploads a day). Uploads work again after midnight Pacific Time.',
 dailyLimitExceeded:'Your Google project used up today’s free YouTube quota (about 6 uploads a day). Uploads work again after midnight Pacific Time.',
 uploadLimitExceeded:'YouTube’s own daily upload limit for this channel is reached. Try again in 24 hours; verifying your phone number in YouTube Studio raises the limit.',
 forbidden:'YouTube refused the request for this channel. Check that the account you connected owns or manages the channel.',
};
/** The explanation for a Google error code, or null. */
export const googleFix=code=>FIXES[String(code||'')]||null;

/** Reads a Google API error response and explains it ("reason" for YouTube errors, "error" for OAuth ones). */
export async function googleApiError(response,fallback){
 let data={};try{data=await response.json();}catch{/* not JSON */}
 const e=data?.error,reasons=[e?.errors?.[0]?.reason,e?.status,...(e?.details||[]).map(d=>d?.reason),typeof e==='string'?e:null].filter(Boolean);
 const fix=reasons.map(googleFix).find(Boolean);
 return new Error(fix||`${fallback} (${reasons[0]||`HTTP ${response.status}`}). See the YouTube setup guide: ${SETUP_GUIDE}`);
}

/** Checks a pasted or chosen client JSON before saving, with a message for each usual mistake. */
export function clientFromJson(input){
 if(!input||typeof input!=='object')throw new Error('That isn’t a Google client JSON file. Download it from Google Auth Platform → Clients (the Download JSON button).');
 if(input.type==='service_account')throw new Error('That is a service account key, not an OAuth client. Create a client with Application type “Desktop app” and download its JSON.');
 if(input.web)throw new Error('That JSON is for a “Web application” client. Create a client with Application type “Desktop app” and download its JSON instead.');
 const data=input.installed;
 if(!data)throw new Error('That JSON isn’t a Desktop app client. Create a client with Application type “Desktop app” and download its JSON.');
 if(typeof data.client_id!=='string'||!data.client_id.endsWith('.apps.googleusercontent.com'))throw new Error('The JSON has no valid client ID. Download it again from Google Auth Platform → Clients.');
 if(typeof data.client_secret!=='string'||!data.client_secret)throw new Error('The JSON has no client secret. Google shows the secret only once: open the client, click Add secret, and download the JSON again.');
 return {client_id:data.client_id,client_secret:data.client_secret};
}
