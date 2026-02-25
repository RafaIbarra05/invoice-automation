import { google } from "googleapis";
import { JWT } from "google-auth-library";

let _auth: JWT | null = null;

/**
 * Retorna un cliente autenticado con la cuenta de servicio.
 * Lee las credenciales desde variables de entorno.
 */
export function getAuthClient(): JWT {
  if (_auth) return _auth;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !rawKey) {
    throw new Error(
      "Faltan variables de entorno: GOOGLE_SERVICE_ACCOUNT_EMAIL y/o GOOGLE_PRIVATE_KEY",
    );
  }

  // En .env la clave viene con \n literal — hay que convertirlos a saltos reales
  const privateKey = rawKey.replace(/\\n/g, "\n");

  _auth = new JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  return _auth;
}

/**
 * Retorna una instancia de la API de Drive lista para usar.
 */
export function getDriveClient() {
  const auth = getAuthClient();
  return google.drive({ version: "v3", auth });
}
