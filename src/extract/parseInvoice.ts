import { InvoiceExtractionResult, ExtractionStatus } from "../types/invoice.js";

function firstGroup(re: RegExp, text: string) {
  const m = text.match(re);
  return m?.[1]?.trim();
}

function normalizeCuit(raw?: string) {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return undefined;
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

function detectCurrency(text: string) {
  if (/\bUSD\b|U\$S|US\$|D[óo]lares/i.test(text)) return "USD";
  if (/\bARS\b|Pesos|AR\$|\$\s?/i.test(text)) return "ARS";
  return undefined;
}

function detectTc(text: string) {
  return (
    firstGroup(/\bTC\b[:\s]*([0-9]+[.,][0-9]+)/i, text) ||
    firstGroup(/Tipo de cambio[:\s]*([0-9]+[.,][0-9]+)/i, text) ||
    firstGroup(/Cotizaci[oó]n.*?([0-9]+[.,][0-9]+)/i, text)
  );
}

function detectCae(text: string): {
  caeTipo: "CAE" | "CAI" | "CAEA" | null;
  caeValor: string | null;
  caeWarning?: string;
} {
  const sinAsignar = /C\.?A\.?E\.?.*SIN ASIGNAR/i.test(text);
  if (sinAsignar) {
    return {
      caeTipo: "CAE",
      caeValor: null,
      caeWarning: "CAE indicado pero figura SIN ASIGNAR",
    };
  }

  const cae = firstGroup(/\bC\.?A\.?E\.?\b.*?([0-9]{8,14})/i, text);
  if (cae) return { caeTipo: "CAE", caeValor: cae };

  const cai = firstGroup(/\bC\.?A\.?I\.?\b[:\s]*([0-9]{8,14})/i, text);
  if (cai) return { caeTipo: "CAI", caeValor: cai };

  const caea = firstGroup(/\bC\.?A\.?E\.?A\b[:\s]*([0-9]{8,14})/i, text);
  if (caea) return { caeTipo: "CAEA", caeValor: caea };

  return { caeTipo: null, caeValor: null };
}

function pickConceptBlock(text: string) {
  const m = text.match(/(Detalle|Descripci[oó]n|Concepto)[\s\S]{0,900}/i);
  if (m) return m[0].trim();

  // fallback adicional: buscar líneas con importe + descripción previa
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const itemLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (/[0-9]+[.,][0-9]{2}/.test(lines[i])) {
      const prev = lines[i - 1];
      if (prev && prev.length < 120) {
        itemLines.push(prev + " " + lines[i]);
      }
    }
  }

  if (itemLines.length) return itemLines.slice(0, 10).join(" | ");

  return undefined;
}

/**
 * Intenta detectar tipo de factura aunque la letra esté separada por saltos de línea.
 * Casos típicos:
 * - "FACTURA A"
 * - "FACTURA\nA"
 * - "FACTURA  A  Código 01"
 * - "Comprobante ... A"
 */
function detectTipoFactura(text: string): string | undefined {
  const patterns: RegExp[] = [
    /\bFACTURA\b[\s\S]{0,120}\b([ABCX])\b/i,
    /\bCOMPROBANTE\b[\s\S]{0,80}\b([ABCX])\b/i,
    /\bC[oó]digo\b[\s\S]{0,40}\b([ABCX])\b/i,
    /\b([ABCX])\b[\s\S]{0,40}\bC[oó]digo\b/i,
    /\b([ABCX])\b[\s\S]{0,40}\bComprobante\b/i,
  ];

  for (const re of patterns) {
    const v = firstGroup(re, text);
    if (v) return v.toUpperCase();
  }

  // Último recurso (con cuidado): buscar letra sola cerca de la palabra FACTURA
  const facturaIdx = text.search(/\bFACTURA\b/i);
  if (facturaIdx >= 0) {
    const window = text.slice(facturaIdx, facturaIdx + 200);
    const m = window.match(/\b([ABCX])\b/);
    if (m?.[1]) return m[1].toUpperCase();
  }
  // Buscar letra aislada A/B/C/X si aparece sola en primeras 500 posiciones
  const earlyBlock = text.slice(0, 500);
  const solo = earlyBlock.match(/\b([ABCX])\b/);
  if (solo?.[1]) return solo[1].toUpperCase();
  return undefined;
}

/**
 * Extrae candidatos CUIT y razón social "cerca" del CUIT.
 * Si hay dos CUITs (emisor + receptor), intenta elegir el emisor:
 * - bonifica si razón social parece empresa (SA/SRL/etc)
 * - penaliza si contiene "PATAGONIA" / "BEVERAGE" (cliente de tu muestra)
 */
function detectEmisorByCuitContext(text: string): {
  cuit?: string;
  razonSocial?: string;
} {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const joined = lines.join("\n");

  const cuitRe = /C\.?U\.?I\.?T\.?(?:\s*Nro\.)?[:\s]*([0-9\-\. ]{11,16})/gi;

  type Candidate = { cuit: string; razonSocial?: string; score: number };
  const candidates: Candidate[] = [];

  let match: RegExpExecArray | null;
  while ((match = cuitRe.exec(joined))) {
    const raw = match[1];
    const cuit = normalizeCuit(raw);
    if (!cuit) continue;

    const idx = match.index;
    const before = joined.slice(Math.max(0, idx - 250), idx);
    const after = joined.slice(idx, Math.min(joined.length, idx + 250));

    // Tomamos última línea no vacía antes del CUIT como razón social probable
    const beforeLines = before
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const razonSocial = beforeLines[beforeLines.length - 1];

    let score = 0;

    // Bonificaciones si parece razón social de empresa
    if (
      razonSocial &&
      /\b(S\.A\.|SA|S\.R\.L\.|SRL|C\.I\.C\.S\.A\.|CICSA|SAS)\b/i.test(
        razonSocial,
      )
    )
      score += 3;
    if (razonSocial && razonSocial.length >= 5) score += 1;

    // Penalizar si parece cliente (según tus facturas de ejemplo)
    if (razonSocial && /\bPATAGONIA\b|\bBEVERAGE\b/i.test(razonSocial))
      score -= 5;

    // Penalizar si el contexto parece “Cliente / Receptor”
    if (/(Cliente|Receptor|Destinatario|Señores|Señor(es))/i.test(before))
      score -= 1;
    // Bonificar si el contexto parece “Emisor”
    if (/(Emisor|Proveedor)/i.test(before) || /(Emisor|Proveedor)/i.test(after))
      score += 1;

    candidates.push({ cuit, razonSocial, score });
  }

  if (!candidates.length) return {};

  candidates.sort((a, b) => b.score - a.score);
  return { cuit: candidates[0].cuit, razonSocial: candidates[0].razonSocial };
}

export function parseInvoiceFromText(
  text: string,
  fileName: string,
): InvoiceExtractionResult {
  const errores: string[] = [];

  // --- Emisor por contexto del CUIT (preferido) ---
  const emisor = detectEmisorByCuitContext(text);

  // CUIT: fallback si no se logró por contexto
  const cuit =
    emisor.cuit ||
    normalizeCuit(
      firstGroup(
        /C\.?U\.?I\.?T\.?(?:\s*Nro\.)?[:\s]*([0-9\-\. ]{11,16})/i,
        text,
      ) || firstGroup(/\bCUIT\b[:\s]*([0-9\-\. ]{11,16})/i, text),
    );

  // Razón Social: priorizamos la detectada junto al CUIT
  const razonSocial =
    emisor.razonSocial ||
    firstGroup(/Raz[oó]n Social[:\s]*([^\n\r]+)/i, text) ||
    firstGroup(/Emisor[:\s]*([^\n\r]+)/i, text) ||
    firstGroup(
      /\n([A-Z0-9 .&-]+ S\.A\.|[A-Z0-9 .&-]+ S\.R\.L\.|[A-Z0-9 .&-]+ SRL)\b/i,
      text,
    );

  // Tipo factura: robusto a saltos de línea / separación visual
  const tipoFactura = detectTipoFactura(text);

  // Número: ####-######## opcional sufijo "-A" o similar
  const numeroFactura =
    firstGroup(/\b(\d{4}\-\d{8}(?:-[A-Z])?)\b/, text) ||
    firstGroup(/\bN[°º]\s*[:\s]*([0-9]{4}\-[0-9]{8}(?:-[A-Z])?)\b/i, text);

  // Fecha emisión: dd/mm/yyyy o dd.mm.yyyy
  const fechaEmision =
    firstGroup(/\bFECHA[:\s]*([0-3]?\d[\/\.][01]?\d[\/\.]\d{4})\b/i, text) ||
    firstGroup(/Fecha[:\s]*([0-3]?\d[\/\.][01]?\d[\/\.]\d{4})/i, text);

  const moneda = detectCurrency(text);
  const tc = detectTc(text);

  const { caeTipo, caeValor, caeWarning } = detectCae(text);
  if (caeWarning) errores.push(caeWarning);

  // IVA / Retenciones (MVP)
  const iva =
    firstGroup(/\bIVA\b[^\n\r]*[:\s]*([$]?\s*[0-9\.\,]+)/i, text) ||
    (/(\bIVA\b|\bI\.V\.A\.\b)/i.test(text) ? "VER_EN_PDF" : undefined);

  const retenciones =
    firstGroup(/Retenciones?[^\n\r]*[:\s]*([$]?\s*[0-9\.\,]+)/i, text) ||
    (/Percepci[oó]n|IIBB|IBP|IBCF|Retenci[oó]n/i.test(text)
      ? "VER_EN_PDF"
      : undefined);

  const conceptos = pickConceptBlock(text);
  const cantidad = /\bCant\.?\b|\bCantidad\b/i.test(text)
    ? "VER_EN_PDF"
    : undefined;
  const preciosUnitarios = /Unit\.?|Unitario|P\.?\s*Unit/i.test(text)
    ? "VER_EN_PDF"
    : undefined;

  // Status
  const required = {
    razonSocial,
    cuit,
    tipoFactura,
    numeroFactura,
    fechaEmision,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  let status: ExtractionStatus = "OK";
  if (missing.length >= 3) status = "ERROR";
  else if (missing.length > 0) status = "NEEDS_REVIEW";

  // Reglas extra
  if (tipoFactura === "X" && !caeTipo) {
    if (status === "ERROR") status = "NEEDS_REVIEW";
    errores.push("Factura X: CAE/CAI/CAEA puede no existir (revisión manual).");
  }

  if (moneda === "USD" && !tc) {
    if (status === "OK") status = "NEEDS_REVIEW";
    errores.push("Moneda USD sin tipo de cambio (TC).");
  }

  if (!conceptos) {
    if (status === "OK") status = "NEEDS_REVIEW";
    errores.push("No se pudo identificar bloque de conceptos/detalle.");
  }

  if (missing.length) errores.push(`Faltan campos: ${missing.join(", ")}`);

  return {
    razonSocial,
    cuit,
    tipoFactura,
    numeroFactura,
    fechaEmision: fechaEmision?.replace(/\./g, "/"),
    moneda,
    tc,
    caeTipo,
    caeValor,

    conceptos,
    cantidad,
    preciosUnitarios,
    retenciones,
    iva,

    status,
    errores,
    fileName,
  };
}
