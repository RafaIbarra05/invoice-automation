import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import {
  listPdfsInFolder,
  listSubfolders,
  downloadFile,
  downloadGlosario,
  uploadExcel,
  loadProcessedIds,
  saveProcessedIds,
} from "./drive/driveSync.js";
import { extractTextFromPdf } from "./extract/pdfText.js";
import { parseInvoiceFromText } from "./extract/parseInvoice.js";
import { writeExcel } from "./excel/writeExcel.js";
import {
  loadGlosario,
  lookupByCuit,
  getProductosVariables,
} from "./glosario/lookUpGlosario.js";

const ROOT_FOLDER_ID = process.env.DRIVE_FOLDER_ID!;
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

  // 1. Cargar Glosario Maestro desde Drive
  const glosarioBuffer = await downloadGlosario(ROOT_FOLDER_ID);
  if (glosarioBuffer) {
    await loadGlosario(glosarioBuffer);
  } else {
    console.warn(
      "⚠️ Continuando sin glosario — los campos de Odoo quedarán vacíos.",
    );
  }

  // 2. Detectar subcarpeta semanal más reciente
  const subfolders = await listSubfolders(ROOT_FOLDER_ID);
  if (subfolders.length === 0) {
    console.log("📁 No hay carpetas semanales todavía. Nada que procesar.");
    return;
  }

  const currentFolder = subfolders[0];

  console.log(`📁 Carpeta activa: ${currentFolder.name}`);
  const FOLDER_ID = currentFolder.id;

  // 3. Cargar ids ya procesados
  const processedIds = await loadProcessedIds(FOLDER_ID);

  console.log(`📋 IDs ya procesados: ${processedIds.size}`);

  // 4. Listar PDFs nuevos
  const allFiles = await listPdfsInFolder(FOLDER_ID);
  const newFiles = allFiles.filter((f) => !processedIds.has(f.id));

  if (newFiles.length === 0) {
    console.log("✅ No hay facturas nuevas para procesar.");
    return;
  }

  console.log(`📄 Facturas nuevas encontradas: ${newFiles.length}`);

  // 5. Procesar cada PDF y enriquecer con glosario
  const results = [];
  for (const file of newFiles) {
    console.log(`🔍 Procesando: ${file.name}`);
    try {
      const buffer = await downloadFile(file.id);
      const text = await extractTextFromPdf(buffer);
      const parsed = parseInvoiceFromText(text, file.name);

      // Enriquecer con Glosario Maestro
      if (parsed.cuit) {
        const entry = lookupByCuit(parsed.cuit);
        if (entry) {
          parsed.contactoOdoo = entry.contactoOdoo;
          parsed.cuentaContable = entry.cuentaContable;
          parsed.ivaOdoo = entry.iva;
          parsed.impuestosIdExterno = entry.impuestosIdExterno ?? undefined;
          parsed.enGlosario = true;

          if (entry.producto) {
            parsed.productoOdoo = entry.producto;
          } else {
            const variables = getProductosVariables(entry.contactoOdoo);
            if (variables.length > 0) {
              const top = variables.sort(
                (a, b) => b.ocurrencias - a.ocurrencias,
              )[0];
              parsed.productoOdoo = `${top.producto} (${top.pctOcurrencia})`;
              if (variables.length > 1) {
                parsed.errores.push(
                  `Proveedor variable: ${variables.length} productos posibles. Se asignó el más frecuente.`,
                );
              }
            }
          }
          console.log(
            `  ✅ Enriquecido: ${entry.contactoOdoo} → ${entry.cuentaContable}`,
          );
        } else {
          parsed.enGlosario = false;
          parsed.errores.push(
            "CUIT no encontrado en el Glosario Maestro. Requiere clasificación manual.",
          );
          console.log(`  ⚠️ Sin match en glosario: ${parsed.cuit}`);
        }
      } else {
        parsed.enGlosario = false;
      }

      results.push(parsed);
      processedIds.add(file.id);
    } catch (e: any) {
      console.error(`❌ Error procesando ${file.name}:`, e?.message ?? e);
      results.push({
        fileName: file.name,
        status: "ERROR" as const,
        errores: [e?.message ?? String(e)],
        enGlosario: false,
      });
      processedIds.add(file.id);
    }
  }

  // 6. Generar Excel local
  const outputDir = path.dirname(OUTPUT_XLSX);
  fs.mkdirSync(outputDir, { recursive: true });
  await writeExcel(OUTPUT_XLSX, results as any);
  console.log(`📊 Excel generado localmente: ${OUTPUT_XLSX}`);

  // 7. Subir Excel a carpeta semanal
  const excelBuffer = fs.readFileSync(OUTPUT_XLSX);
  const excelName = `facturas_${currentFolder.name}.xlsx`;
  await uploadExcel(FOLDER_ID, excelName, excelBuffer);

  // 8. Guardar tracking
  await saveProcessedIds(FOLDER_ID, processedIds);

  const enGlosario = results.filter((r: any) => r.enGlosario).length;
  console.log(
    `✅ Pipeline completado. ${results.length} facturas procesadas. ${enGlosario}/${results.length} encontradas en glosario.`,
  );
}

runPipeline().catch((e) => console.error("❌ Error fatal:", e));
setInterval(() => {
  runPipeline().catch((e) => console.error("❌ Error fatal en cron:", e));
}, INTERVAL_MS);

console.log(`🕐 Cron configurado: corre cada ${INTERVAL_HOURS} horas.`);
