# draw2sql

Generate SQL DDL from a draw.io XML ER diagram.

## Usage

Install dependencies first:

```powershell
npm install
```

Run directly with ts-node:

```powershell
npx ts-node draw2sql.ts <input.drawio> <sqlFlavor> <output.sql>
```

Or with named args:

```powershell
npx ts-node draw2sql.ts --input design/schema.drawio --flavor postgres --output db/generated/schema.sql
```

Or build first and run the compiled output:

```powershell
npm run build
node dist/draw2sql.js --input design/schema.drawio --flavor postgres --output db/generated/schema.sql
```

If `--output` already exists, draw2sql fails by default to prevent accidental overwrite. Use `--overwrite` (or `-f`) to replace the file.

### Naming styles

By default, draw2sql uses `db-default` naming:

| SQL Flavor | Convention | Style Code | Traditional Identifier Quoting | If Unquoted |
| --- | --- | --- | --- | --- |
| `postgres` | `snake_case` | `snake` | `"name"` | Folded to lowercase (`MyTable` -> `mytable`); names with spaces fail unless quoted |
| `mysql` | `snake_case` | `snake` | `` `name` `` | Works for simple names; reserved words/special chars fail; spaces require quoting |
| `sqlite` | `snake_case` | `snake` | `"name"` | Usually case-insensitive matching; names with spaces require quoting |
| `sqlserver` | `PascalCase` | `pascal` | `[name]` | Works for regular names; reserved words/special chars fail; spaces require quoting |
| `oracle` | `SCREAMING_SNAKE_CASE` | `screaming_snake` | `"NAME"` | Folded to uppercase (`mytable` -> `MYTABLE`); names with spaces fail unless quoted |

Override with:

```powershell
npx ts-node draw2sql.ts --input design/schema.drawio --flavor postgres --output db/generated/schema.sql --table-name-style snake --field-name-style snake
```

Overwrite example:

```powershell
npx ts-node draw2sql.ts --input design/schema.drawio --flavor postgres --output db/generated/schema.sql --overwrite
```

Supported styles:
- `as-drawn` (no transformation)
- `db-default` (default; depends on `--flavor`)
- `pascal`
- `camel`
- `snake`
- `screaming_snake`
- `kebab`

Supported flavors:
- `postgres`
- `mysql`
- `sqlserver`
- `sqlite`
- `oracle`

## Diagram parameter block

You can add a text block in draw.io that includes parameters. Example:

```text
draw2sql
sqlFlavor = oracle
schema = FILEOMATIC
```

When present, recognized keys are captured and included in SQL output comments.
- `sqlFlavor` (or `flavor`) overrides the CLI flavor.
- `schema` is used to qualify generated table names.

## Output strategy

Generated SQL is idempotent-oriented and includes:
1. create-table pass
2. add-missing-columns pass
3. inferred foreign-key pass

This generator infers column types/keys from draw.io table shapes and labels (for example `PK`, `FK`, `Name: varchar(120)`, `ProviderId (FK)`).

## Notes on Oracle

Oracle output uses PL/SQL blocks for create/alter operations with existence checks so scripts can be rerun safely.
