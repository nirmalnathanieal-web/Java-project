# MediReminder

MediReminder uses Node.js and SQLite to save registered accounts, medicines, and profile details.

## Run locally

1. Install Node.js 20 or newer.
2. Open a terminal in this project folder and install dependencies:

   ```powershell
   npm.cmd install
   ```

3. Start the app:

   ```powershell
   npm.cmd start
   ```

4. Open [http://localhost:3000](http://localhost:3000), choose **Create Account**, and register.

The SQLite database is created automatically at `data/medireminder.sqlite`. Keep the server running while using the app. The database is local to this computer and is excluded from source control.
