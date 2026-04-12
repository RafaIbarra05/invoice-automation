import Anthropic from "@anthropic-ai/sdk";
import { InvoiceExtractionResult } from "../types/invoice.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Detecta qué campos críticos faltan en el resultado del parser.
 */
function getMissingFields(parsed: InvoiceExtractionResult): string[] {
  const critical: (keyof InvoiceExtractionResult)[] = [
    "razonSocial",
    "cuit",
    "tipoFactura",
    "numeroFactura",
    "fechaEmision",
    "moneda",
  ];
  return critical.filter((k) => !parsed[k]);
}

/**
 * Llama a Claude Haiku para extraer los campos faltantes de una factura.
 * Solo se llama si hay al menos un campo crítico faltante.
 * Retorna un objeto parcial con los campos que pudo completar.
 */
export async function enrichWithAI(
  text: string,
  parsed: InvoiceExtractionResult,
): Promise<Partial<InvoiceExtractionResult>> {
  const missingFields = getMissingFields(parsed);

  if (missingFields.length === 0) {
    return {}; // Nada que completar
  }

  const fieldDescriptions: Record<string, string> = {
    razonSocial:
      "Razón social o nombre del emisor de la factura (no del receptor)",
    cuit: "CUIT del emisor en formato XX-XXXXXXXX-X (no el del receptor/cliente)",
    tipoFactura: "Tipo de comprobante: solo la letra A, B, C o X",
    numeroFactura:
      "Número de factura en formato XXXX-XXXXXXXX (ej: 0001-00001234)",
    fechaEmision: "Fecha de emisión en formato dd/mm/yyyy",
    moneda: "Moneda: ARS o USD",
  };

  const fieldsToFind = missingFields
    .map((f) => `- "${f}": ${fieldDescriptions[f]}`)
    .join("\n");

  const prompt = `Sos un experto en facturas argentinas. Analizá el siguiente texto extraído de una factura PDF y extraé ÚNICAMENTE los campos que se piden.

CAMPOS A EXTRAER:
${fieldsToFind}

REGLAS IMPORTANTES:
- El emisor es quien EMITE la factura (el proveedor), NO quien la recibe (Patagonia Beverage / Pura Frutta).
- El CUIT del receptor/cliente es 30-71459309-5, NUNCA lo devuelvas como CUIT del emisor.
- Si no podés encontrar un campo con certeza, devolvé null para ese campo.
- El número de factura puede aparecer como "Comp. Nro: 0001 00001234" o "Factura N° 0001-00001234".
- La fecha puede estar en formato dd/mm/yyyy o dd.mm.yyyy.
- Respondé ÚNICAMENTE con un JSON válido, sin texto adicional, sin markdown, sin explicaciones.

Ejemplo de respuesta:
{"razonSocial": "Expreso Sur SRL", "cuit": "30-12345678-9", "tipoFactura": "A", "numeroFactura": "0001-00001234", "fechaEmision": "05/03/2026", "moneda": "ARS"}

TEXTO DE LA FACTURA:
${text.slice(0, 4000)}`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as any).text)
      .join("");

    const clean = raw.replace(/```json|```/g, "").trim();
    const aiResult = JSON.parse(clean);

    // Solo retornar campos que realmente faltan y que la IA encontró
    const enriched: Partial<InvoiceExtractionResult> = {};
    for (const field of missingFields) {
      const value = aiResult[field];
      if (value && value !== null) {
        (enriched as any)[field] = value;
      }
    }

    return enriched;
  } catch (e: any) {
    console.warn(`  ⚠️ AI fallback falló: ${e?.message ?? e}`);
    return {};
  }
}

export { getMissingFields };
