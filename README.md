# draw2sql

[![npm](https://img.shields.io/npm/v/draw2sql)](https://www.npmjs.com/package/draw2sql)

Generate SQL DDL from a draw.io XML ER diagram.

## Dependencies

**Runtime:** Node.js 18 or later. No other dependencies — the published package is a single compiled JavaScript file.

**To build from source:** Node.js 18+, TypeScript 5+, ts-node 10+.

## Installation

### Run without installing (recommended)

No install needed. `npx` downloads and runs draw2sql on the fly:

```powershell
npx draw2sql --input schema.drawio --dialect postgres
```

On first use, `npx` may prompt: _"Need to install the following packages: draw2sql. Ok to proceed?"_ — press `y` to continue. The package is cached in a temp location and the prompt won't appear again until the cache expires.

### Install as a project dev dependency

Add draw2sql to a project's dev dependencies so it's available via `npx` without downloading each time:

```powershell
npm install --save-dev draw2sql
npx draw2sql --input schema.drawio --dialect postgres
```

Or add a script to your project's `package.json` and skip `npx` entirely:

```json
"scripts": {
  "generate-sql": "draw2sql --input schema.drawio --dialect postgres"
}
```

```powershell
npm run generate-sql
```

`npm run` automatically looks in `node_modules/.bin`, so no `npx` is needed in scripts.

### Install globally

Install once and run as a plain command from anywhere:

```powershell
npm install -g draw2sql
draw2sql --input schema.drawio --dialect postgres
```

To uninstall: `npm uninstall -g draw2sql`

## Usage

If `--output` is omitted, the output file is derived from the input filename with a `.<dialect>.sql` extension:

```powershell
npx draw2sql --input schema.drawio --dialect postgres
# writes schema.postgres.sql
```

If `--output` already exists, draw2sql fails by default to prevent accidental overwrite. Use `--overwrite` (or `-f`) to replace it:

```powershell
npx draw2sql --input schema.drawio --dialect postgres --overwrite
```

### Naming cases

By default, draw2sql uses `db-default` naming:

| SQL Dialect | Convention | Case | Traditional Identifier Quoting | If Unquoted |
| --- | --- | --- | --- | --- |
| `postgres` | `snake_case` | `snake` | `"name"` | Folded to lowercase (`MyTable` -> `mytable`); names with spaces fail unless quoted |
| `mariadb` / `mysql` | `snake_case` | `snake` | `` `name` `` | Works for simple names; reserved words/special chars fail; spaces require quoting |
| `sqlite` | `snake_case` | `snake` | `"name"` | Usually case-insensitive matching; names with spaces require quoting |
| `sqlserver` | `PascalCase` | `pascal` | `[name]` | Works for regular names; reserved words/special chars fail; spaces require quoting |
| `oracle` | `SCREAMING_SNAKE_CASE` | `screaming_snake` | `"NAME"` | Folded to uppercase (`mytable` -> `MYTABLE`); names with spaces fail unless quoted |

Override with:

```powershell
npx draw2sql -i schema.drawio -d postgres --table-case snake --field-case snake
```

Supported cases:
- `as-drawn` (no transformation)
- `db-default` (default; depends on `--dialect`)
- `pascal`
- `camel`
- `snake`
- `screaming_snake`
- `kebab`

Supported dialects:
- `postgres`
- `mariadb` (also accepts `mysql`)
- `sqlserver`
- `sqlite`
- `oracle`

## Diagram parameter block

You can add a text block in draw.io that includes parameters. Example:

```text
draw2sql
dialect = oracle
schema = FILEOMATIC
```

When present, recognized keys are captured and included in SQL output comments.
- `dialect` (also `sqldialect`, `flavor`, `sqlFlavor`) overrides the CLI dialect.
- `schema` qualifies generated table names (e.g. `"myschema"."users"`). If omitted, table names are unqualified and the database will use its session default (`public` for postgres, `dbo` for sqlserver, the connected user's schema for oracle, etc.). Ignored for `sqlite`, which has no schema concept.

## Multi-page diagrams

If your draw.io file has multiple pages (tabs), draw2sql merges all tables from all pages into a single SQL output file. There is no per-page separation. This is useful when pages represent subject areas of the same schema; if your pages represent entirely separate schemas, run draw2sql once per file.

> **Note:** draw2sql requires the diagram to be saved in uncompressed XML format. If a page's content appears compressed (draw.io can optionally base64-encode page content), that page's tables will be silently skipped.

## Output strategy

Generated SQL is idempotent-oriented and includes:
1. create-table pass
2. add-missing-columns pass
3. inferred foreign-key pass

This generator infers column types/keys from draw.io table shapes and labels (for example `PK`, `FK`, `Name: varchar(120)`, `ProviderId (FK)`).

## Notes on Oracle

Oracle output uses PL/SQL blocks for create/alter operations with existence checks so scripts can be rerun safely.
