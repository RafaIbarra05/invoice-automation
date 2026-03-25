import { InvoiceExtractionResult, ExtractionStatus } from "../types/invoice.js";

// CUIT de Pura Frutta / Patagonia Beverage — receptor, nunca emisor
const RECEPTOR_CUITS = new Set(["30-71459309-5", "30714593095"]);

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

/**
 * FIX 1: Extrae el CUIT del nombre del archivo.
 * Muchas facturas del formato AFIP tienen el CUIT del emisor como prefijo:
 * ej: "20078235870_001_00002_00000545.pdf"
 * El primer segmento de 11 dígitos es el CUIT del emisor.
 */
function extractCuitFromFileName(fileName: string): string | undefined {
  const name = fileName.replace(/\.pdf$/i, "").replace(/\.PDF$/i, "");
  const m = name.match(/^(\d{11})_/);
  if (!m) return undefined;
  const normalized = normalizeCuit(m[1]);
  // No retornar si es el CUIT del receptor
  if (normalized && RECEPTOR_CUITS.has(normalized)) return undefined;
  return normalized;
}

function detectCurrency(text: string) {
  if (/\bUSD\b|U\$S|US\$|D[óo]lares/i.test(text)) return "USD";
  if (/\bARS\b|Pesos|AR\$|\$\s?/i.test(text)) return "ARS";
  return undefined;
}

function detectTc(text: string) {
  return (
    firstGroup(/tipo de cambio[:\s]*([0-9]+[.,][0-9]+)/i, text) ||
    firstGroup(/\bTC\.?\b[:\s]*([0-9]+[.,][0-9]+)/i, text) ||
    firstGroup(/Cotizaci[oó]n.*?([0-9]+[.,][0-9]+)/i, text) ||
    // FCA con TC en nombre de producto: "TC. 1435" o "TC. 1410"
    firstGroup(/\bTC\.?\s*([0-9]{3,6}(?:[.,][0-9]+)?)\b/, text)
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

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const itemLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (/[0-9]+[.,][0-9]{2}/.test(lines[i])) {
      const prev = lines[i - 1];
      if (prev && prev.length < 120) itemLines.push(prev + " " + lines[i]);
    }
  }
  if (itemLines.length) return itemLines.slice(0, 10).join(" | ");
  return undefined;
}

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

  const facturaIdx = text.search(/\bFACTURA\b/i);
  if (facturaIdx >= 0) {
    const window = text.slice(facturaIdx, facturaIdx + 200);
    const m = window.match(/\b([ABCX])\b/);
    if (m?.[1]) return m[1].toUpperCase();
  }
  const earlyBlock = text.slice(0, 500);
  const solo = earlyBlock.match(/\b([ABCX])\b/);
  if (solo?.[1]) return solo[1].toUpperCase();
  return undefined;
}

/**
 * FIX TETRAPAK: Detecta CUIT en formato "C.U.I.T. N°.: 30-58912328-6"
 */
function extractCuitTetrapak(text: string): string | undefined {
  // Formato: C.U.I.T. N°.: 30-58912328-6
  const m = text.match(/C\.U\.I\.T\.?\s*N[°º]\.?:?\s*([\d\-]{11,14})/i);
  if (!m) return undefined;
  const normalized = normalizeCuit(m[1]);
  if (normalized && RECEPTOR_CUITS.has(normalized)) return undefined;
  return normalized;
}

/**
 * FIX TETRAPAK: Detecta razón social "Tetra Pak S.R.L." del bloque inicial.
 */
function extractRazonSocialTetrapak(text: string): string | undefined {
  const m = text.match(/^(Tetra\s+Pak[^\n\r]+)/im);
  return m?.[1]?.trim();
}

/**
 * FIX TETRAPAK: Número con espacio "0055- 00144881" → "0055-00144881"
 */
function detectNumeroTetrapak(text: string): string | undefined {
  const m = text.match(/Factura\s+N[°º\.]\s*[\.\s]*(\d{4})-\s*(\d{8})/i);
  if (m) return `${m[1]}-${m[2]}`;
  // "A Factura Nº . 0055- 00144881"
  const m2 = text.match(/Factura\s+N[°º][\s\.]*(\d{4})-\s*(\d{6,8})/i);
  if (m2) return `${m2[1].padStart(4, "0")}-${m2[2].padStart(8, "0")}`;
  return undefined;
}

/**
 * FIX 2 + FIX 3: Detección de emisor mejorada.
 * - Penaliza fuertemente los CUITs del receptor (Pura Frutta / Patagonia Beverage)
 * - Soporta formato "Comp. Nro: 00002   00000545" para número de factura
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

    const beforeLines = before
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const razonSocial = beforeLines[beforeLines.length - 1];

    let score = 0;

    // FIX 3: Penalizar fuertemente CUITs del receptor
    if (RECEPTOR_CUITS.has(cuit)) {
      score -= 10;
    }

    if (
      razonSocial &&
      /\b(S\.A\.|SA|S\.R\.L\.|SRL|C\.I\.C\.S\.A\.|CICSA|SAS)\b/i.test(
        razonSocial,
      )
    )
      score += 3;
    if (razonSocial && razonSocial.length >= 5) score += 1;
    if (razonSocial && /\bPATAGONIA\b|\bBEVERAGE\b/i.test(razonSocial))
      score -= 5;
    if (/(Cliente|Receptor|Destinatario|Señores|Señor(es))/i.test(before))
      score -= 2;
    if (/(Emisor|Proveedor)/i.test(before) || /(Emisor|Proveedor)/i.test(after))
      score += 2;

    candidates.push({ cuit, razonSocial, score });
  }

  if (!candidates.length) return {};
  candidates.sort((a, b) => b.score - a.score);

  // Si el mejor candidato es un CUIT del receptor, no retornar nada
  const best = candidates[0];
  if (RECEPTOR_CUITS.has(best.cuit)) return {};

  return { cuit: best.cuit, razonSocial: best.razonSocial };
}

/**
 * FIX 2: Detecta número de factura en formato "Comp. Nro: 00002   00000545"
 * además del formato estándar "0002-00000545"
 */
function detectNumeroFactura(text: string): string | undefined {
  // Formato estándar: 0002-00000545
  const standard =
    firstGroup(/\b(\d{4}-\d{8}(?:-[A-Z])?)\b/, text) ||
    firstGroup(/\bN[°º]\s*[:\s]*([0-9]{4}-[0-9]{8}(?:-[A-Z])?)\b/i, text);
  if (standard) return standard;

  // Formato AFIP: "Comp. Nro: 00002   00000545" o "Punto de Venta: 00002  Comp. Nro: 00000545"
  const compNro = text.match(
    /(?:Comp(?:robante)?\.?\s*Nro\.?|Punto\s+de\s+Venta)[:\s]*([0-9]{1,5})\s+(?:Comp(?:robante)?\.?\s*Nro\.?[:\s]*)?([0-9]{5,8})/i,
  );
  if (compNro) {
    const pv = compNro[1].padStart(4, "0");
    const nro = compNro[2].padStart(8, "0");
    return `${pv}-${nro}`;
  }

  // Formato con guion largo: "A-00012-00000323"
  const withPrefix = firstGroup(/\b[A-Z]-(\d{5}-\d{8})\b/, text);
  if (withPrefix) return withPrefix;

  return undefined;
}

/**
 * FIX 2: Detecta fecha con más patrones.
 */
function detectFechaEmision(text: string): string | undefined {
  return (
    firstGroup(
      /Fecha\s+de\s+[Ee]misi[oó]n[:\s]*([0-3]?\d[\/\.][01]?\d[\/\.]\d{4})/i,
      text,
    ) ||
    firstGroup(/\bFECHA[:\s]*([0-3]?\d[\/\.][01]?\d[\/\.]\d{4})\b/i, text) ||
    firstGroup(/Fecha[:\s]*([0-3]?\d[\/\.][01]?\d[\/\.]\d{4})/i, text) ||
    // Formato "05/03/2026" que aparece suelto en el texto cerca de palabras clave
    firstGroup(
      /(?:emisi[oó]n|emitid[ao]|fecha)[^\n]{0,30}([0-3]\d\/[01]\d\/\d{4})/i,
      text,
    )
  );
}

export function parseInvoiceFromText(
  text: string,
  fileName: string,
): InvoiceExtractionResult {
  const errores: string[] = [];

  // --- Emisor por contexto del CUIT (preferido) ---
  const emisor = detectEmisorByCuitContext(text);

  // FIX 1: Si no se detectó CUIT por contexto, intentar desde el nombre del archivo
  const cuitFromFile = extractCuitFromFileName(fileName);

  // FIX TETRAPAK: fallback con formato N°.:
  const cuitTetrapak = extractCuitTetrapak(text);

  const cuit =
    emisor.cuit ||
    cuitFromFile ||
    cuitTetrapak ||
    normalizeCuit(
      firstGroup(
        /C\.?U\.?I\.?T\.?(?:\s*Nro\.)?[:\s]*([0-9\-\. ]{11,16})/i,
        text,
      ) || firstGroup(/\bCUIT\b[:\s]*([0-9\-\. ]{11,16})/i, text),
    );

  // Si el CUIT final es del receptor, descartarlo
  const cuitFinal = cuit && RECEPTOR_CUITS.has(cuit) ? undefined : cuit;

  const razonSocial =
    emisor.razonSocial ||
    extractRazonSocialTetrapak(text) ||
    firstGroup(/Raz[oó]n Social[:\s]*([^\n\r]+)/i, text) ||
    firstGroup(/Emisor[:\s]*([^\n\r]+)/i, text) ||
    firstGroup(
      /\n([A-Z0-9 .&-]+ S\.A\.|[A-Z0-9 .&-]+ S\.R\.L\.|[A-Z0-9 .&-]+ SRL)\b/i,
      text,
    );

  const tipoFactura = detectTipoFactura(text);

  // FIX 2 + TETRAPAK: Número y fecha con detección mejorada
  const numeroFactura = detectNumeroFactura(text) || detectNumeroTetrapak(text);
  const fechaEmision = detectFechaEmision(text);

  const moneda = detectCurrency(text);
  const tc = detectTc(text);

  const { caeTipo, caeValor, caeWarning } = detectCae(text);
  if (caeWarning) errores.push(caeWarning);

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
    cuit: cuitFinal,
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
    cuit: cuitFinal,
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
