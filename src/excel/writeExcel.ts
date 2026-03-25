import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { InvoiceExtractionResult } from "../types/invoice.js";

const HEADERS = [
  // Datos del PDF
  "Razón Social",
  "CUIT",
  "Tipo de factura",
  "Número de factura",
  "Fecha de emisión",
  "Moneda",
  "TC",
  "CAE/CAI/CAEA (tipo)",
  "CAE/CAI/CAEA (valor)",
  "Conceptos",
  "Cantidad",
  "Precios unitarios",
  "Retenciones",
  "IVA",
  // Datos enriquecidos desde el Glosario
  "Contacto Odoo",
  "Cuenta Contable",
  "Producto Odoo",
  "IVA Odoo",
  "Impuestos ID Externo",
  "En Glosario",
  // Metadata
  "Status",
  "Errores",
  "Archivo",
];

export async function writeExcel(
  outputPath: string,
  rows: InvoiceExtractionResult[],
) {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Facturas");

  ws.addRow(HEADERS);

  // Estilo encabezado
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD5E8F0" },
  };

  for (const r of rows) {
    const row = ws.addRow([
      r.razonSocial ?? "",
      r.cuit ?? "",
      r.tipoFactura ?? "",
      r.numeroFactura ?? "",
      r.fechaEmision ?? "",
      r.moneda ?? "",
      r.tc ?? "",
      r.caeTipo ?? "",
      r.caeValor ?? "",
      r.conceptos ?? "",
      r.cantidad ?? "",
      r.preciosUnitarios ?? "",
      r.retenciones ?? "",
      r.iva ?? "",
      // Glosario
      r.contactoOdoo ?? "",
      r.cuentaContable ?? "",
      r.productoOdoo ?? "",
      r.ivaOdoo ?? "",
      r.impuestosIdExterno ?? "",
      r.enGlosario ? "✓" : "—",
      // Status con color
      r.status,
      r.errores.join(" | "),
      r.fileName,
    ]);

    // Color por status
    const statusCell = row.getCell(21);
    if (r.status === "OK") {
      statusCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD5F5E3" },
      };
    } else if (r.status === "NEEDS_REVIEW") {
      statusCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFEF9E7" },
      };
    } else if (r.status === "ERROR") {
      statusCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFADBD8" },
      };
    }

    // Color celda "En Glosario"
    const glosarioCell = row.getCell(20);
    if (r.enGlosario) {
      glosarioCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD5F5E3" },
      };
    } else {
      glosarioCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFADBD8" },
      };
    }
  }

  ws.columns.forEach((col) => {
    const header = String(col.header ?? "");
    col.width = Math.min(55, Math.max(14, header.length + 4));
  });

  await wb.xlsx.writeFile(outputPath);
}
