import ExcelJS from "exceljs";

export interface GlosarioEntry {
  contactoOdoo: string;
  contactoArca: string;
  cuit: string;
  cuentaContable: string;
  producto: string | null;
  iva: string;
  percepciones: string | null;
  impuestosIdExterno: string | null;
}

export interface ProveedorVariable {
  contactoOdoo: string;
  producto: string;
  cuenta: string;
  ocurrencias: number;
  pctOcurrencia: string;
}

// Cache en memoria para no releer el archivo en cada factura
let _glosario: Map<string, GlosarioEntry> | null = null;
let _variables: Map<string, ProveedorVariable[]> | null = null;

/**
 * Carga el glosario desde un buffer xlsx y lo guarda en memoria.
 * Llamar una vez por ejecución del pipeline.
 */
export async function loadGlosario(buffer: Buffer): Promise<void> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  // ── Hoja 1: Glosario Maestro ──
  const ws1 = wb.getWorksheet("Glosario Maestro");
  _glosario = new Map();

  if (ws1) {
    ws1.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // saltar encabezado
      const cuitRaw = String(row.getCell(3).value ?? "").trim();
      if (!cuitRaw || cuitRaw === "CUIT") return;

      const entry: GlosarioEntry = {
        contactoOdoo: String(row.getCell(1).value ?? "").trim(),
        contactoArca: String(row.getCell(2).value ?? "").trim(),
        cuit: normalizeCuit(cuitRaw),
        cuentaContable: String(row.getCell(4).value ?? "").trim(),
        producto: row.getCell(5).value
          ? String(row.getCell(5).value).trim()
          : null,
        iva: String(row.getCell(6).value ?? "").trim(),
        percepciones: row.getCell(7).value
          ? String(row.getCell(7).value).trim()
          : null,
        impuestosIdExterno: row.getCell(8).value
          ? String(row.getCell(8).value).trim()
          : null,
      };

      _glosario!.set(entry.cuit, entry);
    });
  }

  // ── Hoja 2: Proveedores Variables ──
  const ws2 = wb.getWorksheet("Proveedores Variables");
  _variables = new Map();

  if (ws2) {
    let lastContacto = "";
    ws2.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const contacto = String(row.getCell(1).value ?? "").trim();
      if (contacto) lastContacto = contacto;
      if (!lastContacto) return;

      const producto = String(row.getCell(2).value ?? "").trim();
      if (!producto) return;

      const entry: ProveedorVariable = {
        contactoOdoo: lastContacto,
        producto,
        cuenta: String(row.getCell(3).value ?? "").trim(),
        ocurrencias: Number(row.getCell(4).value ?? 0),
        pctOcurrencia: String(row.getCell(5).value ?? "").trim(),
      };

      if (!_variables!.has(lastContacto)) {
        _variables!.set(lastContacto, []);
      }
      _variables!.get(lastContacto)!.push(entry);
    });
  }

  console.log(
    `📚 Glosario cargado: ${_glosario.size} proveedores, ${_variables.size} con productos variables`,
  );
}

/**
 * Busca un proveedor por CUIT normalizado.
 * Retorna null si no se encuentra.
 */
export function lookupByCuit(cuit: string): GlosarioEntry | null {
  if (!_glosario) return null;
  const normalized = normalizeCuit(cuit);
  return _glosario.get(normalized) ?? null;
}

/**
 * Retorna los productos variables de un proveedor ordenados por ocurrencia.
 */
export function getProductosVariables(
  contactoOdoo: string,
): ProveedorVariable[] {
  if (!_variables) return [];
  return _variables.get(contactoOdoo) ?? [];
}

/**
 * Normaliza CUIT al formato XX-XXXXXXXX-X
 */
function normalizeCuit(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 11) return raw;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}
