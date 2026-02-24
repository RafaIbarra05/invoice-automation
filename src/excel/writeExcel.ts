import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { InvoiceExtractionResult } from "../types/invoice.js";

const HEADERS = [
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
  ws.getRow(1).font = { bold: true };

  for (const r of rows) {
    ws.addRow([
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
      r.status,
      r.errores.join(" | "),
      r.fileName,
    ]);
  }

  ws.columns.forEach((col) => {
    const header = String(col.header ?? "");
    col.width = Math.min(55, Math.max(14, header.length + 4));
  });

  await wb.xlsx.writeFile(outputPath);
}
