export type ExtractionStatus = "OK" | "NEEDS_REVIEW" | "ERROR";

export interface InvoiceExtractionResult {
  razonSocial?: string;
  cuit?: string;
  tipoFactura?: string; // A/B/C/X/etc
  numeroFactura?: string; // 0001-00001234 o variantes
  fechaEmision?: string; // dd/mm/yyyy (MVP) o ISO si luego normalizamos
  moneda?: string; // ARS/USD
  tc?: string; // tipo de cambio (si aplica)

  caeTipo?: "CAE" | "CAI" | "CAEA" | null;
  caeValor?: string | null;

  conceptos?: string; // MVP: bloque/fragmento
  cantidad?: string; // MVP: VER_EN_PDF o texto
  preciosUnitarios?: string; // MVP: VER_EN_PDF o texto
  retenciones?: string; // texto o monto
  iva?: string; // texto o monto

  // ── Datos enriquecidos desde el Glosario Maestro ──
  contactoOdoo?: string; // Nombre del proveedor en Odoo
  cuentaContable?: string; // Cuenta contable asignada
  productoOdoo?: string; // Producto en Odoo (puede ser múltiple para variables)
  ivaOdoo?: string; // Alícuota de IVA según Odoo
  impuestosIdExterno?: string; // ID externo del impuesto en Odoo
  enGlosario?: boolean; // true si se encontró en el glosario

  status: ExtractionStatus;
  errores: string[];

  fileName: string;
}
