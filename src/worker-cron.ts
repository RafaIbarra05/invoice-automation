import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import {
  listPdfsInFolder,
  downloadFile,
  uploadExcel,
  loadProcessedIds,
  saveProcessedIds,
} from "./drive/driveSync.js";
import { extractTextFromPdf } from "./extract/pdfText.js";
import { parseInvoiceFromText } from "./extract/parseInvoice.js";
import { writeExcel } from "./excel/writeExcel.js";

const FOLDER_ID = process.env.DRIVE_FOLDER_ID!;
const OUTPUT_XLSX =
  process.env.OUTPUT_XLSX || path.resolve("output/facturas.xlsx");
const EXCEL_DRIVE_NAME = "facturas.xlsx";

// Intervalo en horas (por defecto cada 6 horas)
const INTERVAL_HOURS = Number(process.env.CRON_INTERVAL_HOURS ?? 6);
const INTERVAL_MS = INTERVAL_HOURS * 60 * 60 * 1000;

async function runPipeline() {
  const now = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  console.log(`\n⏰ [${now}] Iniciando pipeline...`);

  if (!FOLDER_ID) {
    console.error("❌ Falta variable de entorno DRIVE_FOLDER_ID");
    return;
  }

  // 1. Cargar ids ya procesados
  const processedIds = await loadProcessedIds(FOLDER_ID);
  console.log(`📋 IDs ya procesados: ${processedIds.size}`);

  // 2. Listar PDFs en Drive
  const allFiles = await listPdfsInFolder(FOLDER_ID);
  const newFiles = allFiles.filter((f) => !processedIds.has(f.id));

  if (newFiles.length === 0) {
    console.log("✅ No hay facturas nuevas para procesar.");
    return;
  }

  console.log(`📄 Facturas nuevas encontradas: ${newFiles.length}`);

  // 3. Procesar cada PDF nuevo
  const results = [];

  for (const file of newFiles) {
    console.log(`🔍 Procesando: ${file.name}`);
    try {
      const buffer = await downloadFile(file.id);
      const text = await extractTextFromPdf(buffer);
      const parsed = parseInvoiceFromText(text, file.name);
      results.push(parsed);
      processedIds.add(file.id);
    } catch (e: any) {
      console.error(`❌ Error procesando ${file.name}:`, e?.message ?? e);
      results.push({
        fileName: file.name,
        status: "ERROR" as const,
        errores: [e?.message ?? String(e)],
      });
      // Igual marcamos como procesado para no reintentar indefinidamente
      processedIds.add(file.id);
    }
  }

  // 4. Generar Excel local
  const outputDir = path.dirname(OUTPUT_XLSX);
  fs.mkdirSync(outputDir, { recursive: true });
  await writeExcel(OUTPUT_XLSX, results as any);
  console.log(`📊 Excel generado localmente: ${OUTPUT_XLSX}`);

  // 5. Subir Excel a Drive
  const excelBuffer = fs.readFileSync(OUTPUT_XLSX);
  await uploadExcel(
    process.env.DRIVE_OUTPUT_FOLDER_ID!,
    EXCEL_DRIVE_NAME,
    excelBuffer,
  );
  // 6. Guardar tracking actualizado
  await saveProcessedIds(FOLDER_ID, processedIds);

  console.log(`✅ Pipeline completado. ${results.length} facturas procesadas.`);
}

// Ejecutar inmediatamente al arrancar
runPipeline().catch((e) => console.error("❌ Error fatal:", e));

// Luego repetir cada INTERVAL_HOURS horas
setInterval(() => {
  runPipeline().catch((e) => console.error("❌ Error fatal en cron:", e));
}, INTERVAL_MS);

console.log(`🕐 Cron configurado: corre cada ${INTERVAL_HOURS} horas.`);
