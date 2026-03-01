import fs from "node:fs";
import path from "node:path";

type SqlFlavor = "postgres" | "mysql" | "sqlserver" | "sqlite" | "oracle";
type NameStyle = "as-drawn" | "db-default" | "pascal" | "camel" | "snake" | "screaming_snake" | "kebab";

interface CliArgs {
  inputFile: string;
  outputFile: string;
  flavor: SqlFlavor;
  tableNameStyle: NameStyle;
  fieldNameStyle: NameStyle;
  overwrite: boolean;
}

interface XmlCell {
  id: string;
  parent?: string;
  style: string;
  value: string;
  vertex: boolean;
  edge: boolean;
  source?: string;
  target?: string;
}

interface ColumnDef {
  name: string;
  rawType?: string;
  inferredType?: string;
  nullable: boolean;
  primaryKey: boolean;
  foreignKey: boolean;
  unique: boolean;
  referencesTable?: string;
  referencesColumn?: string;
}

interface TableDef {
  id: string;
  name: string;
  columns: ColumnDef[];
}

interface ParsedDiagram {
  tables: TableDef[];
  parameters: Record<string, string>;
}

interface GeneratorSettings {
  flavor: SqlFlavor;
  schema?: string;
}

interface NamingSettings {
  tableNameStyle: NameStyle;
  fieldNameStyle: NameStyle;
}

const DEFAULT_REF_COLUMN = "Id";
const MARKER_WORDS = new Set(["PK", "FK", "NN", "NOT NULL", "UNIQUE", "UQ"]);

class FlavorResolver {
  static normalize(input: string): SqlFlavor | null {
    const normalized = input.trim().toLowerCase();
    if (normalized === "postgres" || normalized === "postgresql") return "postgres";
    if (normalized === "mysql") return "mysql";
    if (normalized === "sqlserver" || normalized === "mssql") return "sqlserver";
    if (normalized === "sqlite" || normalized === "sqlite3") return "sqlite";
    if (normalized === "oracle" || normalized === "oracledb") return "oracle";
    return null;
  }
}

class NameStyleResolver {
  static normalize(input: string): NameStyle | null {
    const normalized = input.trim().toLowerCase();
    if (normalized === "as-drawn" || normalized === "asdrawn" || normalized === "as_drawn") return "as-drawn";
    if (normalized === "db-default" || normalized === "dbdefault" || normalized === "db_default" || normalized === "default") return "db-default";
    if (normalized === "pascal" || normalized === "pascalcase") return "pascal";
    if (normalized === "camel" || normalized === "camelcase") return "camel";
    if (normalized === "snake" || normalized === "snake_case" || normalized === "snakecase") return "snake";
    if (normalized === "screaming_snake" || normalized === "screaming-snake" || normalized === "screamingsnake") return "screaming_snake";
    if (normalized === "kebab" || normalized === "kebab-case" || normalized === "kebabcase") return "kebab";
    return null;
  }
}

class NameStyler {
  private static resolveDbDefault(flavor: SqlFlavor): Exclude<NameStyle, "db-default"> {
    if (flavor === "sqlserver") return "pascal";
    if (flavor === "oracle") return "screaming_snake";
    return "snake";
  }

  static resolve(style: NameStyle, flavor: SqlFlavor): Exclude<NameStyle, "db-default"> {
    return style === "db-default" ? NameStyler.resolveDbDefault(flavor) : style;
  }

  static apply(tables: TableDef[], flavor: SqlFlavor, naming: NamingSettings): { tableStyle: Exclude<NameStyle, "db-default">; fieldStyle: Exclude<NameStyle, "db-default"> } {
    const tableStyle = NameStyler.resolve(naming.tableNameStyle, flavor);
    const fieldStyle = NameStyler.resolve(naming.fieldNameStyle, flavor);

    const usedTableNames = new Set<string>();
    const tableOldToNew = new Map<string, string>();
    const colOldToNewByTable = new Map<string, Map<string, string>>();

    for (const table of tables) {
      const oldTableName = table.name;
      const styledTableName = NameStyler.uniqueName(NameStyler.transform(oldTableName, tableStyle), usedTableNames, tableStyle);
      tableOldToNew.set(oldTableName, styledTableName);

      const usedColNames = new Set<string>();
      const colOldToNew = new Map<string, string>();
      for (const col of table.columns) {
        const oldColName = col.name;
        const styledColName = NameStyler.uniqueName(NameStyler.transform(oldColName, fieldStyle), usedColNames, fieldStyle);
        colOldToNew.set(oldColName, styledColName);
      }
      colOldToNewByTable.set(oldTableName, colOldToNew);
    }

    for (const table of tables) {
      const oldTableName = table.name;
      const colOldToNew = colOldToNewByTable.get(oldTableName);
      table.name = tableOldToNew.get(oldTableName) ?? table.name;

      for (const col of table.columns) {
        const oldColName = col.name;
        col.name = colOldToNew?.get(oldColName) ?? col.name;
      }
    }

    for (const table of tables) {
      for (const col of table.columns) {
        const refTableOld = col.referencesTable;
        if (!refTableOld) continue;

        col.referencesTable = tableOldToNew.get(refTableOld) ?? refTableOld;

        const refColOld = col.referencesColumn;
        if (!refColOld) continue;

        const refColMap = colOldToNewByTable.get(refTableOld);
        col.referencesColumn = refColMap?.get(refColOld) ?? refColOld;
      }
    }

    return { tableStyle, fieldStyle };
  }

  static transform(name: string, style: Exclude<NameStyle, "db-default">): string {
    const trimmed = name.trim();
    if (!trimmed) return trimmed;
    if (style === "as-drawn") return trimmed;

    const words = NameStyler.words(trimmed);
    if (words.length === 0) return trimmed;

    if (style === "snake") return words.map((w) => w.toLowerCase()).join("_");
    if (style === "screaming_snake") return words.map((w) => w.toUpperCase()).join("_");
    if (style === "kebab") return words.map((w) => w.toLowerCase()).join("-");
    if (style === "pascal") return words.map((w) => NameStyler.capitalize(w)).join("");
    if (style === "camel") {
      const [first, ...rest] = words;
      return [first.toLowerCase(), ...rest.map((w) => NameStyler.capitalize(w))].join("");
    }

    return trimmed;
  }

  private static words(input: string): string[] {
    const withCamelBoundaries = input
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
    const normalized = withCamelBoundaries.replace(/[^A-Za-z0-9]+/g, " ");
    return normalized.split(/\s+/).map((w) => w.trim()).filter(Boolean);
  }

  private static capitalize(word: string): string {
    if (!word) return word;
    const lower = word.toLowerCase();
    return lower[0].toUpperCase() + lower.slice(1);
  }

  private static uniqueName(base: string, used: Set<string>, style: Exclude<NameStyle, "db-default">): string {
    const trimmed = base.trim();
    if (!trimmed) return trimmed;

    if (!used.has(trimmed)) {
      used.add(trimmed);
      return trimmed;
    }

    let i = 2;
    while (true) {
      const candidate = `${trimmed}${NameStyler.suffix(style, i)}`;
      if (!used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
      i++;
    }
  }

  private static suffix(style: Exclude<NameStyle, "db-default">, i: number): string {
    if (style === "kebab") return `-${i}`;
    if (style === "snake" || style === "screaming_snake" || style === "as-drawn") return `_${i}`;
    return `${i}`;
  }
}

class CliParser {
  static parse(argv: string[]): CliArgs {
    const positional = argv.filter((x) => !x.startsWith("--"));

    let inputFile = "";
    let outputFile = "";
    let flavor = "";
    let tableNameStyle: NameStyle = "db-default";
    let fieldNameStyle: NameStyle = "db-default";
    let overwrite = false;

    if (positional.length >= 3) {
      [inputFile, flavor, outputFile] = positional;
    }

    for (let i = 0; i < argv.length; i++) {
      const token = argv[i];
      const next = argv[i + 1];
      if (token === "--input" && next) inputFile = next;
      if (token === "--output" && next) outputFile = next;
      if (token === "--flavor" && next) flavor = next;
      if ((token === "--table-name-style" || token === "--table-style") && next) {
        const normalized = NameStyleResolver.normalize(next);
        if (!normalized) throw new Error(`Unsupported table name style: ${next}`);
        tableNameStyle = normalized;
      }
      if ((token === "--field-name-style" || token === "--field-style" || token === "--column-name-style" || token === "--column-style") && next) {
        const normalized = NameStyleResolver.normalize(next);
        if (!normalized) throw new Error(`Unsupported field name style: ${next}`);
        fieldNameStyle = normalized;
      }
      if (token === "--overwrite" || token === "-f") overwrite = true;
    }

    if (!inputFile || !outputFile || !flavor) {
      throw new Error([
        "Usage:",
        "  ts-node draw2sql/draw2sql.ts <input.drawio> <sqlFlavor> <output.sql>",
        "  ts-node draw2sql/draw2sql.ts --input <input.drawio> --flavor <sqlFlavor> --output <output.sql>",
        "  ts-node draw2sql/draw2sql.ts --input <input.drawio> --flavor <sqlFlavor> --output <output.sql> --table-name-style <style> --field-name-style <style>",
        "  ts-node draw2sql/draw2sql.ts --input <input.drawio> --flavor <sqlFlavor> --output <output.sql> --overwrite",
        "",
        "Supported sqlFlavor: postgres | mysql | sqlserver | sqlite | oracle",
        "Supported styles: as-drawn | db-default | pascal | camel | snake | screaming_snake | kebab",
        "Flags: --overwrite | -f",
      ].join("\n"));
    }

    const normalizedFlavor = FlavorResolver.normalize(flavor);
    if (!normalizedFlavor) {
      throw new Error(`Unsupported SQL flavor: ${flavor}`);
    }

    return {
      inputFile,
      outputFile,
      flavor: normalizedFlavor,
      tableNameStyle,
      fieldNameStyle,
      overwrite,
    };
  }
}

class XmlText {
  static decode(input: string): string {
    return input
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  }

  static stripHtml(input: string): string {
    return XmlText.decode(input)
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/\\n/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\u00A0/g, " ")
      .trim();
  }

  static normalizeColumnName(name: string): string {
    return name.replace(/^`|`$/g, "").replace(/^\[|\]$/g, "").replace(/^"|"$/g, "").trim();
  }
}

class DrawIoDiagramParser {
  parse(xml: string): ParsedDiagram {
    const cells = this.parseCells(xml);
    const cellsById = new Map(cells.map((c) => [c.id, c]));
    const cellsByParent = this.indexByParent(cells);

    const tableCells = cells.filter((c) => c.vertex && /(?:^|;)shape=table(?:;|$)/.test(c.style));
    const tables: TableDef[] = tableCells
      .map((tableCell) => {
        const name = XmlText.stripHtml(tableCell.value).replace(/\s+/g, " ").trim();
        const columns = this.extractTableColumns(cellsByParent, tableCell);
        const table: TableDef = { id: tableCell.id, name, columns };
        this.assignImplicitKeys(table);
        return table;
      })
      .filter((t) => t.name.length > 0);

    this.bindEdgeBasedRelationships(cells, cellsById, cellsByParent, tables);
    this.deduceForeignKeyTargets(tables);

    const parameters: Record<string, string> = {};
    for (const cell of cells) {
      if (!cell.vertex || cell.style.includes("shape=table") || !cell.value) continue;
      const parsed = this.parseParameterBlock(XmlText.stripHtml(cell.value));
      for (const [k, v] of Object.entries(parsed)) {
        parameters[k] = v;
      }
    }

    return { tables, parameters };
  }

  private parseCells(xml: string): XmlCell[] {
    const cells: XmlCell[] = [];
    const cellRegex = /<mxCell\b([^>]*?)(?:\/>|>)/g;

    for (const match of xml.matchAll(cellRegex)) {
      const attrs = this.parseAttributes(match[1] ?? "");
      if (!attrs.id) continue;

      cells.push({
        id: attrs.id,
        parent: attrs.parent,
        style: attrs.style ?? "",
        value: attrs.value ?? "",
        vertex: attrs.vertex === "1",
        edge: attrs.edge === "1",
        source: attrs.source,
        target: attrs.target,
      });
    }

    return cells;
  }

  private parseAttributes(rawAttrs: string): Record<string, string> {
    const out: Record<string, string> = {};
    const attrRegex = /([a-zA-Z_][\w:-]*)\s*=\s*"([^"]*)"/g;
    for (const match of rawAttrs.matchAll(attrRegex)) {
      out[match[1]] = XmlText.decode(match[2]);
    }
    return out;
  }

  private indexByParent(cells: XmlCell[]): Map<string, XmlCell[]> {
    const map = new Map<string, XmlCell[]>();
    for (const cell of cells) {
      if (!cell.parent) continue;
      if (!map.has(cell.parent)) map.set(cell.parent, []);
      map.get(cell.parent)?.push(cell);
    }
    return map;
  }

  private parseParameterBlock(text: string): Record<string, string> {
    const params: Record<string, string> = {};
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const hasMarker = lines.some((l) => /draw2sql/i.test(l));

    for (const line of lines) {
      const cleaned = line.replace(/^draw2sql\s*[:\-]?\s*/i, "");
      const m = cleaned.match(/^([A-Za-z0-9_ .-]+)\s*[:=]\s*(.+)$/);
      if (!m) continue;

      const key = m[1].toLowerCase().replace(/[\s_.-]+/g, "");
      const value = m[2].trim();
      if (!value) continue;

      if (!hasMarker && !(key.includes("sql") || key === "schema" || key === "flavor")) {
        continue;
      }

      params[key] = value;
    }

    return params;
  }

  private parseColumnLabel(raw: string): ColumnDef | null {
    let text = XmlText.stripHtml(raw).replace(/\s+/g, " ").trim();
    if (!text) return null;

    const markers = new Set<string>();

    const trailingMeta = text.match(/\(([^)]+)\)\s*$/);
    if (trailingMeta) {
      for (const part of trailingMeta[1].split(/[;,/|]/)) {
        const word = part.trim().toUpperCase();
        if (MARKER_WORDS.has(word)) markers.add(word);
      }
      text = text.slice(0, trailingMeta.index).trim();
    }

    const bracketMeta = text.match(/\[([^\]]+)\]$/);
    if (bracketMeta) {
      for (const part of bracketMeta[1].split(/[;,/|]/)) {
        const word = part.trim().toUpperCase();
        if (MARKER_WORDS.has(word)) markers.add(word);
      }
      text = text.slice(0, bracketMeta.index).trim();
    }

    let name = text;
    let rawType: string | undefined;

    if (text.includes(":")) {
      const [left, ...right] = text.split(":");
      name = left.trim();
      rawType = right.join(":").trim() || undefined;
    } else {
      const tokens = text.split(" ").filter(Boolean);
      if (tokens.length >= 2 && /[a-z]/i.test(tokens[1])) {
        const possibleType = tokens.slice(1).join(" ");
        if (/^(varchar|char|text|uuid|int|bigint|decimal|numeric|date|datetime|timestamp|bool|boolean|json|jsonb|number|clob|blob)/i.test(possibleType)) {
          name = tokens[0];
          rawType = possibleType;
        }
      }
    }

    name = XmlText.normalizeColumnName(name);
    if (!name) return null;

    const upper = text.toUpperCase();
    if (upper.startsWith("PK ")) markers.add("PK");
    if (upper.startsWith("FK ")) markers.add("FK");
    if (upper.includes(" NOT NULL")) markers.add("NOT NULL");
    if (upper.startsWith("PK ")) name = name.replace(/^PK\s+/i, "").trim();
    if (upper.startsWith("FK ")) name = name.replace(/^FK\s+/i, "").trim();

    return {
      name,
      rawType,
      inferredType: undefined,
      nullable: !(markers.has("NN") || markers.has("NOT NULL") || markers.has("PK")),
      primaryKey: markers.has("PK"),
      foreignKey: markers.has("FK"),
      unique: markers.has("UNIQUE") || markers.has("UQ"),
    };
  }

  private extractTableColumns(cellsByParent: Map<string, XmlCell[]>, tableCell: XmlCell): ColumnDef[] {
    const columns: ColumnDef[] = [];
    const seen = new Set<string>();
    const tableChildren = cellsByParent.get(tableCell.id) ?? [];

    for (const row of tableChildren) {
      const isRow = row.style.includes("shape=tableRow");
      const isText = row.style.includes("text;") || row.style.startsWith("text");

      if (isRow) {
        const childParts = (cellsByParent.get(row.id) ?? []).map((c) => XmlText.stripHtml(c.value)).filter(Boolean);

        if (childParts.length === 0 && row.value) {
          const parsed = this.parseColumnLabel(row.value);
          if (parsed && !seen.has(parsed.name.toLowerCase())) {
            columns.push(parsed);
            seen.add(parsed.name.toLowerCase());
          }
          continue;
        }

        const markerWords = childParts.map((p) => p.toUpperCase()).filter((p) => MARKER_WORDS.has(p));
        const candidateName = childParts.filter((p) => !MARKER_WORDS.has(p.toUpperCase())).pop();

        if (candidateName) {
          const parsed = this.parseColumnLabel(candidateName);
          if (parsed && !seen.has(parsed.name.toLowerCase())) {
            for (const marker of markerWords) {
              if (marker === "PK") parsed.primaryKey = true;
              if (marker === "FK") parsed.foreignKey = true;
              if (marker === "NN" || marker === "NOT NULL") parsed.nullable = false;
              if (marker === "UNIQUE" || marker === "UQ") parsed.unique = true;
            }
            if (parsed.primaryKey) parsed.nullable = false;
            columns.push(parsed);
            seen.add(parsed.name.toLowerCase());
          }
        }
        continue;
      }

      if (isText) {
        const lines = XmlText.stripHtml(row.value).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          const parsed = this.parseColumnLabel(line);
          if (parsed && !seen.has(parsed.name.toLowerCase())) {
            columns.push(parsed);
            seen.add(parsed.name.toLowerCase());
          }
        }
      }
    }

    return columns;
  }

  private assignImplicitKeys(table: TableDef): void {
    if (table.columns.length === 0) return;

    const hasPk = table.columns.some((c) => c.primaryKey);
    if (!hasPk) {
      const idCol = table.columns.find((c) => c.name.toLowerCase() === "id")
        ?? table.columns.find((c) => c.name.toLowerCase() === `${table.name.toLowerCase()}id`);
      if (idCol) {
        idCol.primaryKey = true;
        idCol.nullable = false;
      }
    }

    for (const col of table.columns) {
      if (!col.foreignKey && /id$/i.test(col.name) && !col.primaryKey && col.name.toLowerCase() !== "id") {
        col.foreignKey = true;
      }
    }
  }

  private deduceForeignKeyTargets(tables: TableDef[]): void {
    const tableByName = new Map<string, TableDef>();
    for (const table of tables) {
      tableByName.set(table.name.toLowerCase(), table);
    }

    for (const table of tables) {
      for (const col of table.columns) {
        if (!col.foreignKey || col.referencesTable) continue;

        const base = col.name.replace(/id$/i, "");
        if (!base) continue;

        const candidates = [base.toLowerCase(), `${base.toLowerCase()}s`, `${base.toLowerCase()}es`];
        const target = candidates.map((key) => tableByName.get(key)).find(Boolean);
        if (!target) continue;

        col.referencesTable = target.name;
        col.referencesColumn = target.columns.find((c) => c.primaryKey)?.name ?? DEFAULT_REF_COLUMN;
      }
    }
  }

  private bindEdgeBasedRelationships(
    cells: XmlCell[],
    cellsById: Map<string, XmlCell>,
    cellsByParent: Map<string, XmlCell[]>,
    tables: TableDef[]
  ): void {
    const rowToTableName = new Map<string, string>();
    for (const t of tables) {
      const children = cellsByParent.get(t.id) ?? [];
      for (const row of children) {
        if (row.style.includes("shape=tableRow")) {
          rowToTableName.set(row.id, t.name);
          for (const part of cellsByParent.get(row.id) ?? []) {
            rowToTableName.set(part.id, t.name);
          }
        }
      }
    }

    const findColumnByCellId = (cellId: string): { table: TableDef; column: ColumnDef } | null => {
      let current: XmlCell | undefined = cellsById.get(cellId);
      while (current) {
        const tableName = rowToTableName.get(current.id);
        if (tableName) {
          const table = tables.find((t) => t.name === tableName);
          if (!table) return null;

          const textParts = [
            XmlText.stripHtml(current.value),
            ...(cellsByParent.get(current.id) ?? []).map((p) => XmlText.stripHtml(p.value)),
          ].filter(Boolean);

          for (const text of textParts) {
            const colName = XmlText.normalizeColumnName(text.replace(/^PK\s+|^FK\s+/i, ""));
            const col = table.columns.find((c) => c.name.toLowerCase() === colName.toLowerCase());
            if (col) return { table, column: col };
          }

          const likely = table.columns.find((c) => c.foreignKey) ?? table.columns.find((c) => c.primaryKey);
          if (likely) return { table, column: likely };
        }
        current = current.parent ? cellsById.get(current.parent) : undefined;
      }
      return null;
    };

    for (const edge of cells.filter((c) => c.edge && c.source && c.target)) {
      const a = findColumnByCellId(edge.source!);
      const b = findColumnByCellId(edge.target!);
      if (!a || !b || a.table.name === b.table.name) continue;

      if (a.column.foreignKey && !a.column.referencesTable) {
        a.column.referencesTable = b.table.name;
        a.column.referencesColumn = b.column.primaryKey ? b.column.name : (b.table.columns.find((c) => c.primaryKey)?.name ?? DEFAULT_REF_COLUMN);
      } else if (b.column.foreignKey && !b.column.referencesTable) {
        b.column.referencesTable = a.table.name;
        b.column.referencesColumn = a.column.primaryKey ? a.column.name : (a.table.columns.find((c) => c.primaryKey)?.name ?? DEFAULT_REF_COLUMN);
      }
    }
  }
}

class SqlTypeMapper {
  constructor(private readonly flavor: SqlFlavor) {}

  map(rawType: string): string {
    const t = rawType.trim().toLowerCase();

    if (t === "string") {
      if (this.flavor === "sqlserver") return "nvarchar(255)";
      if (this.flavor === "oracle") return "varchar2(255)";
      return "text";
    }

    if (t === "bool") {
      if (this.flavor === "sqlserver") return "bit";
      if (this.flavor === "oracle") return "number(1)";
      return "boolean";
    }

    if (t === "datetime") {
      if (this.flavor === "postgres") return "timestamptz";
      if (this.flavor === "sqlserver") return "datetime2";
      if (this.flavor === "oracle") return "timestamp";
    }

    if (t === "uuid" && this.flavor === "mysql") return "char(36)";
    if (t === "uuid" && this.flavor === "sqlserver") return "uniqueidentifier";
    if (t === "uuid" && this.flavor === "oracle") return "raw(16)";

    if ((t === "json" || t === "jsonb") && this.flavor === "oracle") return "clob";
    if (t === "text" && this.flavor === "oracle") return "clob";

    return rawType;
  }

  infer(columnName: string): string {
    const lower = columnName.toLowerCase();

    if (lower.endsWith("key")) {
      if (this.flavor === "sqlserver") return "nvarchar(255)";
      if (this.flavor === "oracle") return "varchar2(255)";
      return "text";
    }

    if (lower.includes("external") && lower.endsWith("id")) {
      if (this.flavor === "sqlserver") return "nvarchar(255)";
      if (this.flavor === "oracle") return "varchar2(255)";
      return "text";
    }

    if (lower === "id" || lower.endsWith("id")) {
      if (this.flavor === "postgres") return "uuid";
      if (this.flavor === "mysql") return "char(36)";
      if (this.flavor === "sqlserver") return "uniqueidentifier";
      if (this.flavor === "oracle") return "raw(16)";
      return "text";
    }

    if (lower.startsWith("is") || lower.startsWith("has")) {
      if (this.flavor === "sqlserver") return "bit";
      if (this.flavor === "sqlite") return "integer";
      if (this.flavor === "oracle") return "number(1)";
      return "boolean";
    }

    if (lower.includes("createdat") || lower.includes("updatedat") || lower.includes("deletedat")) {
      if (this.flavor === "postgres") return "timestamptz";
      if (this.flavor === "mysql") return "datetime";
      if (this.flavor === "sqlserver") return "datetime2";
      if (this.flavor === "oracle") return "timestamp";
      return "text";
    }

    if (lower.includes("date")) {
      if (this.flavor === "sqlite") return "text";
      if (this.flavor === "oracle") return "date";
      return "date";
    }

    if (lower.includes("amount") || lower.includes("price") || lower.includes("total") || lower.includes("cost")) {
      return this.flavor === "oracle" ? "number(12,2)" : "decimal(12,2)";
    }

    if (lower.includes("count") || lower.includes("qty") || lower.includes("quantity")) {
      return this.flavor === "oracle" ? "number(10)" : "integer";
    }

    if (lower.includes("json") || lower.includes("metadata")) {
      if (this.flavor === "postgres") return "jsonb";
      if (this.flavor === "mysql") return "json";
      if (this.flavor === "sqlserver") return "nvarchar(max)";
      if (this.flavor === "oracle") return "clob";
      return "text";
    }

    if (this.flavor === "sqlserver") return "nvarchar(255)";
    if (this.flavor === "oracle") return "varchar2(255)";
    return "text";
  }
}

class SqlDialect {
  constructor(private readonly settings: GeneratorSettings) {}

  quoteIdent(name: string): string {
    if (this.settings.flavor === "mysql") return `\`${name}\``;
    if (this.settings.flavor === "sqlserver") return `[${name}]`;
    return `"${name}"`;
  }

  qualifyTable(name: string): string {
    if (!this.settings.schema) return this.quoteIdent(name);

    if (this.settings.flavor === "sqlserver") {
      return `${this.quoteIdent(this.settings.schema)}.${this.quoteIdent(name)}`;
    }

    return `${this.quoteIdent(this.settings.schema)}.${this.quoteIdent(name)}`;
  }

  createTable(table: TableDef): string {
    const lines = this.getCreateColumns(table);

    if (this.settings.flavor === "sqlserver") {
      return [
        `IF OBJECT_ID(N'${table.name}', N'U') IS NULL`,
        "BEGIN",
        `CREATE TABLE ${this.qualifyTable(table.name)} (`,
        lines.join(",\n"),
        ");",
        "END;",
      ].join("\n");
    }

    if (this.settings.flavor === "oracle") {
      const sql = [
        `CREATE TABLE ${this.qualifyTable(table.name)} (`,
        lines.join(",\n"),
        ")",
      ].join("\n");

      return [
        "BEGIN",
        `  EXECUTE IMMEDIATE q'[${sql}]';`,
        "EXCEPTION",
        "  WHEN OTHERS THEN",
        "    IF SQLCODE != -955 THEN RAISE; END IF;",
        "END;",
        "/",
      ].join("\n");
    }

    return [
      `CREATE TABLE IF NOT EXISTS ${this.qualifyTable(table.name)} (`,
      lines.join(",\n"),
      ");",
    ].join("\n");
  }

  addColumn(tableName: string, col: ColumnDef): string {
    const colType = col.inferredType ?? col.rawType ?? "text";
    const nullSql = col.nullable ? "" : " NOT NULL";

    if (this.settings.flavor === "sqlserver") {
      return [
        `IF COL_LENGTH(N'${tableName}', N'${col.name}') IS NULL`,
        `  ALTER TABLE ${this.qualifyTable(tableName)} ADD ${this.quoteIdent(col.name)} ${colType}${nullSql};`,
      ].join("\n");
    }

    if (this.settings.flavor === "oracle") {
      const checkSchema = (this.settings.schema ?? "").toUpperCase();
      const schemaFilter = checkSchema ? ` AND owner = '${checkSchema}'` : "";
      return [
        "DECLARE",
        "  v_count NUMBER;",
        "BEGIN",
        "  SELECT COUNT(1) INTO v_count",
        "  FROM all_tab_cols",
        `  WHERE table_name = '${tableName.toUpperCase()}'${schemaFilter}`,
        `    AND column_name = '${col.name.toUpperCase()}';`,
        "  IF v_count = 0 THEN",
        `    EXECUTE IMMEDIATE q'[ALTER TABLE ${this.qualifyTable(tableName)} ADD (${this.quoteIdent(col.name)} ${colType}${nullSql})]';`,
        "  END IF;",
        "END;",
        "/",
      ].join("\n");
    }

    return `ALTER TABLE ${this.qualifyTable(tableName)} ADD COLUMN IF NOT EXISTS ${this.quoteIdent(col.name)} ${colType}${nullSql};`;
  }

  addForeignKey(table: TableDef, col: ColumnDef): string {
    if (!col.referencesTable || !col.referencesColumn) return "";

    const constraintName = `fk_${table.name}_${col.name}_${col.referencesTable}_${col.referencesColumn}`.replace(/[^A-Za-z0-9_]/g, "_");
    const tableQ = this.qualifyTable(table.name);
    const colQ = this.quoteIdent(col.name);
    const refTableQ = this.qualifyTable(col.referencesTable);
    const refColQ = this.quoteIdent(col.referencesColumn);

    if (this.settings.flavor === "postgres") {
      return [
        "DO $$",
        "BEGIN",
        `  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${constraintName}') THEN`,
        `    ALTER TABLE ${tableQ} ADD CONSTRAINT ${this.quoteIdent(constraintName)} FOREIGN KEY (${colQ}) REFERENCES ${refTableQ} (${refColQ});`,
        "  END IF;",
        "END $$;",
      ].join("\n");
    }

    if (this.settings.flavor === "mysql") {
      return [
        "SET @fk_exists := (",
        "  SELECT COUNT(1)",
        "  FROM information_schema.table_constraints",
        "  WHERE constraint_schema = DATABASE()",
        `    AND table_name = '${table.name}'`,
        `    AND constraint_name = '${constraintName}'`,
        ");",
        `SET @fk_sql := IF(@fk_exists = 0, 'ALTER TABLE ${table.name} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${col.name}) REFERENCES ${col.referencesTable} (${col.referencesColumn});', 'SELECT 1;');`,
        "PREPARE stmt FROM @fk_sql;",
        "EXECUTE stmt;",
        "DEALLOCATE PREPARE stmt;",
      ].join("\n");
    }

    if (this.settings.flavor === "sqlserver") {
      return [
        `IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'${constraintName}')`,
        `  ALTER TABLE ${tableQ} ADD CONSTRAINT ${this.quoteIdent(constraintName)} FOREIGN KEY (${colQ}) REFERENCES ${refTableQ} (${refColQ});`,
      ].join("\n");
    }

    if (this.settings.flavor === "oracle") {
      const owner = (this.settings.schema ?? "").toUpperCase();
      const ownerFilter = owner ? ` AND owner = '${owner}'` : "";
      return [
        "DECLARE",
        "  v_count NUMBER;",
        "BEGIN",
        "  SELECT COUNT(1) INTO v_count",
        "  FROM all_constraints",
        `  WHERE constraint_name = '${constraintName.toUpperCase()}'${ownerFilter};`,
        "  IF v_count = 0 THEN",
        `    EXECUTE IMMEDIATE q'[ALTER TABLE ${tableQ} ADD CONSTRAINT ${this.quoteIdent(constraintName)} FOREIGN KEY (${colQ}) REFERENCES ${refTableQ} (${refColQ})]';`,
        "  END IF;",
        "END;",
        "/",
      ].join("\n");
    }

    return `-- SQLite note: FK ${constraintName} (${table.name}.${col.name} -> ${col.referencesTable}.${col.referencesColumn}) requires table rebuild if not created initially.`;
  }

  private getCreateColumns(table: TableDef): string[] {
    const lines: string[] = [];
    const pkColumns: string[] = [];
    const uniqueConstraints: string[] = [];

    for (const col of table.columns) {
      const parts = [`${this.quoteIdent(col.name)} ${col.inferredType ?? col.rawType ?? "text"}`, col.nullable ? "" : "NOT NULL"].filter(Boolean);
      lines.push(`  ${parts.join(" ")}`);

      if (col.primaryKey) pkColumns.push(this.quoteIdent(col.name));
      if (col.unique) uniqueConstraints.push(`UNIQUE (${this.quoteIdent(col.name)})`);
    }

    if (pkColumns.length > 0) lines.push(`  PRIMARY KEY (${pkColumns.join(", ")})`);
    for (const uq of uniqueConstraints) lines.push(`  ${uq}`);

    return lines;
  }
}

class SqlGenerator {
  generate(parsed: ParsedDiagram, cliFlavor: SqlFlavor, naming: NamingSettings): { sql: string; flavor: SqlFlavor } {
    const flavorOverride = parsed.parameters.flavor ?? parsed.parameters.sqlflavor ?? parsed.parameters.sqldialect ?? parsed.parameters.sqldatabase;
    const effectiveFlavor = flavorOverride ? (FlavorResolver.normalize(flavorOverride) ?? cliFlavor) : cliFlavor;

    const schema = parsed.parameters.schema ?? parsed.parameters.defaultschema;
    const settings: GeneratorSettings = { flavor: effectiveFlavor, schema };
    const mapper = new SqlTypeMapper(settings.flavor);
    const dialect = new SqlDialect(settings);

    for (const table of parsed.tables) {
      for (const col of table.columns) {
        col.inferredType = col.rawType ? mapper.map(col.rawType) : mapper.infer(col.name);
      }
    }

    const resolvedNaming = NameStyler.apply(parsed.tables, settings.flavor, naming);

    const header: string[] = [
      "-- Generated by draw2sql",
      `-- Flavor: ${settings.flavor}`,
      `-- Table Name Style: ${naming.tableNameStyle} (${resolvedNaming.tableStyle})`,
      `-- Field Name Style: ${naming.fieldNameStyle} (${resolvedNaming.fieldStyle})`,
      `-- Generated UTC: ${new Date().toISOString()}`,
    ];

    if (settings.schema) {
      header.push(`-- Schema: ${settings.schema}`);
    }

    if (Object.keys(parsed.parameters).length > 0) {
      header.push("-- Diagram Parameters:");
      for (const [k, v] of Object.entries(parsed.parameters)) {
        header.push(`--   ${k} = ${v}`);
      }
    }

    if (parsed.tables.length === 0) {
      header.push("-- No tables detected in draw.io file.");
      return { sql: `${header.join("\n")}\n`, flavor: settings.flavor };
    }

    const sections: string[] = [header.join("\n")];

    sections.push("\n-- 1) Create missing tables");
    for (const table of parsed.tables) {
      sections.push(dialect.createTable(table));
    }

    sections.push("\n-- 2) Add missing columns");
    for (const table of parsed.tables) {
      for (const col of table.columns) {
        sections.push(dialect.addColumn(table.name, col));
      }
    }

    sections.push("\n-- 3) Add foreign keys where inferred");
    for (const table of parsed.tables) {
      for (const col of table.columns.filter((c) => c.foreignKey)) {
        const fkSql = dialect.addForeignKey(table, col);
        if (fkSql) sections.push(fkSql);
      }
    }

    return {
      sql: `${sections.join("\n\n")}\n`,
      flavor: settings.flavor,
    };
  }
}

class Draw2SqlApp {
  private readonly parser = new DrawIoDiagramParser();
  private readonly generator = new SqlGenerator();

  run(argv: string[]): void {
    const args = CliParser.parse(argv);
    const xml = fs.readFileSync(args.inputFile, "utf8");

    const parsed = this.parser.parse(xml);
    const generated = this.generator.generate(parsed, args.flavor, { tableNameStyle: args.tableNameStyle, fieldNameStyle: args.fieldNameStyle });

    this.ensureDirForFile(args.outputFile);
    if (!args.overwrite && fs.existsSync(args.outputFile)) {
      throw new Error(`Refusing to overwrite existing file: ${args.outputFile}. Pass --overwrite (or -f) to replace it.`);
    }
    fs.writeFileSync(args.outputFile, generated.sql, "utf8");

    console.log("draw2sql complete.");
    console.log(`Input: ${args.inputFile}`);
    console.log(`Flavor: ${generated.flavor}`);
    console.log(`Tables: ${parsed.tables.length}`);
    console.log(`Output: ${args.outputFile}`);
  }

  private ensureDirForFile(filePath: string): void {
    const dir = path.dirname(path.resolve(filePath));
    fs.mkdirSync(dir, { recursive: true });
  }
}

new Draw2SqlApp().run(process.argv.slice(2));
