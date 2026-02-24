# Invoice Automation

Automatización para la extracción estructurada de datos desde facturas en PDF y generación de un archivo Excel consolidado.

El sistema procesa facturas con distintos layouts, normaliza información clave y clasifica automáticamente la calidad de la extracción.

---

## 🚀 Funcionalidades

- 📄 Extracción de texto desde facturas PDF
- 🏢 Detección del emisor (Razón Social + CUIT)
- 🧾 Identificación del tipo de factura (A / B / C / X)
- 🔢 Extracción de número y fecha de emisión
- 🏷 Detección de CAE / CAI / CAEA
- 💵 Detección de moneda (ARS / USD) y tipo de cambio (TC)
- 📊 Identificación básica de IVA y retenciones
- 🧠 Clasificación automática de resultados:
  - `OK`
  - `NEEDS_REVIEW`
  - `ERROR`
- 📁 Generación de Excel estructurado listo para revisión o carga en sistema

---

## 🛠 Stack Tecnológico

- **Node.js**
- **TypeScript**
- **pdfjs-dist** (extracción de texto desde PDF)
- **ExcelJS** (generación de archivos Excel)

---

## 📂 Estructura del Proyecto
