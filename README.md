# Road Racer 3D on Cloudflare Pages (accounts + global leaderboard)

Folder layout (upload the whole folder, keep it as is):

    index.html                 the game
    functions/api/[[path]].js  the API (accounts, saves, leaderboard)
    schema.sql                 database tables
    wrangler.toml              Pages + D1 settings

## One-time setup
1. Install Wrangler and log in:  `npm i -g wrangler`  then  `wrangler login`
2. Create the database:  `wrangler d1 create road-racer`  and copy the `database_id` it prints into `wrangler.toml`.
3. Create the tables:  `wrangler d1 execute road-racer --remote --file=schema.sql`
4. Deploy this folder:  `wrangler pages deploy . --project-name road-racer-3d`
   (or connect the folder to Pages from the dashboard; then in Pages > Settings > Functions > D1 bindings add
   variable name `DB` pointing at the `road-racer` database, for Production and Preview.)

## Notes
- Passwords are hashed on the server (PBKDF2-SHA256, 100k iterations, per-user salt); sessions are random tokens stored hashed.
- Usernames are unique (case-insensitive), 3-16 letters/numbers/underscore, and checked against a block list.
  The block list lives in two places that should match: `BAD` in functions/api/[[path]].js and `BADW` in index.html.
- Progress (money, parts, skills, stats) is saved by the browser, so a determined player could edit it. The leaderboard
  accepts only plausible times (3.3 min to 2 h) and keeps each player's best.
