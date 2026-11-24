# Connect your YouTube channel to OpenClip

OpenClip uploads to YouTube through **your own** small Google app. Setting it up takes about 10 minutes, is free, needs no credit card, and you only do it once. The app's details stay on your computer.

The same steps are inside OpenClip: **Automation → YouTube setup**.

**What you need:** the Google account that owns your YouTube channel, and OpenClip running.

---

## Step 1. Use the right Google account

Every step below must be done with **the Google account that owns your YouTube channel**. Doing it with a different account is the most common reason setup fails.

1. Open [youtube.com](https://www.youtube.com), click your profile picture (top right) and check that it shows **your channel**.
   - No channel yet? Click **Create a channel** first.
2. Are you signed in to several Google accounts in this browser? Open the links in this guide in a **private / incognito window**, and sign in there only with the channel's account.

## Step 2. Make your app (Google's Personal setup page)

Google has one page that creates everything OpenClip needs. It sets up a **Personal** app:

- only you can sign in;
- you don't need test users;
- Google shows no "unverified app" warning;
- you don't have to reconnect every week.

1. Open **[Google's Personal setup page](https://console.cloud.google.com/auth/overview/personal)** and sign in with the channel's account.
2. **Project:** keep the suggested project (`personal-mode-app`), or choose **Create a new project**.
3. **Application type:** choose **Desktop app**. Do not choose *Web application*.
4. Tick the box to agree to the Terms of Service, then click **Continue**.
5. A window called **OAuth client created** opens. Click **Download JSON** *before you close it*.
   - Google shows the secret only once.
   - The file is called something like `client_secret_123…apps.googleusercontent.com.json` and goes to your **Downloads** folder.

> A Personal app can't be changed to another type later, and only the account that made it can connect. That's exactly what OpenClip needs.

<details>
<summary><b>The Personal page doesn't open, or doesn't offer Personal? Use the classic way</b></summary>

1. Create a project at [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate). Any name works, for example *OpenClip*.
2. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) and click **Get started**:
   - App name: *OpenClip*. Support email: your email.
   - Audience: **External**.
   - Contact email: your email.
   - Agree to the policy, then click **Create**.
3. Open **Audience**. Under **Test users**, click **Add users** and add **the channel's email address**. Without this, Google says *"Access blocked"*.
4. Open [Clients](https://console.cloud.google.com/auth/clients) and click **Create client**. Choose **Desktop app**, click **Create**, then click **Download JSON**.

Apps made this way are in "testing". They ask you to connect again every **7 days**, and Google shows a *"hasn't verified this app"* screen when you connect (see Step 5).
</details>

## Step 3. Turn on the YouTube Data API

Your new project has to be allowed to talk to YouTube.

1. Open **[YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com)**.
2. At the top of the page, check that **your project** is selected, for example `personal-mode-app`. If it isn't, click the project name and pick it.
3. Click **Enable**. If the button says **Manage**, the API is already on.
4. Wait about a minute before connecting.

## Step 4. Give the JSON file to OpenClip

1. In OpenClip, open **Automation → YouTube setup**.
2. Click **Choose JSON file** and pick the `client_secret_….json` from your Downloads.
   - You can also open the file in Notepad, copy everything and paste it into the box.
3. Click **Save credentials**. The file is saved on this computer only.

## Step 5. Connect

1. Click **Connect YouTube**. A Google tab opens.
2. Pick **the channel's Google account**. If you manage several channels, pick the right one.
3. Only for classic (External) apps: Google says *"Google hasn't verified this app"*. Click **Advanced**, then **Go to OpenClip (unsafe)**. It's your own app, so this is fine.
4. On the permission page, **tick every box** and click **Continue**.
5. The tab says **YouTube connected**. Close it. OpenClip now shows your channel name.

Done. In **Posting calendar** you can now upload, schedule and auto-post.

### Good to know

- **Uploads start private.** YouTube keeps uploads from new Google projects private until it audits the project. OpenClip uploads privately by default. When you're ready, switch a video to public in YouTube Studio. If you want public uploads straight from OpenClip, apply through Google's YouTube API audit form.
- **About 6 uploads a day.** Google's free quota covers about 6 uploads a day per project. It resets at midnight Pacific Time.
- **Changing account or app:** click **Disconnect**, then open **YouTube setup** again.

---

## Fixes for the usual errors

When something fails, OpenClip and the page that opens after you sign in to Google say what went wrong. Find the message here.

| What you see | Why | Fix |
|---|---|---|
| **"Access blocked: … has not completed the Google verification process"** (Error 403: access_denied) | The account you signed in with isn't allowed to use the app. | **Personal app:** sign in with the account that made the app. **Classic app:** add that exact email under **Audience → Test users**. Then click **Connect YouTube** again. |
| **"client_user_mismatch"** / "only its owner can use this app" | You picked a different account at sign-in. | Click **Connect YouTube** again and pick the account you used in Step 2. |
| **"Error 400: redirect_uri_mismatch"** or **"That JSON is for a Web application client"** | The client is the wrong type. | Make a new client with Application type **Desktop app**, download its JSON and save it again (Step 4). |
| **"That is a service account key"** | You downloaded a service account key, not an OAuth client. | Make a **Desktop app** client (Step 2) and use its JSON. |
| **"YouTube Data API v3 is turned off"** / "has not been used in project … or it is disabled" | The API isn't on in the project that owns your client. | Do Step 3 in the **same project**, wait two minutes, then connect again. |
| **"The JSON has no client secret"** or **"invalid_client"** | The secret is missing, or was changed or deleted. | Open [Clients](https://console.cloud.google.com/auth/clients), open your client, click **Add secret**, download the JSON again and save it in OpenClip. |
| **"deleted_client"** | The client in your JSON was deleted. | Make a new Desktop app client and save its JSON. |
| **"OpenClip wasn't given permission to upload"** | A box on Google's permission page was left unticked. | Click **Disconnect**, then **Connect YouTube**, and tick every box. |
| **"This Google account has no YouTube channel yet"** | That account has no channel. | Create one on youtube.com (profile picture → **Create a channel**), or connect with the account that owns the channel. |
| **"Your Google Workspace administrator blocks this app"** | A work or school account limits apps. | Ask the admin to allow it, or use the personal account that owns the channel. |
| It worked, but a week later uploads fail (**"invalid_grant"**) | Classic External apps in testing expire after 7 days. | Click **Disconnect** and **Connect YouTube** again, or remake the app with the Personal page (Step 2) to stop this. |
| **"Google hasn't verified this app"** | Normal for classic External apps. | Click **Advanced → Go to OpenClip (unsafe)**. |
| Uploads are **private** even when set to public | New projects are locked to private until YouTube audits them. | Make the video public in YouTube Studio, or apply for the audit. |
| **"used up today's free YouTube quota"** | Google's free quota covers about 6 uploads a day. | Wait until after midnight Pacific Time. |
| **"YouTube's own daily upload limit … is reached"** | Your channel reached YouTube's own daily upload limit. | Try again in 24 hours. Verifying your phone number in YouTube Studio raises the limit. |
| The **Connect YouTube** button is greyed out | No JSON has been saved yet. | Do Step 4 first. |
| The Google tab says **"This site can't be reached"** after you allow access | OpenClip was closed, or runs on a different address. | Keep OpenClip running, open it at the address `npm start` printed (usually `http://localhost:5173`), and connect again from there. |

Still stuck? [Open an issue](https://github.com/jaspher19/open-clip-editor/issues) and include the exact message. Never post your JSON file or its secret.

*Steps checked against Google's help pages for the Google Auth Platform: [Get started](https://support.google.com/cloud/answer/15544987), [Audience](https://support.google.com/cloud/answer/15549945) and [Clients](https://support.google.com/cloud/answer/15549257).*
