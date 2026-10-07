# Global scoreboard setup

The game posts each saved score to a Google Sheet through an Apps Script web app
([Code.gs](Code.gs)) and reads the top 10 back. This is the one-time setup. It takes about ten
minutes and needs a Google account. Nothing here is secret: the web app URL ends up in the public
game code, and that is fine.

## Make the sheet and the script

1. Go to https://sheets.new and name the new sheet `Iron Wasteland scores`. Leave it private.
2. In the sheet's menu, choose **Extensions → Apps Script**.
3. In the `Code.gs` editor, select everything and delete it.
4. Paste in all of [Code.gs](Code.gs).
5. Press the save icon.

## Deploy it

6. Click **Deploy → New deployment**.
7. Click the gear next to "Select type" and choose **Web app**.
8. Set **Execute as** to **Me**.
9. Set **Who has access** to **Anyone**.
10. Click **Deploy**.
11. Click **Authorize access** and pick your Google account.
12. Google warns that the app is unverified (it is your own script): click **Advanced**, then
    **Go to (project name)**, then **Allow**.
13. Copy the **Web app URL** (it ends in `/exec`).

## Check it

14. Open the URL in a browser tab. It shows `[]` (no scores yet), and the sheet now has a `Scores`
    tab with a header row.

## Point the game at it

15. In `src/constants.js`, set `SCOREBOARD_URL: '<the URL>'` and open a one-line PR.

## Later changes to Code.gs

Paste the new code, then **Deploy → Manage deployments → (pencil) → Version: New version →
Deploy**. That keeps the same URL. A "New deployment" would make a new URL.

## Removing a fake score

Delete its row in the `Scores` tab. Nothing else holds a copy.
