# AI in School: A Teacher's Guide

The ERGS staff AI newsletter library. Live at **https://popcorn483.github.io/ai-newsletter/**

## Staff
Open the link and enter the staff password once. Tick "Remember me" to stay unlocked on that device; **Lock** in the top bar forgets it.

## Releasing issues (editor only)
1. Open the site and click **Staff admin**....
2. Enter `jbutler803@c2ken.net` and click **Email me a sign-in link**. Open the link on the same device.
3. In the **Release desk**:
   - **Release the next issue** releases the lowest-numbered locked issue.
   - Each issue can be **Released**, **Locked**, or **Scheduled** (it goes live automatically on its date).
   - **+ Add a new issue**: upload a finished PDF/image, or fill in the house template.
4. In the library you also get **Release / Lock** buttons on every card, and **Preview as staff**.

## Updates
Push any change to this folder and it reaches everyone automatically. Open copies (including the installed phone/tablet app) check every few minutes and every time they're reopened; when the files have changed they refresh themselves. If you're midway through adding an issue, you get an "Update now" button instead.

## How it works
- `content.enc` and `img/*.bin` hold the issues, encrypted with the staff password (AES-GCM, key from PBKDF2). The public repo never contains readable issue content.
- Release state and added issues are stored in Firestore (ergs-live project): `newsletter/state`, `newsletterIssues`, `newsletterImgs`. Added issues are encrypted in the browser before saving.
- `firestore-rules-snippet.txt` holds the rules that let only the editor account write.
- Changing the staff password means re-encrypting the content (ask Claude) and re-adding any issues uploaded through the site.
