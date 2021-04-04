# datawizard

## Running
```bash
cp .env .env.local
vim .env.local # Set your DB info
npm install
npm run electron:serve
```

## Need to SSH Tunnel?

Replace `4545` with a port you want to use on your `localhost`. This example
assumes the db is on port `5432` and the db host is `postgres.my-hidden-db.my-website.com`

```bash
ssh -N -L 4545:postgres.my-hidden-db.my-website.com:5432 user@bastion-domain.com
```

Then your env.local file would look like this
```bash
DB_HOST=localhost
DB_PORT=4545
DB_USER=my-db-user
DB_PASS=my-db-pass
```

## How to use
- Find a complex query that isn't returning an expected record
- paste in the text editor area
- type in the schema.table.column and value in the boxes above
  of the record that should be in the resultset of the query
- Hit debug query button
- After a moment it should highlight any problems with JOIN conditions or WHERE conditions
  preventing that record from being in the resulset. If there are errors in the JOIN
  conditions there may be potentially other problems not being reported, so you may have to
  run again after fixing the JOIN(s)