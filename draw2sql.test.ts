import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DialectResolver,
  NameStyleResolver,
  NameStyler,
  CliParser,
  DrawIoDiagramParser,
  SqlTypeMapper,
} from "./draw2sql";

// ─── DialectResolver ───────────────────────────────────────────────────────────

test("DialectResolver: normalizes dialect aliases", () => {
  assert.equal(DialectResolver.normalize("postgresql"), "postgres");
  assert.equal(DialectResolver.normalize("POSTGRES"), "postgres");
  assert.equal(DialectResolver.normalize("mysql"), "mariadb");
  assert.equal(DialectResolver.normalize("mariadb"), "mariadb");
  assert.equal(DialectResolver.normalize("mssql"), "sqlserver");
  assert.equal(DialectResolver.normalize("sqlite3"), "sqlite");
  assert.equal(DialectResolver.normalize("oracledb"), "oracle");
});

test("DialectResolver: returns null for unknown dialect", () => {
  assert.equal(DialectResolver.normalize("unknown"), null);
  assert.equal(DialectResolver.normalize(""), null);
});

// ─── NameStyleResolver ────────────────────────────────────────────────────────

test("NameStyleResolver: normalizes style aliases", () => {
  assert.equal(NameStyleResolver.normalize("snake_case"), "snake");
  assert.equal(NameStyleResolver.normalize("pascalcase"), "pascal");
  assert.equal(NameStyleResolver.normalize("as_drawn"), "as-drawn");
  assert.equal(NameStyleResolver.normalize("db_default"), "db-default");
  assert.equal(NameStyleResolver.normalize("default"), "db-default");
});

test("NameStyleResolver: returns null for unknown style", () => {
  assert.equal(NameStyleResolver.normalize("title"), null);
  assert.equal(NameStyleResolver.normalize("UPPER"), null);
});

// ─── NameStyler ───────────────────────────────────────────────────────────────

test("NameStyler.resolve: db-default maps to dialect convention", () => {
  assert.equal(NameStyler.resolve("db-default", "postgres"), "snake");
  assert.equal(NameStyler.resolve("db-default", "mariadb"), "snake");
  assert.equal(NameStyler.resolve("db-default", "sqlite"), "snake");
  assert.equal(NameStyler.resolve("db-default", "sqlserver"), "pascal");
  assert.equal(NameStyler.resolve("db-default", "oracle"), "screaming_snake");
});

test("NameStyler.resolve: explicit style passes through unchanged", () => {
  assert.equal(NameStyler.resolve("camel", "postgres"), "camel");
  assert.equal(NameStyler.resolve("snake", "sqlserver"), "snake");
});

test("NameStyler.transform: snake_case", () => {
  assert.equal(NameStyler.transform("MyTableName", "snake"), "my_table_name");
  assert.equal(NameStyler.transform("userId", "snake"), "user_id");
  assert.equal(NameStyler.transform("MY_TABLE", "snake"), "my_table");
  assert.equal(NameStyler.transform("my table", "snake"), "my_table");
  assert.equal(NameStyler.transform("HTMLParser", "snake"), "html_parser");
});

test("NameStyler.transform: PascalCase", () => {
  assert.equal(NameStyler.transform("my_table_name", "pascal"), "MyTableName");
  assert.equal(NameStyler.transform("userId", "pascal"), "UserId");
  assert.equal(NameStyler.transform("my table", "pascal"), "MyTable");
});

test("NameStyler.transform: camelCase", () => {
  assert.equal(NameStyler.transform("MyTableName", "camel"), "myTableName");
  assert.equal(NameStyler.transform("user_id", "camel"), "userId");
  assert.equal(NameStyler.transform("MY_TABLE_NAME", "camel"), "myTableName");
});

test("NameStyler.transform: SCREAMING_SNAKE_CASE", () => {
  assert.equal(NameStyler.transform("MyTable", "screaming_snake"), "MY_TABLE");
  assert.equal(NameStyler.transform("userId", "screaming_snake"), "USER_ID");
});

test("NameStyler.transform: kebab-case", () => {
  assert.equal(NameStyler.transform("MyTableName", "kebab"), "my-table-name");
  assert.equal(NameStyler.transform("userId", "kebab"), "user-id");
});

test("NameStyler.transform: as-drawn preserves name exactly", () => {
  assert.equal(NameStyler.transform("My Table Name", "as-drawn"), "My Table Name");
  assert.equal(NameStyler.transform("userId", "as-drawn"), "userId");
});

test("NameStyler.transform: empty and whitespace-only strings", () => {
  assert.equal(NameStyler.transform("", "snake"), "");
  assert.equal(NameStyler.transform("   ", "pascal"), "");
});

// ─── SqlTypeMapper ────────────────────────────────────────────────────────────

test("SqlTypeMapper.infer: id columns get dialect UUID type", () => {
  assert.equal(new SqlTypeMapper("postgres").infer("id"), "uuid");
  assert.equal(new SqlTypeMapper("postgres").infer("userId"), "uuid");
  assert.equal(new SqlTypeMapper("mariadb").infer("id"), "char(36)");
  assert.equal(new SqlTypeMapper("sqlserver").infer("id"), "uniqueidentifier");
  assert.equal(new SqlTypeMapper("oracle").infer("id"), "raw(16)");
  assert.equal(new SqlTypeMapper("sqlite").infer("id"), "text");
});

test("SqlTypeMapper.infer: externalId columns get text type, not uuid", () => {
  assert.equal(new SqlTypeMapper("postgres").infer("externalId"), "text");
  assert.equal(new SqlTypeMapper("sqlserver").infer("externalId"), "nvarchar(255)");
});

test("SqlTypeMapper.infer: boolean columns (is/has prefix)", () => {
  assert.equal(new SqlTypeMapper("postgres").infer("isActive"), "boolean");
  assert.equal(new SqlTypeMapper("postgres").infer("hasChildren"), "boolean");
  assert.equal(new SqlTypeMapper("sqlserver").infer("isActive"), "bit");
  assert.equal(new SqlTypeMapper("sqlite").infer("isActive"), "integer");
  assert.equal(new SqlTypeMapper("oracle").infer("isActive"), "number(1)");
});

test("SqlTypeMapper.infer: timestamp columns (createdAt/updatedAt/deletedAt)", () => {
  assert.equal(new SqlTypeMapper("postgres").infer("createdAt"), "timestamptz");
  assert.equal(new SqlTypeMapper("mariadb").infer("updatedAt"), "datetime");
  assert.equal(new SqlTypeMapper("sqlserver").infer("deletedAt"), "datetime2");
  assert.equal(new SqlTypeMapper("oracle").infer("createdAt"), "timestamp");
});

test("SqlTypeMapper.infer: money columns (amount/price/total/cost)", () => {
  assert.equal(new SqlTypeMapper("postgres").infer("amount"), "decimal(12,2)");
  assert.equal(new SqlTypeMapper("postgres").infer("price"), "decimal(12,2)");
  assert.equal(new SqlTypeMapper("postgres").infer("totalCost"), "decimal(12,2)");
  assert.equal(new SqlTypeMapper("oracle").infer("amount"), "number(12,2)");
});

test("SqlTypeMapper.infer: count/quantity columns", () => {
  assert.equal(new SqlTypeMapper("postgres").infer("count"), "integer");
  assert.equal(new SqlTypeMapper("postgres").infer("qty"), "integer");
  assert.equal(new SqlTypeMapper("oracle").infer("quantity"), "number(10)");
});

test("SqlTypeMapper.infer: json/metadata columns", () => {
  assert.equal(new SqlTypeMapper("postgres").infer("metadata"), "jsonb");
  assert.equal(new SqlTypeMapper("mariadb").infer("metadata"), "json");
  assert.equal(new SqlTypeMapper("sqlserver").infer("metadata"), "nvarchar(max)");
  assert.equal(new SqlTypeMapper("oracle").infer("metadata"), "clob");
});

test("SqlTypeMapper.infer: unknown columns fall back to text/varchar", () => {
  assert.equal(new SqlTypeMapper("postgres").infer("name"), "text");
  assert.equal(new SqlTypeMapper("sqlite").infer("description"), "text");
  assert.equal(new SqlTypeMapper("sqlserver").infer("name"), "nvarchar(255)");
  assert.equal(new SqlTypeMapper("oracle").infer("name"), "varchar2(255)");
});

test("SqlTypeMapper.map: string type", () => {
  assert.equal(new SqlTypeMapper("postgres").map("string"), "text");
  assert.equal(new SqlTypeMapper("sqlserver").map("string"), "nvarchar(255)");
  assert.equal(new SqlTypeMapper("oracle").map("string"), "varchar2(255)");
});

test("SqlTypeMapper.map: bool type", () => {
  assert.equal(new SqlTypeMapper("postgres").map("bool"), "boolean");
  assert.equal(new SqlTypeMapper("sqlserver").map("bool"), "bit");
  assert.equal(new SqlTypeMapper("oracle").map("bool"), "number(1)");
});

test("SqlTypeMapper.map: datetime type", () => {
  assert.equal(new SqlTypeMapper("postgres").map("datetime"), "timestamptz");
  assert.equal(new SqlTypeMapper("sqlserver").map("datetime"), "datetime2");
  assert.equal(new SqlTypeMapper("oracle").map("datetime"), "timestamp");
});

test("SqlTypeMapper.map: uuid type", () => {
  assert.equal(new SqlTypeMapper("postgres").map("uuid"), "uuid");
  assert.equal(new SqlTypeMapper("mariadb").map("uuid"), "char(36)");
  assert.equal(new SqlTypeMapper("sqlserver").map("uuid"), "uniqueidentifier");
  assert.equal(new SqlTypeMapper("oracle").map("uuid"), "raw(16)");
});

test("SqlTypeMapper.map: pass-through for unrecognized types", () => {
  assert.equal(new SqlTypeMapper("postgres").map("varchar(100)"), "varchar(100)");
  assert.equal(new SqlTypeMapper("mariadb").map("tinyint"), "tinyint");
});

// ─── DrawIoDiagramParser ──────────────────────────────────────────────────────

// Minimal draw.io XML for a single table: User(id PK, name)
const SINGLE_TABLE_XML = `<mxGraphModel><root>
  <mxCell id="0"/>
  <mxCell id="1" parent="0"/>
  <mxCell id="t1" value="User" style="shape=table;startSize=30;" vertex="1" parent="1">
    <mxGeometry width="200" height="90" as="geometry"/>
  </mxCell>
  <mxCell id="r1" value="" style="shape=tableRow;" vertex="1" parent="t1">
    <mxGeometry width="200" height="30" as="geometry"/>
  </mxCell>
  <mxCell id="r1c1" value="PK" style="text;" vertex="1" parent="r1"/>
  <mxCell id="r1c2" value="id" style="text;" vertex="1" parent="r1"/>
  <mxCell id="r2" value="" style="shape=tableRow;" vertex="1" parent="t1">
    <mxGeometry width="200" height="30" as="geometry"/>
  </mxCell>
  <mxCell id="r2c1" value="name" style="text;" vertex="1" parent="r2"/>
</root></mxGraphModel>`;

// Two related tables: Order(id PK, customerId FK) → Customer(id PK)
const TWO_TABLE_XML = `<mxGraphModel><root>
  <mxCell id="0"/>
  <mxCell id="1" parent="0"/>
  <mxCell id="t1" value="Order" style="shape=table;" vertex="1" parent="1"/>
  <mxCell id="r1" value="" style="shape=tableRow;" vertex="1" parent="t1"/>
  <mxCell id="r1c1" value="PK" style="text;" vertex="1" parent="r1"/>
  <mxCell id="r1c2" value="id" style="text;" vertex="1" parent="r1"/>
  <mxCell id="r2" value="" style="shape=tableRow;" vertex="1" parent="t1"/>
  <mxCell id="r2c1" value="FK" style="text;" vertex="1" parent="r2"/>
  <mxCell id="r2c2" value="customerId" style="text;" vertex="1" parent="r2"/>
  <mxCell id="t2" value="Customer" style="shape=table;" vertex="1" parent="1"/>
  <mxCell id="r3" value="" style="shape=tableRow;" vertex="1" parent="t2"/>
  <mxCell id="r3c1" value="PK" style="text;" vertex="1" parent="r3"/>
  <mxCell id="r3c2" value="id" style="text;" vertex="1" parent="r3"/>
</root></mxGraphModel>`;

test("DrawIoDiagramParser: empty diagram has no tables", () => {
  const result = new DrawIoDiagramParser().parse("<mxGraphModel><root></root></mxGraphModel>");
  assert.equal(result.tables.length, 0);
  assert.deepEqual(result.parameters, {});
});

test("DrawIoDiagramParser: parses table name and column count", () => {
  const result = new DrawIoDiagramParser().parse(SINGLE_TABLE_XML);
  assert.equal(result.tables.length, 1);
  assert.equal(result.tables[0].name, "User");
  assert.equal(result.tables[0].columns.length, 2);
});

test("DrawIoDiagramParser: PK marker sets primaryKey and not-null", () => {
  const result = new DrawIoDiagramParser().parse(SINGLE_TABLE_XML);
  const idCol = result.tables[0].columns.find((c) => c.name === "id");
  assert.ok(idCol, "id column not found");
  assert.equal(idCol!.primaryKey, true);
  assert.equal(idCol!.nullable, false);
});

test("DrawIoDiagramParser: FK marker and name-based deduction sets referencesTable", () => {
  const result = new DrawIoDiagramParser().parse(TWO_TABLE_XML);
  const order = result.tables.find((t) => t.name === "Order");
  assert.ok(order, "Order table not found");
  const fkCol = order!.columns.find((c) => c.name === "customerId");
  assert.ok(fkCol, "customerId column not found");
  assert.equal(fkCol!.foreignKey, true);
  assert.equal(fkCol!.referencesTable, "Customer");
});

test("DrawIoDiagramParser: parses diagram parameter block", () => {
  // &#xa; is the XML entity for newline inside an attribute value
  const xml = `<mxGraphModel><root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="p1" value="draw2sql&#xa;dialect = oracle&#xa;schema = MYSCHEMA" style="text;" vertex="1" parent="1">
      <mxGeometry as="geometry"/>
    </mxCell>
  </root></mxGraphModel>`;
  const result = new DrawIoDiagramParser().parse(xml);
  assert.equal(result.parameters["dialect"], "oracle");
  assert.equal(result.parameters["schema"], "MYSCHEMA");
});

// ─── CliParser ────────────────────────────────────────────────────────────────

test("CliParser.parse: named flags", () => {
  const args = CliParser.parse(["--input", "schema.drawio", "--dialect", "postgres"]);
  assert.equal(args.inputFile, "schema.drawio");
  assert.equal(args.dialect, "postgres");
  assert.equal(args.overwrite, false);
  assert.equal(args.tableCase, "db-default");
  assert.equal(args.fieldCase, "db-default");
});

test("CliParser.parse: short flags -i -d -o -f", () => {
  const args = CliParser.parse(["-i", "schema.drawio", "-d", "mariadb", "-o", "out.sql", "-f"]);
  assert.equal(args.inputFile, "schema.drawio");
  assert.equal(args.dialect, "mariadb");
  assert.equal(args.outputFile, "out.sql");
  assert.equal(args.overwrite, true);
});

test("CliParser.parse: two positional args", () => {
  const args = CliParser.parse(["schema.drawio", "postgres"]);
  assert.equal(args.inputFile, "schema.drawio");
  assert.equal(args.dialect, "postgres");
});

test("CliParser.parse: three positional args sets output file", () => {
  const args = CliParser.parse(["schema.drawio", "postgres", "out.sql"]);
  assert.equal(args.inputFile, "schema.drawio");
  assert.equal(args.dialect, "postgres");
  assert.equal(args.outputFile, "out.sql");
});

test("CliParser.parse: --table-case and --field-case", () => {
  const args = CliParser.parse(["-i", "a.drawio", "-d", "postgres", "--table-case", "pascal", "--field-case", "camel"]);
  assert.equal(args.tableCase, "pascal");
  assert.equal(args.fieldCase, "camel");
});

test("CliParser.parse: options work alongside positional args", () => {
  const args = CliParser.parse(["schema.drawio", "oracle", "--table-case", "snake", "-f"]);
  assert.equal(args.inputFile, "schema.drawio");
  assert.equal(args.dialect, "oracle");
  assert.equal(args.tableCase, "snake");
  assert.equal(args.overwrite, true);
});

test("CliParser.parse: throws when --input is missing", () => {
  assert.throws(() => CliParser.parse(["--dialect", "postgres"]));
});

test("CliParser.parse: throws when --dialect is missing", () => {
  assert.throws(() => CliParser.parse(["--input", "schema.drawio"]));
});

test("CliParser.parse: throws on unsupported dialect", () => {
  assert.throws(
    () => CliParser.parse(["--input", "schema.drawio", "--dialect", "unknown"]),
    /Unsupported SQL dialect/
  );
});
