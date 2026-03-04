import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import {
  listPdfsInFolder,
  listSubfolders, // ← agregar este import
  downloadFile,
  uploadExcel,
  loadProcessedIds,
  saveProcessedIds,
} from "./drive/driveSync.js";
import { extractTextFromPdf } from "./extract/pdfText.js";
import { parseInvoiceFromText } from "./extract/parseInvoice.js";
import { writeExcel } from "./excel/writeExcel.js";

const ROOT_FOLDER_ID = process.env.DRIVE_FOLDER_ID!; // ← renombrado
const OUTPUT_XLSX =
  process.env.OUTPUT_XLSX || path.resolve("output/facturas.xlsx");

const INTERVAL_HOURS = Number(process.env.CRON_INTERVAL_HOURS ?? 6);
const INTERVAL_MS = INTERVAL_HOURS * 60 * 60 * 1000;

async function runPipeline() {
  const now = new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  console.log(`\n⏰ [${now}] Iniciando pipeline...`);

  if (!ROOT_FOLDER_ID) {
    console.error("❌ Falta variable de entorno DRIVE_FOLDER_ID");
    return;
  }

  // ← NUEVO: detectar subcarpeta semanal más reciente
  const subfolders = await listSubfolders(ROOT_FOLDER_ID);
  if (subfolders.length === 0) {
    console.log("📁 No hay carpetas semanales todavía. Nada que procesar.");
    return;
  }
  const currentFolder = subfolders[0];
  if (!currentFolder) {
    console.log("📁 No hay carpetas semanales todavía. Nada que procesar.");
    return;
  }
  console.log(`📁 Carpeta activa: ${currentFolder.name}`);
  const FOLDER_ID = currentFolder.id; // ← usa la carpeta de la semana

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
      processedIds.add(file.id);
    }
  }

  // 4. Generar Excel local
  const outputDir = path.dirname(OUTPUT_XLSX);
  fs.mkdirSync(outputDir, { recursive: true });
  await writeExcel(OUTPUT_XLSX, results as any);
  console.log(`📊 Excel generado localmente: ${OUTPUT_XLSX}`);

  // 5. Subir Excel a la misma carpeta semanal  ← CAMBIO
  const excelBuffer = fs.readFileSync(OUTPUT_XLSX);
  const excelName = `facturas_${currentFolder.name}.xlsx`; // ← nombre único por semana
  await uploadExcel(FOLDER_ID, excelName, excelBuffer);

  // 6. Guardar tracking
  await saveProcessedIds(FOLDER_ID, processedIds);

  console.log(`✅ Pipeline completado. ${results.length} facturas procesadas.`);
}

runPipeline().catch((e) => console.error("❌ Error fatal:", e));
setInterval(() => {
  runPipeline().catch((e) => console.error("❌ Error fatal en cron:", e));
}, INTERVAL_MS);

console.log(`🕐 Cron configurado: corre cada ${INTERVAL_HOURS} horas.`);
