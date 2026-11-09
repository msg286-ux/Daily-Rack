# The Daily Rack

Every daily puzzle in one place. Play, log your result, and see how you rank against your friends.

- `index.html` is the whole site: newspaper design, game panels, press-pass sign-up and sign-in, logging, and per-game rankings.
- `setup.sql` creates the database tables and rules in Supabase. Run it once in Supabase → SQL Editor.
- `src/app.js` is the site's own logic, kept separately for editing; it is already built into `index.html`.

## How it works
- Players make a press pass (first name, last name, username, password) and stay signed in on that device.
- Logging: hit Share in a game, then paste on the page (or tap Log on that game).
- Rankings for each game show everyone who logged it today, ranked by that game's own scoring.
- Players can only add or change their own results. Results reset each day at midnight local time.

## Hosting
Served by GitHub Pages from the `main` branch.
