import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { extractTextFromPdf } from "./extract/pdfText.js";
import { parseInvoiceFromText } from "./extract/parseInvoice.js";
import { writeExcel } from "./excel/writeExcel.js";

async function main() {
  const inputDir = process.env.INPUT_DIR || path.resolve("invoices");
  const outputDir = path.resolve("output");
  const outputXlsx =
    process.env.OUTPUT_XLSX || path.join(outputDir, "facturas.xlsx");

  // Crear carpeta invoices si no existe
  if (!fs.existsSync(inputDir)) {
    console.log(
      "📂 Carpeta 'invoices' no encontrada. Creándola automáticamente...",
    );
    fs.mkdirSync(inputDir, { recursive: true });
    console.log(
      "👉 Agregá tus facturas PDF dentro de ./invoices y volvé a ejecutar el script.",
    );
    return;
  }

  // Crear carpeta output si no existe
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const files = fs
    .readdirSync(inputDir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"));

  if (files.length === 0) {
    console.log("⚠️ No se encontraron archivos PDF en la carpeta 'invoices'.");
    console.log("👉 Agregá al menos una factura PDF y ejecutá nuevamente.");
    return;
  }

  console.log(`📄 Encontré ${files.length} PDFs en ${inputDir}`);

  const results = [];

  for (const f of files) {
    const full = path.join(inputDir, f);
    console.log(`🔍 Procesando: ${f}`);

    try {
      const buffer = fs.readFileSync(full);
      const text = await extractTextFromPdf(buffer);
      const parsed = parseInvoiceFromText(text, f);
      results.push(parsed);
    } catch (e: any) {
      console.error("❌ ERROR REAL:", e);
      results.push({
        fileName: f,
        status: "ERROR",
        errores: [`${e?.message ?? String(e)}`],
      });
    }
  }

  await writeExcel(outputXlsx, results as any);
  console.log(`✅ Excel generado en: ${outputXlsx}`);
}

main().catch((e) => {
  console.error("❌ Error fatal:", e);
  process.exit(1);
});
