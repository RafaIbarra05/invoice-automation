import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { extractTextFromPdf } from "./extract/pdfText.js";
import { parseInvoiceFromText } from "./extract/parseInvoice.js";
import { writeExcel } from "./excel/writeExcel.js";

async function main() {
  const inputDir = process.env.INPUT_DIR || path.resolve("invoices");
  const outputXlsx =
    process.env.OUTPUT_XLSX || path.resolve("output/facturas.xlsx");

  if (!fs.existsSync(inputDir))
    throw new Error(`No existe la carpeta: ${inputDir}`);

  const files = fs
    .readdirSync(inputDir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"));
  console.log(`Encontré ${files.length} PDFs en ${inputDir}`);

  const results = [];
  for (const f of files) {
    const full = path.join(inputDir, f);
    console.log(`Procesando: ${f}`);
    try {
      const buffer = fs.readFileSync(full);
      const text = await extractTextFromPdf(buffer);
      const parsed = parseInvoiceFromText(text, f);
      results.push(parsed);
    } catch (e: any) {
      console.error("ERROR REAL:", e);
      results.push({
        fileName: f,
        status: "ERROR",
        errores: [`${e?.message ?? String(e)}`],
      });
    }
  }

  await writeExcel(outputXlsx, results as any);
  console.log(`Excel generado en: ${outputXlsx}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
